import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { createLeadFromInboundCallByTenantSlug } from "../services/followupEngine"
import {
  createDocumentPackageByTenantSlug,
  sendDocumentPackage,
  upsertEstimateDetailsByTenantSlug,
} from "../services/documentPipelineService"

const TENANT_SLUG = "g2g-roofing"
const INBOUND_ADDRESS = "admin@g2groofing.com"

function stripHtml(value: string) {
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
  const email = body?.data || body?.email || body?.payload || body || {}

  const subject = String(email.subject || body?.subject || "").trim()
  const from =
    typeof email.from === "string"
      ? email.from
      : email.from?.email || email.from?.address || body?.from || ""

  const to =
    typeof email.to === "string"
      ? email.to
      : Array.isArray(email.to)
        ? email.to.map((x: any) => x?.email || x?.address || x).join(", ")
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

  const combined = [subject, text, stripHtml(html)].filter(Boolean).join("\n")

  return {
    subject,
    from: String(from || ""),
    to: String(to || ""),
    text: combined,
    raw: email,
  }
}

async function retrieveReceivedEmailFromResend(email: any) {
  const emailId =
    email?.email_id ||
    email?.id ||
    email?.emailId ||
    email?.data?.email_id ||
    email?.data?.id

  if (!emailId) return null

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null

  const response = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    console.error("Resend received email fetch failed", {
      emailId,
      status: response.status,
      statusText: response.statusText,
    })
    return null
  }

  return await response.json()
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim().replace(/\s+/g, " ")
  }
  return null
}

function extractPhone(text: string) {
  const match = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)
  return match ? match[0].trim() : null
}

function extractEmail(text: string) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match ? match[0].trim() : null
}

function cleanParsedValue(value: string | null) {
  if (!value) return null

  return String(value)
    .replace(/<mailto:[^>]+>/gi, "")
    .replace(/mailto:/gi, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function textLines(text: string) {
  return String(text || "")
    .replace(/<mailto:[^>]+>/gi, "")
    .replace(/mailto:/gi, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function extractCarrierClaimFromSubject(text: string) {
  const match = text.match(/(?:subject:\s*)?(?:fwd:\s*)?([A-Z][A-Z0-9 &.'-]+?)\s+claim\s+([A-Z0-9\-_.]+)/i)

  if (!match) {
    return { carrier: null, claimNumber: null }
  }

  return {
    carrier: cleanParsedValue(match[1]),
    claimNumber: cleanParsedValue(match[2]),
  }
}

function extractCarrierFromSubjectOnly(text: string) {
  return firstMatch(text, [
    /subject:\s*(?:re:\s*|fwd:\s*)?([A-Z][A-Z0-9 &.'-]+?)(?:\s+claim\s+[A-Z0-9\-_.]+)?$/im,
  ])
}

function extractAddressBlock(text: string) {
  const lines = textLines(text)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1] || ""

    const looksLikeStreet = /^\d+\s+.+/.test(line)
    const looksLikeCityStateZip = /,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/i.test(next)

    if (looksLikeStreet && looksLikeCityStateZip) {
      const customerName = i > 0 ? cleanParsedValue(lines[i - 1]) : null
      return {
        customerName,
        propertyAddress: cleanParsedValue(`${line} ${next}`),
      }
    }
  }

  return { customerName: null, propertyAddress: null }
}

function extractAdjusterDetails(text: string) {
  const lines = textLines(text)
  const fromEmail = firstMatch(text, [/from:\s*.*?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i])

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (/(adjuster|claims examiner|claim examiner|claims rep|claim rep)/i.test(line)) {
      const before = lines.slice(Math.max(0, i - 6), i)
      const after = lines.slice(i + 1, i + 6)
      const block = lines.slice(Math.max(0, i - 6), i + 8).join("\n")

      const personName =
        [...before].reverse().find((candidate) =>
          /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(candidate) &&
          !/license|appt|claim|examiner|adjusting|insurance|phone|email/i.test(candidate)
        ) || null

      const companyName =
        after.find((candidate) =>
          /adjusting|claims|services/i.test(candidate) &&
          !/license|phone|email|examiner/i.test(candidate)
        ) || null

      return {
        adjusterName: cleanParsedValue(
          companyName && personName ? `${companyName} / ${personName}` : personName || companyName
        ),
        adjusterPhone: extractPhone(block),
        adjusterEmail: cleanParsedValue(fromEmail) || extractEmail(block),
      }
    }
  }

  return {
    adjusterName: null,
    adjusterPhone: null,
    adjusterEmail: cleanParsedValue(fromEmail),
  }
}

function extractLossType(text: string) {
  return firstMatch(text, [
    /(?:loss type|type of loss|cause of loss|COL)\s*[:#-]\s*([^\n\r]+)/i,
  ])
}

function extractLossDate(text: string) {
  return firstMatch(text, [
    /(?:date of loss|loss date|DOL)\s*[:#-]\s*([^\n\r]+)/i,
  ])
}

function extractDirectTarpNarrative(text: string) {
  const lines = textLines(text)
  const addressBlock = extractAddressBlock(text)
  const customerLineIndex = addressBlock.customerName
    ? lines.findIndex((line) => line === addressBlock.customerName)
    : -1

  const windowLines = customerLineIndex > 0 ? lines.slice(0, customerLineIndex) : lines

  const useful = windowLines.filter((line) => {
    if (/^(begin forwarded message|from:|subject:|date:|to:|good morning|best regards)/i.test(line)) return false
    return /(tarp|tarped|board up|board-up|water intrusion|leak|leaking|damage|emergency|immediate|immediately)/i.test(line)
  })

  return cleanParsedValue(useful.join(" "))
}

function extractNarrativeNotes(text: string) {
  const explicit = firstMatch(text, [
    /(?:notes|comments|loss description|damage description|description|special instructions|report|statement)\s*[:#-]\s*([^\n\r]+)/i,
  ])

  if (explicit) return explicit

  const lines = textLines(text)
  const addressBlock = extractAddressBlock(text)
  const customerLineIndex = addressBlock.customerName
    ? lines.findIndex((line) => line === addressBlock.customerName)
    : -1

  const narrativeWindow =
    customerLineIndex > 0
      ? lines.slice(0, customerLineIndex)
      : lines

  const usefulLines = narrativeWindow.filter((line) => {
    if (/^(begin forwarded message|from:|subject:|date:|to:|good morning|best regards|phone:|email:|dol:|col:)/i.test(line)) return false
    if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(line)) return false
    if (/^\d+\s+/.test(line)) return false
    if (/,\s*[A-Z]{2}\s+\d{5}/i.test(line)) return false
    if (/\b(license|claims examiner|adjusting)\b/i.test(line)) return false

    return /(tarp|tarped|board up|board-up|water intrusion|leak|leaking|damage|emergency|immediate|immediately|wind|water|fire|storm)/i.test(line)
  })

  return cleanParsedValue(usefulLines.join(" "))
}

function extractServiceType(text: string) {
  if (/\b(board up|board-up|boarding)\b/i.test(text)) return "Board Up"
  if (/\b(emergency tarp|roof tarp|tarped|tarp)\b/i.test(text)) return "Emergency Tarp"
  return null
}

function isInternalG2GEmail(value: string | null) {
  if (!value) return false
  return /@(g2groofing\.com)$/i.test(value)
}

function parseClaimsEmail(text: string) {
  const subjectCarrierClaim = extractCarrierClaimFromSubject(text)
  const addressBlock = extractAddressBlock(text)
  const adjusterDetails = extractAdjusterDetails(text)

  const carrier =
    subjectCarrierClaim.carrier ||
    cleanParsedValue(extractCarrierFromSubjectOnly(text)) ||
    firstMatch(text, [
      /(?:insurance company|insurer|carrier|insurance carrier)\s*[:#-]\s*([^\n\r]+)/i,
    ])

  const claimNumber =
    firstMatch(text, [
      /claim\s*(?:number|#|no\.?)?\s*[:#-]\s*([A-Z0-9\-_.]+)/i,
    ]) || subjectCarrierClaim.claimNumber

  const customerName =
    firstMatch(text, [
      /(?:homeowner name|homeowner|insured name|insured|customer name|customer|policyholder|policy holder)\s*[:#-]\s*([^\n\r]+)/i,
    ]) || addressBlock.customerName

  const address =
    firstMatch(text, [
      /(?:property address|loss location|risk address|service address|address)\s*[:#-]\s*([^\n\r]+)/i,
    ]) || addressBlock.propertyAddress

  const customerPhone =
    firstMatch(text, [
      /(?:primary phone|customer phone|homeowner phone|insured phone|phone|cell)\s*[:#-]\s*([^\n\r]+)/i,
    ]) || extractPhone(text)

  const foundCustomerEmail =
    firstMatch(text, [
      /(?:customer email|homeowner email|insured email|email)\s*[:#-]\s*([^\n\r]+)/i,
    ]) || extractEmail(text)

  const customerEmail = isInternalG2GEmail(cleanParsedValue(foundCustomerEmail))
    ? null
    : foundCustomerEmail

  const adjusterName =
    firstMatch(text, [
      /(?:adjuster name|desk adjuster|field adjuster|adjuster|claims examiner|claim examiner)\s*[:#-]\s*([^\n\r]+)/i,
    ]) || adjusterDetails.adjusterName

  const adjusterPhone =
    firstMatch(text, [
      /(?:adjuster phone|adjuster cell|desk adjuster phone|field adjuster phone)\s*[:#-]\s*([^\n\r]+)/i,
    ]) || adjusterDetails.adjusterPhone

  const adjusterEmail =
    firstMatch(text, [
      /(?:adjuster email|desk adjuster email|field adjuster email)\s*[:#-]\s*([^\n\r]+)/i,
    ]) || adjusterDetails.adjusterEmail

  const emergencySqft = firstMatch(text, [
    /(?:tarp sqft|tarp square feet|emergency tarp sqft)\s*[:#-]\s*(\d+)/i,
  ])

  const serviceType = extractServiceType(text)
  const lossType = extractLossType(text)
  const lossDate = extractLossDate(text)
  const narrativeNotes = extractDirectTarpNarrative(text) || extractNarrativeNotes(text)

  const notes = cleanParsedValue(
    [
      serviceType ? `Service Requested: ${serviceType}` : null,
      lossDate ? `Date of Loss: ${lossDate}` : null,
      lossType ? `Cause of Loss: ${lossType}` : null,
      narrativeNotes ? `Notes: ${narrativeNotes}` : null,
    ]
      .filter(Boolean)
      .join(" | ")
  )

  return {
    carrier: cleanParsedValue(carrier),
    claimNumber: cleanParsedValue(claimNumber),
    customerName: cleanParsedValue(customerName),
    propertyAddress: cleanParsedValue(address),
    customerPhone: cleanParsedValue(customerPhone),
    customerEmail: cleanParsedValue(customerEmail),
    adjusterName: cleanParsedValue(adjusterName),
    adjusterPhone: cleanParsedValue(adjusterPhone),
    adjusterEmail: cleanParsedValue(adjusterEmail),
    notes,
    serviceType,
    lossType,
    lossDate,
    emergencySqft: emergencySqft ? Number(emergencySqft) : null,
  }
}

async function addTimelineEvent(
  tenantId: number,
  jobId: number,
  kind: string,
  message: string,
  meta: Record<string, unknown> = {}
) {
  await pool.query(
    `
    insert into timeline_events
      (tenant_id, job_id, kind, message, meta, created_at)
    values
      ($1, $2, $3, $4, $5::jsonb, now())
    `,
    [tenantId, jobId, kind, message, JSON.stringify(meta)]
  )
}

async function getTenantIdBySlug(slug: string) {
  const result = await pool.query(`select id from tenants where slug = $1 limit 1`, [slug])
  if (!result.rowCount) throw new Error(`Tenant not found: ${slug}`)
  return Number(result.rows[0].id)
}

export async function registerClaimsEmailIntakeRoutes(app: FastifyInstance) {
  app.post("/webhooks/resend/claims-intake", async (request: any, reply) => {
    const secret = process.env.CLAIMS_INBOUND_SECRET || ""
    const provided =
      String(request.headers["x-claims-inbound-secret"] || "") ||
      String((request.query || {}).secret || "")

    if (secret && provided !== secret) {
      reply.code(401)
      return { ok: false, error: "Unauthorized" }
    }

    try {
      const webhookPayload = request.body || {}
      const initialPayload = readTextPayload(webhookPayload)
      const receivedEmail = await retrieveReceivedEmailFromResend(initialPayload.raw)
      const parsedPayload = receivedEmail
        ? readTextPayload({ data: receivedEmail })
        : initialPayload
      const parsed = parseClaimsEmail(parsedPayload.text)

      console.log("EMS_INTAKE_PARSE_DEBUG_JSON", JSON.stringify({
        subject: parsedPayload.subject,
        from: parsedPayload.from,
        text_preview: parsedPayload.text.slice(0, 2000),
        parsed,
      }))

      const customerName = parsed.customerName || "EMS Tarp Customer"
      const carrier = parsed.carrier || "Unknown Carrier"
      const claimNumber = parsed.claimNumber || null

      const created = await createLeadFromInboundCallByTenantSlug(TENANT_SLUG, {
        callerPhone: parsed.customerPhone,
        callerName: customerName,
        notes: `EMS tarp assessment email received from ${parsedPayload.from || "unknown sender"}.`,
        source: carrier,
      })

      const tenantId = await getTenantIdBySlug(TENANT_SLUG)
      const jobId = Number(created.job_id)

      await pool.query(
        `
        update jobs
        set
          job_type = 'TARP',
          stage = 'tarp',
          crm_substatus = 'ems_authorization_requested',
          crm_flow_key = 'ems_tarp_email_intake',
          address1 = coalesce($3, address1),
          claim_number = coalesce($4, claim_number),
          carrier = coalesce($5, carrier),
          lead_source = coalesce($5, lead_source),
          lead_source_detail = $6,
          adjuster_name = coalesce($7, adjuster_name),
          adjuster_phone = coalesce($8, adjuster_phone),
          adjuster_email = coalesce($9, adjuster_email),
          assignment_notes = coalesce($10, assignment_notes),
          damage_summary = coalesce($11, damage_summary),
          updated_at = now()
        where tenant_id = $1
          and id = $2
        `,
        [
          tenantId,
          jobId,
          parsed.propertyAddress,
          claimNumber,
          carrier,
          `${INBOUND_ADDRESS} inbound assessment email`,
          parsed.adjusterName,
          parsed.adjusterPhone,
          parsed.adjusterEmail,
          parsed.notes,
          parsed.lossType,
        ]
      )

      if (parsed.customerEmail) {
        await pool.query(
          `
          update customers
          set email = coalesce($3, email),
              updated_at = now()
          where tenant_id = $1
            and id = (
              select customer_id from jobs where tenant_id = $1 and id = $2 limit 1
            )
          `,
          [tenantId, jobId, parsed.customerEmail]
        )
      }

      await upsertEstimateDetailsByTenantSlug(TENANT_SLUG, jobId, {
        claim_number: claimNumber,
        emergency_tarp_needed: true,
        emergency_tarp_sqft: parsed.emergencySqft,
        estimator_remarks: `EMS tarp intake created from forwarded assessment email. Carrier/source: ${carrier}.`,
      })

      const documentPackage = await createDocumentPackageByTenantSlug(
        TENANT_SLUG,
        jobId,
        "ems_tarp"
      )

      let sendResult: any = null

      try {
        sendResult = await sendDocumentPackage(
          TENANT_SLUG,
          jobId,
          Number(documentPackage.id)
        )
      } catch (err: any) {
        sendResult = {
          ok: false,
          error: err?.message || String(err),
        }

        await addTimelineEvent(
          tenantId,
          jobId,
          "ems_tarp_package_not_sent",
          `EMS package was created but not sent automatically: ${sendResult.error}`,
          {
            source: "inbound_email",
            from: parsedPayload.from,
            subject: parsedPayload.subject,
            parsed,
            package_id: documentPackage.id,
            reason: sendResult.error,
          }
        )
      }

      await addTimelineEvent(
        tenantId,
        jobId,
        "ems_tarp_intake_notes",
        parsed.notes || `EMS tarp assessment email received from ${parsedPayload.from || "unknown sender"}.`,
        {
          source: "inbound_email",
          from: parsedPayload.from,
          subject: parsedPayload.subject,
          parsed,
        }
      )

      await addTimelineEvent(
        tenantId,
        jobId,
        "ems_tarp_email_intake_processed",
        "EMS tarp job created from inbound assessment email and work authorization sent.",
        {
          from: parsedPayload.from,
          to: parsedPayload.to,
          subject: parsedPayload.subject,
          parsed,
          package_id: documentPackage.id,
          send_result: sendResult,
          received_email_id: receivedEmail?.id || initialPayload.raw?.email_id || null,
        }
      )

      return {
        ok: true,
        job_id: jobId,
        parsed,
        document_package: documentPackage,
        send_result: sendResult,
        package_send_warning: sendResult?.ok === false ? sendResult.error : null,
      }
    } catch (err: any) {
      console.error("EMS tarp inbound email failed", err)
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })
}

export default registerClaimsEmailIntakeRoutes
