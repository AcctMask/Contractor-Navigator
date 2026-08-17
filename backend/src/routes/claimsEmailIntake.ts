import type { FastifyInstance } from "fastify"
import { Webhook } from "svix"
import { pool } from "../db/db"
import { createLeadFromInboundCallByTenantSlug } from "../services/followupEngine"
import {
  upsertEstimateDetailsByTenantSlug,
} from "../services/documentPipelineService"
import {
  queueInitialExternalResponse,
} from "../services/initialResponseGraceService"
import {
  parseUniversalIntake,
} from "../services/universalIntakeParser"
import {
  getDeveloperSettingsByTenantSlug,
} from "../services/devSettingsService"
import { sendSMS } from "../services/twilioService"
import { sendAlertEmail } from "../services/emailService"

const TENANT_SLUG = "g2g-roofing"
const INBOUND_ADDRESS = "claims@istaeriiul.resend.app"

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

function extractCarrierFromForwardedFrom(text: string) {
  const raw = firstMatch(text, [
    /^from:\s*([^\n\r@]+)$/im,
  ])

  if (!raw) return null

  return cleanParsedValue(
    raw.replace(
      /\s+-\s+(?:preferred repair|preferred contractor|managed repair).*$/i,
      ""
    )
  )
}

function normalizeLossDateForDatabase(value: string | null) {
  const cleaned = cleanParsedValue(value)

  if (!cleaned) return null

  const mdy = cleaned.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  )

  if (mdy) {
    const month = mdy[1].padStart(2, "0")
    const day = mdy[2].padStart(2, "0")
    const year = mdy[3]

    return `${year}-${month}-${day}`
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned
  }

  return null
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
  /*
   * Assignment/service recognition only.
   *
   * Keep this deliberately tolerant because carrier and TPA assignment
   * formats vary. This classifies the requested service for intake notes;
   * it does NOT independently change job stage, routing, document flow,
   * carrier, lead source, or any other proven workflow.
   */

  if (
    /\b(peer review|peer-review|peer inspection|peer assessment)\b/i.test(text)
  ) {
    return "Peer Review"
  }

  if (
    /\b(board up|board-up|boardup|boarding|board and secure|secure opening|secure openings)\b/i.test(text)
  ) {
    return "Board Up"
  }

  if (
    /\b(roof replacement|replace roof|roof replace|full roof replacement|complete roof replacement|reroof|re-roof)\b/i.test(text)
  ) {
    return "Roof Replacement"
  }

  if (
    /\b(roof repair|repair roof|roof leak repair|leak repair|temporary roof repair|permanent roof repair)\b/i.test(text)
  ) {
    return "Roof Repair"
  }

  if (
    /\b(roof inspection|property inspection|damage inspection|storm inspection|inspection only|inspect roof|roof assessment|damage assessment)\b/i.test(text)
  ) {
    return "Inspection"
  }

  if (
    /\b(emergency tarp|emergency tarping|roof tarp|roof tarping|tarp roof|tarping|tarped|tarp|temporary tarp|temporary roof covering|temporary roof cover|roof covering|roof cover|cover roof|plastic sheeting|plastic covering|plastic cover|plastic on roof|roof plastic|blue tarp|leaking roof|roof leaking|active leak|active leaking|water intrusion)\b/i.test(text)
  ) {
    return "Emergency Tarp"
  }

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
    extractCarrierFromForwardedFrom(text) ||
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
      /(?:location of property|property address|loss location|risk address|service address|address)\s*[:#-]\s*([^\n\r]+)/i,
    ]) || addressBlock.propertyAddress

  const customerPhone =
    firstMatch(text, [
      /(?:evening phone|primary phone|customer phone|homeowner phone|insured phone|phone|cell)\s*[:#-]\s*([^\n\r]+)/i,
    ]) || extractPhone(text)

  const explicitCustomerEmailField =
    firstMatch(text, [
      /(?:email address|customer email|homeowner email|insured email)\s*[:#-]\s*([^\n\r]+)/i,
    ])

  const explicitCustomerEmail =
    extractEmail(
      explicitCustomerEmailField || ""
    )

  const foundCustomerEmail =
    explicitCustomerEmail ||
    extractEmail(text)

  const customerEmail =
    explicitCustomerEmail
      ? cleanParsedValue(explicitCustomerEmail)
      : (
          isInternalG2GEmail(
            cleanParsedValue(foundCustomerEmail)
          )
            ? null
            : cleanParsedValue(foundCustomerEmail)
        )

  const adjusterName =
    firstMatch(text, [
      /(?:examiner name|adjuster name|desk adjuster|field adjuster|adjuster|claims examiner|claim examiner)\s*[:#-]\s*([^\n\r,]+)/i,
    ]) || adjusterDetails.adjusterName

  const adjusterPhoneField =
    firstMatch(text, [
      /(?:examiner phone|adjuster phone|adjuster cell|desk adjuster phone|field adjuster phone)\s*[:#-]\s*([^\n\r,]*)/i,
    ])

  const adjusterPhone =
    extractPhone(adjusterPhoneField || "") ||
    adjusterDetails.adjusterPhone

  const adjusterEmailField =
    firstMatch(text, [
      /(?:examiner email|adjuster email|desk adjuster email|field adjuster email)\s*[:#-]\s*([^\n\r,]+)/i,
    ])

  const explicitAdjusterEmail =
    extractEmail(adjusterEmailField || "")

  const adjusterEmail =
    explicitAdjusterEmail ||
    (
      isInternalG2GEmail(
        cleanParsedValue(
          adjusterDetails.adjusterEmail
        )
      )
        ? null
        : cleanParsedValue(
            adjusterDetails.adjusterEmail
          )
    )

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

  /*
   * Universal intake is a forgiveness/enrichment layer only.
   *
   * Claims-specific extraction remains authoritative.
   * Universal parsing fills only values the claims parser
   * could not reliably identify.
   *
   * This does not create a second intake path.
   */
  const universal =
    parseUniversalIntake(text)

  const universalAddress =
    [
      universal.address1,
      universal.city,
      universal.state,
      universal.zip,
    ]
      .filter(Boolean)
      .join(", ") || null

  const claimsNotes =
    cleanParsedValue(notes)

  const universalNotes =
    cleanParsedValue(universal.notes)

  const enrichedNotes =
    claimsNotes ||
    universalNotes

  const enrichedCustomerEmail =
    explicitCustomerEmailField
      ? cleanParsedValue(customerEmail)
      : (
          cleanParsedValue(customerEmail) ||
          (
            isInternalG2GEmail(
              cleanParsedValue(
                universal.customerEmail
              )
            )
              ? null
              : cleanParsedValue(
                  universal.customerEmail
                )
          )
        )

  return {
    carrier:
      cleanParsedValue(carrier) ||
      cleanParsedValue(universal.carrier),

    claimNumber:
      cleanParsedValue(claimNumber) ||
      cleanParsedValue(
        universal.claimNumber
      ),

    customerName:
      cleanParsedValue(customerName) ||
      cleanParsedValue(
        universal.customerName
      ),

    propertyAddress:
      cleanParsedValue(address) ||
      cleanParsedValue(
        universalAddress
      ),

    customerPhone:
      cleanParsedValue(customerPhone) ||
      cleanParsedValue(
        universal.customerPhone
      ),

    customerEmail:
      enrichedCustomerEmail,

    /*
     * Claims-only intelligence remains exclusively
     * controlled by the specialized claims parser.
     */
    adjusterName:
      cleanParsedValue(adjusterName),

    adjusterPhone:
      cleanParsedValue(adjusterPhone),

    adjusterEmail:
      cleanParsedValue(adjusterEmail),

    notes:
      enrichedNotes,

    serviceType,
    lossType,
    lossDate,

    emergencySqft:
      emergencySqft
        ? Number(emergencySqft)
        : null,
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
  app.post(
    "/webhooks/resend/claims-intake",
    {
      config: {
        rawBody: true,
      },
    },
    async (request: any, reply) => {
      try {
        const signingSecret =
          process.env.RESEND_CLAIMS_WEBHOOK_SECRET ||
          ""

        if (!signingSecret) {
          reply.code(503)

          return {
            ok: false,
            error:
              "RESEND_CLAIMS_WEBHOOK_SECRET is not configured",
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
          const webhook =
            new Webhook(signingSecret)

          webhookPayload =
            webhook.verify(
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

      const customerName = parsed.customerName || "Claims Assignment Customer"
      const carrier = parsed.carrier || "Unknown Carrier"
      const claimNumber = parsed.claimNumber || null
      /*
       * This endpoint is the dedicated claims@istaeriiul.resend.app EMS tarp ingress lane.
       *
       * Arrival through this route is authoritative for service classification:
       * carrier wording such as WIND, HURRICANE, STORM, or other cause-of-loss
       * language describes the claim but does not need to explicitly say "tarp".
       *
       * Existing claims parsing remains responsible for extracting customer,
       * property, carrier, claim, loss, adjuster, and narrative details.
       */
      const serviceType = "Emergency Tarp"

      /*
       * Preserve the proven EMS tarp workflow exactly for recognized
       * tarp/emergency-cover assignments.
       *
       * Other confidently recognized services use existing Navigator
       * stages where those stages already exist.
       *
       * Board Up, Peer Review, and unknown assignments remain
       * intake_pending for staff review because no dedicated proven
       * workflow currently exists for them.
       */
      const serviceRouting =
        serviceType === "Emergency Tarp"
          ? {
              jobType: "TARP",
              stage: "lead",
              crmSubstatus: "ems_authorization_pending_grace",
              crmFlowKey: "ems_tarp_email_intake",
            }
          : serviceType === "Roof Repair"
            ? {
                jobType: "ROOF REPAIR",
                stage: "roof_repair",
                crmSubstatus: "possible_roof_repair",
                crmFlowKey: "claims_email_intake",
              }
            : serviceType === "Roof Replacement"
              ? {
                  jobType: "ROOF REPLACEMENT",
                  stage: "roof_replacement",
                  crmSubstatus: null,
                  crmFlowKey: "claims_email_intake",
                }
              : serviceType === "Inspection"
                ? {
                    jobType: "INSPECTION",
                    stage: "inspection",
                    crmSubstatus: "inspection_requested",
                    crmFlowKey: "claims_email_intake",
                  }
                : serviceType === "Board Up"
                  ? {
                      jobType: "BOARD UP",
                      stage: "intake_pending",
                      crmSubstatus: null,
                      crmFlowKey: "claims_email_intake",
                    }
                  : serviceType === "Peer Review"
                    ? {
                        jobType: "PEER REVIEW",
                        stage: "intake_pending",
                        crmSubstatus: null,
                        crmFlowKey: "claims_email_intake",
                      }
                    : {
                        jobType: null,
                        stage: "intake_pending",
                        crmSubstatus: null,
                        crmFlowKey: "claims_email_intake",
                      }

      const isEmsTarp = serviceType === "Emergency Tarp"

      const created = await createLeadFromInboundCallByTenantSlug(TENANT_SLUG, {
        callerPhone: parsed.customerPhone,
        callerName: customerName,
        notes: `Claims assignment email received from ${parsedPayload.from || "unknown sender"}.`,
        source: carrier,
      })

      const tenantId = await getTenantIdBySlug(TENANT_SLUG)
      const jobId = Number(created.job_id)

      await pool.query(
        `
        update jobs
        set
          job_type = coalesce($12, job_type),
          stage = $13,
          crm_substatus = coalesce($14, crm_substatus),
          crm_flow_key = $15,
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
          date_of_loss = coalesce($16::date, date_of_loss),
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
          serviceRouting.jobType,
          serviceRouting.stage,
          serviceRouting.crmSubstatus,
          serviceRouting.crmFlowKey,
          normalizeLossDateForDatabase(
            parsed.lossDate
          ),
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

      let documentPackage: any = null
      let sendResult: any = null

      if (isEmsTarp) {
        const settings =
          await getDeveloperSettingsByTenantSlug(
            TENANT_SLUG
          )

        const alertSmsTo =
          settings.alert_sms_to ||
          process.env.ALERT_SMS_TO ||
          process.env.ESCALATION_SMS_TO ||
          process.env.TWILIO_ALERT_TO ||
          ""

        const alertEmailTo =
          process.env.G2G_GMAIL_TO ||
          settings.alert_email_to ||
          process.env.ALERT_EMAIL_TO ||
          process.env.ESCALATION_EMAIL_TO ||
          "good2goroofingandconstruction@gmail.com"

        const dispatchAddress =
          parsed.propertyAddress ||
          "Address not available"

        const dispatchPhone =
          parsed.customerPhone ||
          "Phone not available"

        const dispatchEmail =
          parsed.customerEmail ||
          "Email not available"

        const dispatchLossDate =
          parsed.lossDate ||
          "Date of loss not available"

        const dispatchAdjuster =
          parsed.adjusterName ||
          "Adjuster not available"

        const dispatchMessage =
          `URGENT DISPATCH SUMMARY\n\n` +
          `Customer: ${customerName}\n` +
          `Job ID: ${jobId}\n` +
          `Service Need: Emergency Tarp\n` +
          `Carrier: ${carrier}\n` +
          `Claim: ${claimNumber || "Not available"}\n` +
          `Date of Loss: ${dispatchLossDate}\n` +
          `Phone: ${dispatchPhone}\n` +
          `Email: ${dispatchEmail}\n` +
          `Property: ${dispatchAddress}\n` +
          `Adjuster / Examiner: ${dispatchAdjuster}\n\n` +
          `Status: Navigator created this EMS assignment as Lead.\n` +
          `Customer WA is being held for the five-minute review period.\n` +
          `Action: Review immediately and correct or pause the job if needed.`

        let dispatchSmsResult: any = null
        let dispatchEmailResult: any = null

        if (alertSmsTo) {
          try {
            dispatchSmsResult =
              await sendSMS(
                alertSmsTo,
                dispatchMessage
              )
          } catch (err: any) {
            dispatchSmsResult = {
              error:
                err?.message ||
                String(err),
            }
          }
        } else {
          dispatchSmsResult = {
            skipped: true,
            reason:
              "missing_alert_sms_to",
          }
        }

        if (alertEmailTo) {
          try {
            dispatchEmailResult =
              await sendAlertEmail(
                alertEmailTo,
                `URGENT dispatch: ${customerName}`,
                dispatchMessage
              )
          } catch (err: any) {
            dispatchEmailResult = {
              error:
                err?.message ||
                String(err),
            }
          }
        } else {
          dispatchEmailResult = {
            skipped: true,
            reason:
              "missing_alert_email_to",
          }
        }

        await addTimelineEvent(
          tenantId,
          jobId,
          "ems_urgent_dispatch_alert_routed",
          `EMS urgent dispatch alert routed to ${alertSmsTo || "no SMS target"} and ${alertEmailTo || "no email target"}.`,
          {
            channel:
              "claims_email",
            alert_sms_to:
              alertSmsTo || null,
            alert_email_to:
              alertEmailTo || null,
            sms_result:
              dispatchSmsResult,
            email_result:
              dispatchEmailResult,
            customer_name:
              customerName,
            customer_phone:
              parsed.customerPhone,
            customer_email:
              parsed.customerEmail,
            property_address:
              parsed.propertyAddress,
            carrier,
            claim_number:
              claimNumber,
            date_of_loss:
              parsed.lossDate,
            adjuster_name:
              parsed.adjusterName,
            five_minute_customer_grace:
              true,
          }
        )

        await upsertEstimateDetailsByTenantSlug(TENANT_SLUG, jobId, {
          claim_number: claimNumber,
          emergency_tarp_needed: true,
          emergency_tarp_sqft: parsed.emergencySqft,
          estimator_remarks: `EMS tarp intake created from forwarded assessment email. Carrier/source: ${carrier}.`,
        })

        sendResult =
          await queueInitialExternalResponse({
            tenantId,
            jobId,
            kind:
              "ems_document_package",
            payload: {
              tenant_slug:
                TENANT_SLUG,
              source:
                "claims_email_intake",
              from:
                parsedPayload.from,
              subject:
                parsedPayload.subject,
            },
          })
      }

      await addTimelineEvent(
        tenantId,
        jobId,
        isEmsTarp ? "ems_tarp_intake_notes" : "claims_assignment_intake_notes",
        parsed.notes || `Claims assignment email received from ${parsedPayload.from || "unknown sender"}.`,
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
        isEmsTarp
          ? "ems_tarp_email_intake_processed"
          : "claims_assignment_email_intake_processed",
        isEmsTarp
          ? "EMS tarp intake created as Lead; WA creation and external response queued behind the five-minute grace period."
          : `Claims assignment processed as ${serviceType || "Unclassified"} and routed for Navigator review.`,
        {
          from: parsedPayload.from,
          to: parsedPayload.to,
          subject: parsedPayload.subject,
          parsed,
          service_type: serviceType,
          package_id: documentPackage?.id || null,
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
