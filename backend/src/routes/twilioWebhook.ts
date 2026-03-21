import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import {
  createLeadFromInboundCallByTenantSlug,
  handleInboundMessageByTenantSlug,
} from "../services/followupEngine"

function normalizePhone(phone: string | null | undefined) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (phone.startsWith("+")) return phone
  return digits ? `+${digits}` : null
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function getPublicBaseUrl(req: any) {
  const envBase = process.env.PUBLIC_BASE_URL?.trim()
  if (envBase) {
    return envBase.replace(/\/+$/, "")
  }

  const forwardedProto = req.headers["x-forwarded-proto"]
  const forwardedHost = req.headers["x-forwarded-host"]

  const proto =
    typeof forwardedProto === "string" && forwardedProto.trim()
      ? forwardedProto.split(",")[0].trim()
      : "http"

  const host =
    typeof forwardedHost === "string" && forwardedHost.trim()
      ? forwardedHost.split(",")[0].trim()
      : req.headers.host || "localhost:8787"

  return `${proto}://${host}`.replace(/\/+$/, "")
}

async function registerTwilioWebhook(app: FastifyInstance) {
  app.post("/twilio/inbound-sms", async (req, reply) => {
    const body = (req as any).body || {}

    const from = normalizePhone(body.From ? String(body.From) : null)
    const message = String(body.Body || "").trim()

    if (!from || !message) {
      return reply.send({ ok: true, skipped: true })
    }

    const result = await pool.query(
      `
      select
        j.id as job_id,
        t.slug as tenant_slug
      from customers c
      join jobs j
        on j.customer_id = c.id
       and j.tenant_id = c.tenant_id
      join tenants t
        on t.id = j.tenant_id
      where c.phone = $1
      order by j.created_at desc, j.id desc
      limit 1
      `,
      [from]
    )

    if (!result.rowCount) {
      return reply.send({ ok: true, skipped: true, reason: "job_not_found_for_phone" })
    }

    const row = result.rows[0]

    const response = await handleInboundMessageByTenantSlug(
      String(row.tenant_slug),
      Number(row.job_id),
      message,
      from
    )

    return reply.send(response)
  })

  app.post("/twilio/inbound-call", async (req, reply) => {
    const body = (req as any).body || {}
    const from = normalizePhone(body.From ? String(body.From) : null)

    const created = await createLeadFromInboundCallByTenantSlug("g2g-roofing", {
      callerPhone: from,
      callerName: null,
      notes:
        "Inbound voice AI lead created. Caller reached Good2Go Roofing Team and entered the voice workflow.",
      source: "Phone Call",
    })

    const publicBaseUrl = getPublicBaseUrl(req)
    const gatherUrl =
      `${publicBaseUrl}/twilio/voice/gather` +
      `?tenantSlug=g2g-roofing&jobId=${created.job_id}`

    const sayMessage =
      "Thanks for calling Good2Go Roofing Team. Please briefly tell us if you need an estimate, an inspection, a callback, or help with an existing project."

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" method="POST" action="${xmlEscape(gatherUrl)}" speechTimeout="auto">
    <Say voice="alice">${xmlEscape(sayMessage)}</Say>
  </Gather>
  <Say voice="alice">We did not receive a response. A member of our team will follow up shortly. Goodbye.</Say>
  <Hangup/>
</Response>`

    reply.header("Content-Type", "text/xml")
    return reply.send(xml)
  })

  app.post("/twilio/voice/gather", async (req, reply) => {
    const body = (req as any).body || {}
    const query = (req as any).query || {}

    const tenantSlug = String(query.tenantSlug || "").trim()
    const jobId = Number(query.jobId)
    const from = normalizePhone(body.From ? String(body.From) : null)
    const speechResult = String(body.SpeechResult || "").trim()

    if (!tenantSlug || !Number.isFinite(jobId) || !speechResult) {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">We could not process that call correctly. Please try again later.</Say>
  <Hangup/>
</Response>`
      reply.header("Content-Type", "text/xml")
      return reply.send(xml)
    }

    const result = await handleInboundMessageByTenantSlug(
      tenantSlug,
      jobId,
      speechResult,
      from,
      "voice"
    )

    const spokenReply =
      result.auto_reply_message ||
      "Thanks for calling Good2Go Roofing Team. A member of our team will follow up shortly."

    await pool.query(
      `
      insert into timeline_events
        (tenant_id, job_id, kind, message, meta, created_at)
      values
        ($1, $2, $3, $4, $5::jsonb, now())
      `,
      [
        result.tenant_id,
        result.job_id,
        "voice_ai_response_spoken",
        spokenReply,
        JSON.stringify({
          sender: "Good2Go Roofing Team",
          channel: "voice",
          classification: result.classification,
        }),
      ]
    )

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${xmlEscape(spokenReply)}</Say>
  <Hangup/>
</Response>`

    reply.header("Content-Type", "text/xml")
    return reply.send(xml)
  })
}

export default registerTwilioWebhook
export { registerTwilioWebhook }
