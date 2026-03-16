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
        "Inbound voice AI lead created. Caller reached Good2Go Roofing Team and requested follow-up.",
      source: "Phone Call",
    })

    const sayMessage =
      "Thank you for calling Good2Go Roofing Team. We have received your call and created a request for follow up. A member of our team will review your information and contact you shortly."

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${xmlEscape(sayMessage)}</Say>
</Response>`

    reply.header("Content-Type", "text/xml")
    return reply.send(xml)
  })
}

export default registerTwilioWebhook
export { registerTwilioWebhook }
