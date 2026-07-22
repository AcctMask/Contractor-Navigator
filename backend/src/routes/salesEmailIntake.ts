import type { FastifyInstance } from "fastify"
import { Webhook } from "svix"
import { pool } from "../db/db"
import {
  processBusinessDevelopmentIntake,
} from "../services/businessDevelopmentIntakeService"
import {
  sendCustomerAcknowledgmentEmail,
} from "../services/emailService"
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
      String(attachment.content_disposition || "").toLowerCase() !==
        "inline" &&
      !attachment.content_id
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
        and kind = 'business_development_intake'
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
            notes: [
              `Forwarded sales email from ${parsedPayload.from || "unknown sender"}.`,
              parsed.notes,
            ]
              .filter(Boolean)
              .join("\n\n"),
            externalReference,
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
            ? await sendCustomerAcknowledgmentEmail(
                parsed.customerEmail,
                customerName,
                {
                  propertyAddress: [
                    parsed.address1,
                    parsed.city,
                    parsed.state,
                    parsed.zip,
                  ]
                    .filter(Boolean)
                    .join(", "),
                  sourceDetail:
                    parsedPayload.subject,
                }
              )
            : {
                ok: false,
                skipped: true,
                reason:
                  "missing_customer_email",
              }

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
          })
        )

        return {
          ...result,
          parsed,
          attachment_import:
            attachmentImport,
          customer_email_acknowledgment:
            customerEmailAcknowledgment,
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
