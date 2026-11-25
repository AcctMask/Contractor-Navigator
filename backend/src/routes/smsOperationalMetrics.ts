import { pool } from "../db/db"

type SmsRange = "30d" | "90d" | "all"

export function smsRange(raw: unknown): SmsRange | null {
  const value = String(raw || "30d").trim()
  return value === "30d" || value === "90d" || value === "all" ? value : null
}

/**
 * Aggregate-only operational evidence. A Twilio status at submission time
 * is NOT proof of delivery. Never expose phone, customer, or individual job.
 */
export async function smsOperationalMetricsHandler(request: any, reply: any, tenantSlug: string) {
  const range = smsRange(request.query?.range)
  if (!range) return reply.code(400).send({ ok: false, error: "Unsupported range" })

  const tenantResult = await pool.query(
    "select id, slug from tenants where slug = $1 limit 1",
    [tenantSlug]
  )
  if (tenantResult.rowCount !== 1) {
    return reply.code(404).send({ ok: false, error: "Tenant not found" })
  }

  const tenantId = Number(tenantResult.rows[0].id)
  const from = range === "all"
    ? null
    : new Date(Date.now() - (range === "30d" ? 30 : 90) * 86400_000).toISOString()

  const result = await pool.query(
    `
    select
      count(*) filter (where kind = 'ai_message_sent')::int as followup_submissions,
      count(*) filter (where kind = 'ai_inbound_response_sent')::int as inbound_response_submissions,
      count(distinct nullif(meta->>'twilio_sid', '')) filter (
        where kind in ('ai_message_sent', 'ai_inbound_response_sent')
      )::int as total_unique_twilio_sids,
      count(*) filter (
        where kind in ('ai_message_sent','ai_inbound_response_sent')
          and nullif(meta->>'twilio_sid', '') is null
      )::int as submissions_without_sid,
      count(*) filter (
        where kind in ('ai_message_sent','ai_inbound_response_sent')
          and meta->>'twilio_status' = 'queued'
      )::int as queued_at_submission,
      count(*) filter (where kind = 'ai_message_send_failed')::int as failed_send_events,
      count(*) filter (where kind = 'ai_message_delivery_halted')::int as delivery_halts,
      count(*) filter (where kind = 'ai_message_delivery_halted' and meta->>'reason' = 'dnc')::int as dnc_halts
    from timeline_events
    where tenant_id = $1
      and ($2::timestamptz is null or created_at >= $2::timestamptz)
      and kind in (
        'ai_message_sent', 'ai_inbound_response_sent',
        'ai_message_send_failed', 'ai_message_delivery_halted'
      )
    `,
    [tenantId, from]
  )
  const row = result.rows[0] || {}
  return reply.send({
    ok: true,
    source: "contractor-navigator-sms-operational-metrics",
    tenant: { id: tenantId, slug: String(tenantResult.rows[0].slug) },
    range,
    generated_at: new Date().toISOString(),
    metrics: {
      followup_submissions: Number(row.followup_submissions || 0),
      inbound_response_submissions: Number(row.inbound_response_submissions || 0),
      total_unique_twilio_sids: Number(row.total_unique_twilio_sids || 0),
      submissions_without_sid: Number(row.submissions_without_sid || 0),
      queued_at_submission: Number(row.queued_at_submission || 0),
      failed_send_events: Number(row.failed_send_events || 0),
      delivery_halts: Number(row.delivery_halts || 0),
      dnc_halts: Number(row.dnc_halts || 0),
    },
    delivery: {
      confirmed: false,
      evidence: "Twilio submission identifiers and statuses recorded at submission only",
      note: "Delivery receipts require separately verified provider status callbacks",
    },
  })
}
