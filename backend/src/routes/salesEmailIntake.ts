import type { FastifyInstance } from "fastify"
import { Webhook } from "svix"
import { pool } from "../db/db"
import {
  processBusinessDevelopmentIntake,
} from "../services/businessDevelopmentIntakeService"
import {
  sendAlertEmail,
} from "../services/emailService"
import {
  queueInitialExternalResponse,
} from "../services/initialResponseGraceService"
import {
  parseUniversalIntake,
} from "../services/universalIntakeParser"
import {
  saveJobAssetByTenantSlug,
} from "../services/jobAssetsService"
import path from "node:path"

const TENANT_SLUG = "g2g-roofing"
const INBOUND_ADDRESS = "sales@istaeriiul.resend.app"

function clean(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const result = String(value)
    .replace(/<mailto:[^>]+>/gi, "")
    .replace(/mailto:/gi, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()

  return result.length ? result : null
}

function extractEmailAddress(value: string): string | null {
  const normalized = clean(value)

  if (!normalized) {
    return null
  }

  const angleBracketMatch =
    normalized.match(/<([^<>\s]+@[^<>\s]+)>/)

  if (angleBracketMatch?.[1]) {
    return angleBracketMatch[1]
      .trim()
      .toLowerCase()
  }

  const plainEmailMatch =
    normalized.match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
    )

  return plainEmailMatch?.[0]
    ? plainEmailMatch[0]
        .trim()
        .toLowerCase()
    : null
}

async function sendAdministrativeIntakeCompletionEmail(
  params: {
    result: any
    parsed: any
    subject: string
    sender: string
    attachmentImport: any
    customerEmailAcknowledgment: any
  }
) {
  const sharedOfficeRecipient =
    extractEmailAddress(
      process.env.G2G_GMAIL_TO ||
      process.env.ALERT_EMAIL_TO ||
      ""
    )

  const senderRecipient =
    extractEmailAddress(params.sender)

  const recipient =
    senderRecipient ||
    sharedOfficeRecipient

  if (!recipient) {
    console.error(
      "Administrative Assistant completion receipt skipped: no valid sender or shared office recipient",
      {
        job_id: params.result.job_id,
      }
    )

    return {
      ok: false,
      skipped: true,
      reason:
        "missing_completion_receipt_recipient",
    }
  }

  const ccRecipient =
    senderRecipient &&
    sharedOfficeRecipient &&
    senderRecipient !== sharedOfficeRecipient
      ? sharedOfficeRecipient
      : null

  const customerName =
    clean(params.parsed.customerName) ||
    "Unknown Customer"

  const propertyAddress = [
    clean(params.parsed.address1),
    clean(params.parsed.city),
    clean(params.parsed.state),
    clean(params.parsed.zip),
  ]
    .filter(Boolean)
    .join(", ")

  const resultText =
    params.result.action === "created_job"
      ? "New Navigator job created"
      : "Existing Navigator job updated"

  const importedAttachments =
    Array.isArray(params.attachmentImport?.imported)
      ? params.attachmentImport.imported
      : []

  const skippedAttachments =
    Array.isArray(params.attachmentImport?.skipped)
      ? params.attachmentImport.skipped
      : []

  const failedAttachments =
    Array.isArray(params.attachmentImport?.failed)
      ? params.attachmentImport.failed
      : []

  const attachmentLines = [
    `Attempted: ${Number(params.attachmentImport?.attempted || 0)}`,
    `Imported: ${importedAttachments.length}`,
    ...importedAttachments.map(
      (attachment: any) =>
        `  ✓ ${attachment.stored_filename}`
    ),
    `Skipped: ${skippedAttachments.length}`,
    ...skippedAttachments.map(
      (attachment: any) =>
        `  - ${attachment.filename || "Attachment"}: ${attachment.reason}`
    ),
    `Failed: ${failedAttachments.length}`,
    ...failedAttachments.map(
      (attachment: any) =>
        `  ⚠ ${attachment.filename || "Attachment"}: ${attachment.error}`
    ),
  ]

  const customerAcknowledgmentText =
    params.customerEmailAcknowledgment?.ok
      ? "Sent"
      : params.customerEmailAcknowledgment?.skipped
        ? `Skipped: ${params.customerEmailAcknowledgment.reason}`
        : `Failed: ${
            params.customerEmailAcknowledgment?.error ||
            "Unknown error"
          }`

  const officeReviewRequired =
    failedAttachments.length > 0

  const text = [
    "Administrative Assistant Intake Complete",
    "",
    "Customer",
    customerName,
    "",
    "Property",
    propertyAddress ||
      "No property address supplied",
    "",
    "Result",
    resultText,
    "",
    "Attachments",
    `✓ ${importedAttachments.length} imported`,
    skippedAttachments.length > 0
      ? `- ${skippedAttachments.length} skipped`
      : "✓ None skipped",
    failedAttachments.length > 0
      ? `⚠ ${failedAttachments.length} failed`
      : "✓ None failed",
    "",
    "Customer Acknowledgment",
    customerAcknowledgmentText,
    "",
    "Office Review Required",
    officeReviewRequired
      ? "Yes"
      : "No",
    "",
    "Supporting Information",
    `Navigator Job: #${params.result.job_id}`,
    `Original Subject: ${
      clean(params.subject) ||
      "Not supplied"
    }`,
    "",
    "CRM",
    "✓ Timeline event created",
    "✓ Administrative Assistant note created",
    "",
    "Attachment Details",
    ...attachmentLines,
  ].join("\n")

  const subjectIdentifier =
    propertyAddress ||
    customerName ||
    `Job #${params.result.job_id}`

  const receiptSubject =
    officeReviewRequired
      ? `Administrative Assistant Review Required: ${subjectIdentifier}`
      : `Administrative Assistant Intake Complete: ${subjectIdentifier}`

  try {
    return await sendAlertEmail(
      recipient,
      receiptSubject,
      text,
      ccRecipient
        ? {
            cc: ccRecipient,
          }
        : undefined
    )
  } catch (error: any) {
    console.error(
      "Administrative Assistant completion receipt failed after intake completion",
      {
        job_id: params.result.job_id,
        recipient,
        cc: ccRecipient,
        error:
          error?.message ||
          String(error),
      }
    )

    return {
      ok: false,
      error:
        error?.message ||
        String(error),
    }
  }
}

function stripHtml(value: string): string {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

function readTextPayload(body: any) {
  const email =
    body?.data ||
    body?.email ||
    body?.payload ||
    body ||
    {}

  const subject = String(
    email.subject ||
      body?.subject ||
      ""
  ).trim()

  const from =
    typeof email.from === "string"
      ? email.from
      : email.from?.email ||
        email.from?.address ||
        body?.from ||
        ""

  const to =
    typeof email.to === "string"
      ? email.to
      : Array.isArray(email.to)
        ? email.to
            .map(
              (item: any) =>
                item?.email ||
                item?.address ||
                item
            )
            .join(", ")
        : body?.to || ""

  const text =
    email.text ||
    email.textBody ||
    email.text_body ||
    body?.text ||
    body?.textBody ||
    ""

  const html =
    email.html ||
    email.htmlBody ||
    email.html_body ||
    body?.html ||
    body?.htmlBody ||
    ""

  return {
    subject,
    from: String(from || ""),
    to: String(to || ""),
    text: [
      subject,
      text,
      stripHtml(html),
    ]
      .filter(Boolean)
      .join("\n"),
    raw: email,
  }
}


type ResendReceivedAttachment = {
  id: string
  filename: string
  size?: number | null
  content_type?: string | null
  content_disposition?: string | null
  content_id?: string | null
  download_url?: string | null
  expires_at?: string | null
}

function extractReceivedEmailId(email: any): string | null {
  return clean(
    email?.email_id ||
      email?.id ||
      email?.emailId ||
      email?.data?.email_id ||
      email?.data?.id
  )
}

function extractAttachmentLabels(text: string): Map<number, string> {
  const labels = new Map<number, string>()
  const pattern =
    /^attachment\s*(\d+)\s*(?::|#|-|\bis\b)\s*(.+)$/gim

  for (const match of String(text || "").matchAll(pattern)) {
    const attachmentNumber = Number(match[1])
    const label = clean(match[2])

    if (
      Number.isInteger(attachmentNumber) &&
      attachmentNumber > 0 &&
      label
    ) {
      labels.set(attachmentNumber, label)
    }
  }

  return labels
}

function buildLabeledAttachmentName(
  label: string,
  originalFilename: string
): string {
  const originalExtension = path.extname(originalFilename || "")
  const labelExtension = path.extname(label || "")
  const cleanLabel = String(label || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!cleanLabel) {
    return originalFilename
  }

  return labelExtension
    ? cleanLabel
    : `${cleanLabel}${originalExtension}`
}

function buildAttachmentIdentity(
  attachmentNumber: number,
  originalFilename: string,
  label?: string | null
): string {
  if (label) {
    return buildLabeledAttachmentName(
      label,
      originalFilename
    )
  }

  const extension = path.extname(originalFilename || "")
  const baseName = path.basename(
    originalFilename || "",
    extension
  )
  const cleanBaseName = String(baseName || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  const isGeneric =
    !cleanBaseName ||
    /^(attachment|upload|file|document|image|img|photo|scan|untitled)[-_ ]*\d*$/i.test(
      cleanBaseName
    ) ||
    /^img[-_ ]?\d+$/i.test(cleanBaseName)

  if (!isGeneric) {
    return `${cleanBaseName}${extension}`
  }

  const receivedDate = new Date()
    .toISOString()
    .slice(0, 10)

  const typeLabel =
    /^image\//i.test(extension)
      ? "Photo"
      : "Attachment"

  return `${receivedDate} Manual Office Email - ${typeLabel} ${attachmentNumber}${extension}`
}

async function listReceivedEmailAttachments(
  emailId: string
): Promise<ResendReceivedAttachment[]> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not configured for attachment retrieval"
    )
  }

  const response = await fetch(
    `https://api.resend.com/emails/receiving/${emailId}/attachments`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  )

  if (!response.ok) {
    throw new Error(
      `Resend attachment list failed: ${response.status} ${response.statusText}`
    )
  }

  const payload: any = await response.json()

  return Array.isArray(payload?.data)
    ? payload.data
    : []
}

async function importReceivedEmailAttachments(params: {
  emailId: string | null
  emailText: string
  jobId: number
}) {
  const outcome = {
    attempted: 0,
    imported: [] as Array<{
      attachment_number: number
      original_filename: string
      stored_filename: string
      asset_id: number | string | null
    }>,
    skipped: [] as Array<{
      attachment_number: number
      filename: string
      reason: string
    }>,
    failed: [] as Array<{
      attachment_number: number
      filename: string
      error: string
    }>,
  }

  if (!params.emailId) {
    outcome.skipped.push({
      attachment_number: 0,
      filename: "",
      reason: "missing_received_email_id",
    })

    return outcome
  }

  let listedAttachments: ResendReceivedAttachment[]

  try {
    listedAttachments =
      await listReceivedEmailAttachments(params.emailId)
  } catch (error: any) {
    outcome.failed.push({
      attachment_number: 0,
      filename: "",
      error: error?.message || String(error),
    })

    return outcome
  }

  const userAttachments = listedAttachments.filter(
    (attachment) =>
      String(
        attachment.content_disposition || ""
      ).toLowerCase() !== "inline"
  )

  outcome.attempted = userAttachments.length

  if (!userAttachments.length) {
    return outcome
  }

  const labels = extractAttachmentLabels(params.emailText)

  for (
    let index = 0;
    index < userAttachments.length;
    index += 1
  ) {
    const attachment = userAttachments[index]
    const attachmentNumber = index + 1
    const label = labels.get(attachmentNumber)
    const originalFilename =
      clean(attachment.filename) ||
      `attachment-${attachmentNumber}`

    try {
      if (!attachment.download_url) {
        throw new Error("Attachment download URL was not supplied")
      }

      const downloadResponse = await fetch(
        attachment.download_url
      )

      if (!downloadResponse.ok) {
        throw new Error(
          `Attachment download failed: ${downloadResponse.status} ${downloadResponse.statusText}`
        )
      }

      const fileBuffer = Buffer.from(
        await downloadResponse.arrayBuffer()
      )

      const storedFilename = buildAttachmentIdentity(
        attachmentNumber,
        originalFilename,
        label
      )

      const saved: any = await saveJobAssetByTenantSlug({
        tenantSlug: TENANT_SLUG,
        jobId: params.jobId,
        assetType: String(
          attachment.content_type || ""
        ).startsWith("image/")
          ? "photo_before"
          : "other",
        originalName: storedFilename,
        mimeType: attachment.content_type || null,
        note: [
          "Imported by the Receptionist / Administrative Assistant from Manual Office Email.",
          `Original filename: ${originalFilename}`,
          label ? `Office label: ${label}` : null,
        ]
          .filter(Boolean)
          .join(" "),
        uploadedBy: "Manual Office Email",
        fileBuffer,
      })

      outcome.imported.push({
        attachment_number: attachmentNumber,
        original_filename: originalFilename,
        stored_filename: storedFilename,
        asset_id: saved?.id || null,
      })
    } catch (error: any) {
      outcome.failed.push({
        attachment_number: attachmentNumber,
        filename: originalFilename,
        error: error?.message || String(error),
      })
    }
  }

  return outcome
}

function extractFieldEmailNote(
  email: any,
  subject: string
): string | null {
  const rawText =
    email?.text ||
    email?.textBody ||
    email?.text_body ||
    ""

  const rawHtml =
    email?.html ||
    email?.htmlBody ||
    email?.html_body ||
    ""

  let body = String(
    rawText ||
    (rawHtml ? stripHtml(rawHtml) : "")
  )
    .replace(/\r/g, "")
    .trim()

  if (!body) {
    return null
  }

  const subjectText = String(subject || "").trim()

  if (subjectText) {
    const lines = body.split("\n")

    if (
      String(lines[0] || "").trim().toLowerCase() ===
      subjectText.toLowerCase()
    ) {
      body = lines.slice(1).join("\n").trim()
    }
  }

  const stopPatterns = [
    /^\s*--\s*$/im,
    /^\s*sent from my (iphone|ipad|android).*$/im,
    /^\s*get outlook for (ios|android).*$/im,
    /^\s*on .+ wrote:\s*$/im,
    /^\s*from:\s.+$/im,
  ]

  let stopIndex = body.length

  for (const pattern of stopPatterns) {
    const match = pattern.exec(body)

    if (
      match &&
      typeof match.index === "number" &&
      match.index < stopIndex
    ) {
      stopIndex = match.index
    }
  }

  body = body
    .slice(0, stopIndex)
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return body || null
}

function normalizeFieldPhotoAddress(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\broad\b/g, "rd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\blane\b/g, "ln")
    .replace(/\bcourt\b/g, "ct")
    .replace(/\bcircle\b/g, "cir")
    .replace(/\bterrace\b/g, "ter")
    .replace(/\bparkway\b/g, "pkwy")
    .replace(/\bplace\b/g, "pl")
    .replace(/[^a-z0-9]+/g, "")
}

function looksLikeFieldPhotoAddressSubject(
  subject: string
): boolean {
  const value = clean(subject) || ""

  return /^\d+[a-z]?\s+.+\b(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|circle|cir|terrace|ter|parkway|pkwy|place|pl|way|trail|trl|highway|hwy)\b/i.test(
    value
  )
}

function parseFieldPhotoSubject(subject: string) {
  const value = clean(subject) || ""
  const parsed = parseUniversalIntake(value)

  const streetMatch = value.match(
    /^(\d+[a-z]?\s+.+?\b(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|circle|cir|terrace|ter|parkway|pkwy|place|pl|way|trail|trl|highway|hwy)\b)/i
  )

  return {
    address1:
      clean(parsed.address1) ||
      clean(streetMatch?.[1]),
    city: clean(parsed.city),
    state: clean(parsed.state),
    zip: clean(parsed.zip),
  }
}

function isFieldPhotoAttachment(
  attachment: ResendReceivedAttachment
): boolean {
  const contentType = String(
    attachment.content_type || ""
  ).toLowerCase()

  const extension = path
    .extname(attachment.filename || "")
    .toLowerCase()

  const isJpeg =
    contentType === "image/jpeg" ||
    contentType === "image/jpg" ||
    extension === ".jpg" ||
    extension === ".jpeg"

  if (!isJpeg) {
    return false
  }

  const disposition = String(
    attachment.content_disposition || ""
  ).toLowerCase()

  const size = Number(
    attachment.size || 0
  )

  if (
    disposition === "inline" &&
    size < 50_000
  ) {
    return false
  }

  return true
}

async function findUniqueFieldPhotoJob(params: {
  tenantId: number
  address1: string
  city?: string | null
  zip?: string | null
}) {
  const result = await pool.query(
    `
    select
      j.id,
      j.address1,
      j.city,
      j.state,
      j.zip,
      j.stage,
      c.full_name as customer_name
    from jobs j
    left join customers c
      on c.id = j.customer_id
     and c.tenant_id = j.tenant_id
    where j.tenant_id = $1
      and nullif(trim(j.address1), '') is not null
      and coalesce(j.stage, '') not in (
        'archived',
        'disqualified',
        'paid'
      )
    order by
      j.updated_at desc nulls last,
      j.id desc
    `,
    [params.tenantId]
  )

  const normalizedAddress =
    normalizeFieldPhotoAddress(params.address1)

  const normalizedCity = String(
    params.city || ""
  )
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")

  const normalizedZip =
    String(params.zip || "")
      .replace(/\D/g, "")
      .slice(0, 5)

  const matches = result.rows.filter((row: any) => {
    if (
      normalizeFieldPhotoAddress(row.address1) !==
      normalizedAddress
    ) {
      return false
    }

    if (normalizedCity) {
      const rowCity = String(row.city || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")

      if (rowCity && rowCity !== normalizedCity) {
        return false
      }
    }

    if (normalizedZip) {
      const rowZip = String(row.zip || "")
        .replace(/\D/g, "")
        .slice(0, 5)

      if (rowZip && rowZip !== normalizedZip) {
        return false
      }
    }

    return true
  })

  return {
    matches,
    job:
      matches.length === 1
        ? matches[0]
        : null,
  }
}

async function importFieldPhotoAttachments(params: {
  emailId: string
  jobId: number
  sender: string
}) {
  const listedAttachments =
    await listReceivedEmailAttachments(params.emailId)

  const imageAttachments =
    listedAttachments.filter(
      (attachment) =>
        isFieldPhotoAttachment(attachment)
    )

  const outcome = {
    attempted: imageAttachments.length,
    imported: [] as Array<{
      attachment_number: number
      original_filename: string
      stored_filename: string
      asset_id: number | string | null
    }>,
    failed: [] as Array<{
      attachment_number: number
      filename: string
      error: string
    }>,
  }

  for (
    let index = 0;
    index < imageAttachments.length;
    index += 1
  ) {
    const attachment = imageAttachments[index]
    const attachmentNumber = index + 1

    const originalFilename =
      clean(attachment.filename) ||
      `field-photo-${attachmentNumber}.jpg`

    try {
      if (!attachment.download_url) {
        throw new Error(
          "Attachment download URL was not supplied"
        )
      }

      const downloadResponse = await fetch(
        attachment.download_url
      )

      if (!downloadResponse.ok) {
        throw new Error(
          `Attachment download failed: ${downloadResponse.status} ${downloadResponse.statusText}`
        )
      }

      const fileBuffer = Buffer.from(
        await downloadResponse.arrayBuffer()
      )

      const storedFilename =
        buildAttachmentIdentity(
          attachmentNumber,
          originalFilename
        )

      const uploadedBy =
        `${params.sender} via Field Photo Email`

      const saved: any =
        await saveJobAssetByTenantSlug({
          tenantSlug: TENANT_SLUG,
          jobId: params.jobId,
          assetType: "photo_before",
          originalName: storedFilename,
          mimeType:
            attachment.content_type || null,
          note: [
            "Imported from Field Photo Email.",
            `Original filename: ${originalFilename}`,
          ].join(" "),
          uploadedBy,
          fileBuffer,
        })

      outcome.imported.push({
        attachment_number: attachmentNumber,
        original_filename: originalFilename,
        stored_filename: storedFilename,
        asset_id: saved?.id || null,
      })
    } catch (error: any) {
      outcome.failed.push({
        attachment_number: attachmentNumber,
        filename: originalFilename,
        error:
          error?.message ||
          String(error),
      })
    }
  }

  return outcome
}

async function sendFieldPhotoReceipt(params: {
  sender: string
  success: boolean
  subjectAddress: string
  reason?: string | null
  job?: any
  importedCount?: number
  attemptedCount?: number
}) {
  const senderRecipient =
    extractEmailAddress(params.sender)

  const sharedOfficeRecipient =
    extractEmailAddress(
      process.env.G2G_GMAIL_TO ||
      process.env.ALERT_EMAIL_TO ||
      ""
    )

  const recipient =
    senderRecipient ||
    sharedOfficeRecipient

  if (!recipient) {
    console.error(
      "Field photo receipt skipped: no valid sender or office recipient"
    )

    return {
      ok: false,
      skipped: true,
      reason:
        "missing_field_photo_receipt_recipient",
    }
  }

  const ccRecipient =
    senderRecipient &&
    sharedOfficeRecipient &&
    senderRecipient !== sharedOfficeRecipient
      ? sharedOfficeRecipient
      : null

  const symbol =
    params.success ? "✅" : "❌"

  const headline =
    params.success
      ? "Photos Uploaded"
      : "Photos Not Uploaded"

  const subject =
    `${symbol} ${headline}: ${params.subjectAddress}`

  const body = params.success
    ? [
        `${symbol} Field Photo Upload Complete`,
        "",
        `Property: ${
          params.job?.address1 ||
          params.subjectAddress
        }`,
        params.job?.city
          ? `City: ${params.job.city}`
          : null,
        `Navigator Job: #${params.job?.id}`,
        params.job?.customer_name
          ? `Customer: ${params.job.customer_name}`
          : null,
        `Photos uploaded: ${Number(
          params.importedCount || 0
        )}`,
        `Sent by: ${
          senderRecipient ||
          params.sender ||
          "Unknown sender"
        }`,
        "",
        "The photos are now available in Navigator.",
      ]
        .filter(Boolean)
        .join("\n")
    : [
        `${symbol} Field Photos Were Not Uploaded`,
        "",
        `Subject / Property: ${params.subjectAddress}`,
        `Reason: ${
          params.reason ||
          "Navigator could not safely identify one existing job."
        }`,
        "",
        "No new Navigator job was created.",
        "No photos were attached to another job.",
      ].join("\n")

  return await sendAlertEmail(
    recipient,
    subject,
    body,
    ccRecipient
      ? {
          cc: ccRecipient,
        }
      : undefined
  )
}

async function sendFieldEmailReceipt(params: {
  sender: string
  success: boolean
  subjectAddress: string
  reason?: string | null
  job?: any
  noteAdded?: boolean
  importedCount?: number
  failedCount?: number
}) {
  const senderRecipient =
    extractEmailAddress(params.sender)

  const sharedOfficeRecipient =
    extractEmailAddress(
      process.env.G2G_GMAIL_TO ||
      process.env.ALERT_EMAIL_TO ||
      ""
    )

  const recipient =
    senderRecipient ||
    sharedOfficeRecipient

  if (!recipient) {
    console.error(
      "Field email receipt skipped: no valid sender or office recipient"
    )

    return {
      ok: false,
      skipped: true,
      reason: "missing_field_email_receipt_recipient",
    }
  }

  const ccRecipient =
    senderRecipient &&
    sharedOfficeRecipient &&
    senderRecipient !== sharedOfficeRecipient
      ? sharedOfficeRecipient
      : null

  const symbol =
    params.success ? "✅" : "❌"

  const headline =
    params.success
      ? "Navigator Field Update Complete"
      : "Navigator Field Update Not Completed"

  const subject =
    `${symbol} ${headline}: ${params.subjectAddress}`

  const body = params.success
    ? [
        `${symbol} Navigator Field Update Complete`,
        "",
        `Property: ${
          params.job?.address1 ||
          params.subjectAddress
        }`,
        params.job?.city
          ? `City: ${params.job.city}`
          : null,
        `Navigator Job: #${params.job?.id}`,
        params.job?.customer_name
          ? `Customer: ${params.job.customer_name}`
          : null,
        `Sent by: ${
          senderRecipient ||
          params.sender ||
          "Unknown sender"
        }`,
        `Note added: ${
          params.noteAdded ? "Yes" : "No"
        }`,
        `Photos uploaded: ${Number(
          params.importedCount || 0
        )}`,
        "",
        "The field update is now available in Navigator.",
      ]
        .filter(Boolean)
        .join("\n")
    : [
        `${symbol} Navigator Field Update Not Completed`,
        "",
        `Subject / Property: ${params.subjectAddress}`,
        `Sent by: ${
          senderRecipient ||
          params.sender ||
          "Unknown sender"
        }`,
        `Reason: ${
          params.reason ||
          "Navigator could not safely complete the field update."
        }`,
        "",
        "No new Navigator job was created.",
        "Navigator did not guess at a different job.",
      ].join("\n")

  return await sendAlertEmail(
    recipient,
    subject,
    body,
    ccRecipient
      ? {
          cc: ccRecipient,
        }
      : undefined
  )
}

async function retrieveReceivedEmailFromResend(
  email: any
) {
  const emailId = extractReceivedEmailId(email)

  if (!emailId) {
    return null
  }

  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    return null
  }

  const response = await fetch(
    `https://api.resend.com/emails/receiving/${emailId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  )

  if (!response.ok) {
    console.error(
      "Sales intake received email fetch failed",
      {
        emailId,
        status: response.status,
        statusText: response.statusText,
      }
    )

    return null
  }

  return await response.json()
}

function firstMatch(
  text: string,
  patterns: RegExp[]
): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern)

    if (match?.[1]) {
      return clean(match[1])
    }
  }

  return null
}

function textLines(text: string): string[] {
  return String(text || "")
    .replace(/<mailto:[^>]+>/gi, "")
    .replace(/mailto:/gi, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

const SALES_FIELD_LABEL_PATTERN =
  "(?:customer name|client name|homeowner name|contact name|name|" +
  "customer phone|client phone|homeowner phone|contact phone|phone|cell|" +
  "customer email|client email|homeowner email|contact email|email|" +
  "property address|service address|job address|customer address|address|" +
  "city|state|zip|postal code|" +
  "request|service requested|work requested|notes|comments|message|description|" +
  "source|stage)"

function normalizeSalesFieldBoundaries(text: string): string {
  const value = String(text || "")

  return value
    .replace(
      new RegExp(
        `\\s*(?:,|/|\\|)?\\s+(?=${SALES_FIELD_LABEL_PATTERN}\\s*[:#-])`,
        "gi"
      ),
      "\n"
    )
    .replace(
      new RegExp(
        `([^\\n])\\s+(?=${SALES_FIELD_LABEL_PATTERN}\\s*[:#-])`,
        "gi"
      ),
      "$1\n"
    )
}

function extractLabeledValue(
  text: string,
  labels: string
): string | null {
  const normalized = normalizeSalesFieldBoundaries(text)

  const match = normalized.match(
    new RegExp(
      `(?:${labels})\\s*[:#-]\\s*([^\\n\\r,|/]+)`,
      "i"
    )
  )

  return clean(match?.[1])
}

function normalizeUsPhone(value: string | null): string | null {
  if (!value) return null

  const digits = value.replace(/\D/g, "")

  if (digits.length === 10) {
    return digits
  }

  if (
    digits.length === 11 &&
    digits.startsWith("1")
  ) {
    return digits.slice(1)
  }

  return null
}

function extractPhone(text: string): string | null {
  const labeled = extractLabeledValue(
    text,
    "customer phone|client phone|homeowner phone|contact phone|phone|cell"
  )

  const normalizedLabeled =
    normalizeUsPhone(labeled)

  if (normalizedLabeled) {
    return normalizedLabeled
  }

  const match = text.match(
    /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/
  )

  return normalizeUsPhone(
    match ? match[0] : null
  )
}

function isInternalG2GEmail(
  value: string | null
): boolean {
  return Boolean(
    value &&
      /@g2groofing\.com$/i.test(value)
  )
}

function extractExternalEmail(
  text: string
): string | null {
  const labeled = firstMatch(text, [
    /(?:customer email|client email|homeowner email|contact email|email)\s*[:#-]\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
  ])

  if (
    labeled &&
    !isInternalG2GEmail(labeled)
  ) {
    return labeled
  }

  const matches =
    text.match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
    ) || []

  for (const match of matches) {
    const candidate = clean(match)

    if (
      candidate &&
      !isInternalG2GEmail(candidate) &&
      !/resend\.(com|dev)$/i.test(candidate)
    ) {
      return candidate
    }
  }

  return null
}

function extractForwardedSenderName(
  text: string
): string | null {
  return (
    extractLabeledValue(
      text,
      "customer name|client name|homeowner name|contact name|name"
    ) ||
    firstMatch(text, [
      /from:\s*"?([^"<\n\r]+)"?\s*<[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}>/i,
    ])
  )
}

function extractProperty(text: string) {
  const normalizedText =
    normalizeSalesFieldBoundaries(text)

  const explicitAddress =
    extractLabeledValue(
      normalizedText,
      "property address|service address|job address|customer address|address"
    )

  const explicitCity =
    extractLabeledValue(
      normalizedText,
      "city"
    )

  const explicitState =
    extractLabeledValue(
      normalizedText,
      "state"
    )

  const explicitZip =
    extractLabeledValue(
      normalizedText,
      "zip|postal code"
    )

  if (explicitAddress) {
    const oneLineMatch = explicitAddress.match(
      /^(.+?),\s*([^,]+),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i
    )

    if (oneLineMatch) {
      return {
        address1: clean(oneLineMatch[1]),
        city: clean(oneLineMatch[2]),
        state: clean(oneLineMatch[3]),
        zip: clean(oneLineMatch[4]),
      }
    }

    return {
      address1: explicitAddress,
      city: explicitCity,
      state: explicitState || "FL",
      zip: explicitZip,
    }
  }

  const lines = textLines(text)

  for (
    let index = 0;
    index < lines.length - 1;
    index += 1
  ) {
    const street = lines[index]
    const locality = lines[index + 1]

    if (
      /^\d+\s+.+/.test(street) &&
      /^.+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/i.test(
        locality
      )
    ) {
      const localityMatch = locality.match(
        /^(.+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i
      )

      return {
        address1: clean(street),
        city: clean(localityMatch?.[1]),
        state:
          clean(localityMatch?.[2]) ||
          "FL",
        zip: clean(localityMatch?.[3]),
      }
    }
  }

  const oneLine = text.match(
    /(\d+\s+[^\n\r,]+),\s*([^,\n\r]+),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/i
  )

  return {
    address1: clean(oneLine?.[1]),
    city: clean(oneLine?.[2]),
    state: clean(oneLine?.[3]) || "FL",
    zip: clean(oneLine?.[4]),
  }
}

function parseSalesEmail(text: string) {
  return parseUniversalIntake(text)
}

function hasAutoCreateSubject(
  subject: string
): boolean {
  return /\b(auto job create|auto create|manual entry)\b/i.test(
    subject
  )
}

async function getTenantId(): Promise<number> {
  const result = await pool.query(
    `
      select id
      from tenants
      where slug = $1
      limit 1
    `,
    [TENANT_SLUG]
  )

  if (!result.rowCount) {
    throw new Error(
      `Tenant not found: ${TENANT_SLUG}`
    )
  }

  return Number(result.rows[0].id)
}

async function findPreviouslyProcessedEmail(
  tenantId: number,
  externalReference: string
) {
  const result = await pool.query(
    `
      select job_id
      from timeline_events
      where tenant_id = $1
        and kind in (
          'business_development_intake',
          'field_photo_email_import'
        )
        and meta ->> 'external_reference' = $2
      order by id desc
      limit 1
    `,
    [
      tenantId,
      externalReference,
    ]
  )

  return result.rowCount
    ? Number(result.rows[0].job_id)
    : null
}

export async function registerSalesEmailIntakeRoutes(
  app: FastifyInstance
) {
  app.post(
    "/webhooks/resend/sales-intake",
    {
      config: {
        rawBody: true,
      },
    },
    async (request: any, reply) => {
      try {
        const signingSecret =
          process.env.RESEND_SALES_WEBHOOK_SECRET ||
          ""

        if (!signingSecret) {
          reply.code(503)

          return {
            ok: false,
            error:
              "RESEND_SALES_WEBHOOK_SECRET is not configured",
          }
        }

        const rawPayload =
          typeof request.rawBody === "string"
            ? request.rawBody
            : Buffer.isBuffer(request.rawBody)
              ? request.rawBody.toString("utf8")
              : ""

        if (!rawPayload) {
          reply.code(400)

          return {
            ok: false,
            error: "Raw webhook payload unavailable",
          }
        }

        const svixId =
          String(request.headers["svix-id"] || "")

        const svixTimestamp =
          String(
            request.headers["svix-timestamp"] || ""
          )

        const svixSignature =
          String(
            request.headers["svix-signature"] || ""
          )

        if (
          !svixId ||
          !svixTimestamp ||
          !svixSignature
        ) {
          reply.code(401)

          return {
            ok: false,
            error:
              "Missing Resend webhook signature headers",
          }
        }

        let webhookPayload: any

        try {
          const webhook = new Webhook(
            signingSecret
          )

          webhookPayload = webhook.verify(
            rawPayload,
            {
              "svix-id": svixId,
              "svix-timestamp":
                svixTimestamp,
              "svix-signature":
                svixSignature,
            }
          )
        } catch {
          reply.code(401)

          return {
            ok: false,
            error:
              "Invalid Resend webhook signature",
          }
        }

        if (
          webhookPayload?.type !==
          "email.received"
        ) {
          return {
            ok: true,
            ignored: true,
            reason:
              "Unsupported Resend webhook event",
          }
        }

        const initialPayload =
          readTextPayload(webhookPayload)

        const receivedEmail =
          await retrieveReceivedEmailFromResend(
            initialPayload.raw
          )

        const parsedPayload =
          receivedEmail
            ? readTextPayload({
                data: receivedEmail,
              })
            : initialPayload

        if (
          parsedPayload.to &&
          !parsedPayload.to
            .toLowerCase()
            .includes(
              INBOUND_ADDRESS.toLowerCase()
            )
        ) {
          return {
            ok: true,
            ignored: true,
            reason:
              "Email was not addressed to the sales intake mailbox",
          }
        }

        const externalReference =
          clean(
            receivedEmail?.id ||
              initialPayload.raw?.email_id ||
              initialPayload.raw?.id
          )

        const tenantId =
          await getTenantId()

        if (externalReference) {
          const priorJobId =
            await findPreviouslyProcessedEmail(
              tenantId,
              externalReference
            )

          if (priorJobId) {
            return {
              ok: true,
              duplicate: true,
              job_id: priorJobId,
            }
          }
        }

        const senderEmail =
          extractEmailAddress(
            parsedPayload.from
          )

        const fieldEmailSubject =
          looksLikeFieldPhotoAddressSubject(
            parsedPayload.subject
          )

        if (
          senderEmail &&
          fieldEmailSubject
        ) {
          const subjectProperty =
            parseFieldPhotoSubject(
              parsedPayload.subject
            )

          if (!subjectProperty.address1) {
            await sendFieldEmailReceipt({
              sender: parsedPayload.from,
              success: false,
              subjectAddress:
                parsedPayload.subject,
              reason:
                "Navigator could not identify a property address from the subject line.",
            })

            return {
              ok: true,
              field_email_intake: true,
              success: false,
              reason:
                "subject_address_not_parsed",
            }
          }

          const matchResult =
            await findUniqueFieldPhotoJob({
              tenantId,
              address1:
                subjectProperty.address1,
              city:
                subjectProperty.city,
              zip:
                subjectProperty.zip,
            })

          if (!matchResult.job) {
            const reason =
              matchResult.matches.length === 0
                ? "No existing active Navigator job matched that address."
                : `More than one active Navigator job matched that address (${matchResult.matches.length} matches).`

            await sendFieldEmailReceipt({
              sender: parsedPayload.from,
              success: false,
              subjectAddress:
                parsedPayload.subject,
              reason,
            })

            console.warn(
              "FIELD_EMAIL_NOT_MATCHED",
              JSON.stringify({
                subject:
                  parsedPayload.subject,
                sender:
                  senderEmail,
                match_count:
                  matchResult.matches.length,
              })
            )

            return {
              ok: true,
              field_email_intake: true,
              success: false,
              reason:
                matchResult.matches.length === 0
                  ? "no_existing_job_match"
                  : "ambiguous_existing_job_match",
              match_count:
                matchResult.matches.length,
            }
          }

          const job =
            matchResult.job

          const fieldNote =
            extractFieldEmailNote(
              receivedEmail ||
              initialPayload.raw,
              parsedPayload.subject
            )

          const emailId =
            extractReceivedEmailId(
              receivedEmail ||
              initialPayload.raw
            )

          let listedAttachments:
            ResendReceivedAttachment[] = []

          let attachmentListError:
            string | null = null

          if (emailId) {
            try {
              listedAttachments =
                await listReceivedEmailAttachments(
                  emailId
                )
            } catch (error: any) {
              attachmentListError =
                error?.message ||
                String(error)
            }
          }

          const fieldPhotos =
            listedAttachments.filter(
              (attachment) =>
                isFieldPhotoAttachment(
                  attachment
                )
            )

          if (
            !fieldNote &&
            fieldPhotos.length === 0
          ) {
            await sendFieldEmailReceipt({
              sender: parsedPayload.from,
              success: false,
              subjectAddress:
                parsedPayload.subject,
              job,
              reason:
                attachmentListError ||
                "No field note text or qualifying JPEG photos were found in the email.",
            })

            return {
              ok: true,
              field_email_intake: true,
              success: false,
              job_id:
                Number(job.id),
              reason:
                "no_field_content",
            }
          }

          let noteAdded = false

          if (fieldNote) {
            await pool.query(
              `
              insert into timeline_events
                (
                  tenant_id,
                  job_id,
                  kind,
                  message,
                  meta,
                  created_at
                )
              values
                (
                  $1,
                  $2,
                  'staff_note',
                  $3,
                  $4::jsonb,
                  now()
                )
              `,
              [
                tenantId,
                Number(job.id),
                fieldNote,
                JSON.stringify({
                  author:
                    senderEmail,
                  author_email:
                    senderEmail,
                  source:
                    "field_email",
                  external_reference:
                    externalReference,
                }),
              ]
            )

            noteAdded = true
          }

          let importResult = {
            attempted: 0,
            imported: [] as Array<any>,
            failed: [] as Array<any>,
          }

          if (
            emailId &&
            fieldPhotos.length > 0
          ) {
            importResult =
              await importFieldPhotoAttachments({
                emailId,
                jobId:
                  Number(job.id),
                sender:
                  senderEmail,
              })
          }

          const photosComplete =
            importResult.failed.length === 0 &&
            importResult.imported.length ===
              importResult.attempted

          const complete =
            !attachmentListError &&
            photosComplete &&
            (
              noteAdded ||
              importResult.imported.length > 0
            )

          await pool.query(
            `
            insert into timeline_events
              (
                tenant_id,
                job_id,
                kind,
                message,
                meta,
                created_at
              )
            values
              (
                $1,
                $2,
                'field_photo_email_import',
                $3,
                $4::jsonb,
                now()
              )
            `,
            [
              tenantId,
              Number(job.id),
              complete
                ? `Field update received by email from ${senderEmail}.`
                : `Field email partially processed from ${senderEmail}.`,
              JSON.stringify({
                external_reference:
                  externalReference,
                sender:
                  senderEmail,
                subject:
                  parsedPayload.subject,
                note_added:
                  noteAdded,
                attempted:
                  importResult.attempted,
                imported:
                  importResult.imported.length,
                failed:
                  importResult.failed.length,
                attachment_list_error:
                  attachmentListError,
              }),
            ]
          )

          const failureReason =
            complete
              ? null
              : attachmentListError
                ? `The note was ${
                    noteAdded ? "added" : "not added"
                  }, but Navigator could not read the email attachments: ${attachmentListError}`
                : `${importResult.imported.length} photo(s) uploaded and ${importResult.failed.length} failed. Office review is required.`

          await sendFieldEmailReceipt({
            sender:
              parsedPayload.from,
            success:
              complete,
            subjectAddress:
              parsedPayload.subject,
            job,
            noteAdded,
            importedCount:
              importResult.imported.length,
            failedCount:
              importResult.failed.length,
            reason:
              failureReason,
          })

          console.log(
            complete
              ? "✅ FIELD_EMAIL_COMPLETE"
              : "❌ FIELD_EMAIL_INCOMPLETE",
            JSON.stringify({
              job_id:
                Number(job.id),
              subject:
                parsedPayload.subject,
              sender:
                senderEmail,
              note_added:
                noteAdded,
              attempted:
                importResult.attempted,
              imported:
                importResult.imported.length,
              failed:
                importResult.failed.length,
            })
          )

          return {
            ok: true,
            field_email_intake: true,
            success:
              complete,
            job_id:
              Number(job.id),
            note_added:
              noteAdded,
            attempted:
              importResult.attempted,
            imported:
              importResult.imported.length,
            failed:
              importResult.failed.length,
          }
        }

        console.log("\n========== RAW SALES EMAIL ==========\n")
        console.log(parsedPayload.text)
        console.log("\n========== NORMALIZED SALES EMAIL ==========\n")
        console.log(normalizeSalesFieldBoundaries(parsedPayload.text))
        console.log("\n=====================================\n")

        const parsed = parseSalesEmail(parsedPayload.text)

        const customerName =
          parsed.customerName ||
          "Unknown Customer"

        if (
          !parsed.customerPhone &&
          !parsed.customerEmail &&
          !parsed.address1
        ) {
          reply.code(400)

          return {
            ok: false,
            error:
              "No customer phone, email, or property address could be parsed",
            parsed,
          }
        }

        const result =
          await processBusinessDevelopmentIntake({
            tenantSlug: TENANT_SLUG,
            source: "manual_office_email",
            sourceDetail:
              parsedPayload.subject ||
              "Direct Forward to Navigator Intake",
            customerName,
            customerPhone:
              parsed.customerPhone,
            customerEmail:
              parsed.customerEmail,
            address1:
              parsed.address1,
            city:
              parsed.city,
            state:
              parsed.state,
            zip:
              parsed.zip,
            carrier:
              parsed.carrier,
            claimNumber:
              parsed.claimNumber,
            notes: [
              `Forwarded sales email from ${parsedPayload.from || "unknown sender"}.`,
              parsed.notes,
            ]
              .filter(Boolean)
              .join("\n\n"),
            externalReference,
            suppressStaffNotification: true,
          })

        const attachmentImport =
          await importReceivedEmailAttachments({
            emailId:
              extractReceivedEmailId(
                receivedEmail ||
                  initialPayload.raw
              ),
            emailText: parsedPayload.text,
            jobId: Number(result.job_id),
          })

        if (
          attachmentImport.skipped.length ||
          attachmentImport.failed.length
        ) {
          console.warn(
            "SALES_EMAIL_ATTACHMENT_IMPORT_INCOMPLETE",
            JSON.stringify({
              job_id: result.job_id,
              attachment_import: attachmentImport,
            })
          )
        }

        const customerEmailAcknowledgment =
          parsed.customerEmail
            ? await queueInitialExternalResponse({
                tenantId:
                  Number(result.tenant_id),
                jobId:
                  Number(result.job_id),
                kind:
                  "sales_customer_acknowledgment",
                payload: {
                  customer_email:
                    parsed.customerEmail,
                  customer_name:
                    customerName,
                  property_address: [
                    parsed.address1,
                    parsed.city,
                    parsed.state,
                    parsed.zip,
                  ]
                    .filter(Boolean)
                    .join(", "),
                  source_detail:
                    parsedPayload.subject,
                  source:
                    "sales_email_intake",
                },
              })
            : {
                ok: false,
                skipped: true,
                reason:
                  "missing_customer_email",
              }

        const officeCompletionReceipt =
          await sendAdministrativeIntakeCompletionEmail({
            result,
            parsed,
            subject: parsedPayload.subject,
            sender: parsedPayload.from,
            attachmentImport,
            customerEmailAcknowledgment,
          })

        console.log(
          "SALES_EMAIL_INTAKE_PROCESSED",
          JSON.stringify({
            subject:
              parsedPayload.subject,
            from:
              parsedPayload.from,
            to:
              parsedPayload.to,
            external_reference:
              externalReference,
            parsed,
            result,
            attachment_import:
              attachmentImport,
            customer_email_acknowledgment:
              customerEmailAcknowledgment,
            office_completion_receipt:
              officeCompletionReceipt,
          })
        )

        return {
          ...result,
          parsed,
          attachment_import:
            attachmentImport,
          customer_email_acknowledgment:
            customerEmailAcknowledgment,
          office_completion_receipt:
            officeCompletionReceipt,
        }
      } catch (error: any) {
        console.error(
          "Sales email intake failed",
          error
        )

        reply.code(400)

        return {
          ok: false,
          error:
            error?.message ||
            String(error),
        }
      }
    }
  )
}

export default registerSalesEmailIntakeRoutes
