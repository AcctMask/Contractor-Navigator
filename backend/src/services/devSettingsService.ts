import { pool } from "../db/db"

export type DevSettings = {
  alert_sms_to: string
  alert_email_to: string
  lead_timings_minutes: number[]
  estimate_timings_minutes: number[]
  contract_timings_minutes: number[]
  lead_messages: string[]
  estimate_messages: string[]
  contract_messages: string[]
  inbound_auto_replies: {
    estimate_request: string
    inspection_request: string
    callback_request: string
    contract_request: string
    pricing_objection: string
    general_question: string
    buying_signal_only: string
    unknown: string
  }
}

const DEFAULT_SETTINGS: DevSettings = {
  alert_sms_to: "+17272154507",
  alert_email_to: "sales@g2groofing.com",
  lead_timings_minutes: [0, 30, 240, 1440],
  estimate_timings_minutes: [0, 120, 1440, 4320],
  contract_timings_minutes: [0, 1440, 4320, 7200, 10080],
  lead_messages: [
    "Thanks for reaching out to Good2Go Roofing Team. We received your request and our team may follow up shortly. If you have questions about roofing, repairs, inspections, or next steps, reply here and we’ll help.",
    "Hi {{name}}, this is Good2Go Roofing Team following up on your request for information. Let us know how we can help with your project or any questions you have.",
    "Good2Go Roofing Team here. Just checking in on your request. If you’d like to discuss roofing options, inspection timing, storm damage, or pricing, reply here and our team will help.",
    "Following up from Good2Go Roofing Team. If you would like a callback, inspection, or more information about your project, reply here and we’ll get you taken care of.",
  ],
  estimate_messages: [
    "Thank you for using our estimating tool. This is Good2Go Roofing Team. Your estimate has been generated, and our team may follow up with additional information or next steps if needed.",
    "Hi {{name}}, this is Good2Go Roofing Team checking in to see if you had a chance to review your estimate. Let us know if you have any questions.",
    "Good2Go Roofing Team here. We wanted to follow up on your estimate and see if you would like to review materials, timing, or next steps.",
    "Just following up from Good2Go Roofing Team regarding your estimate. If you would like to move forward or review options, reply here and our team will help.",
  ],
  contract_messages: [
    "Hi {{name}}, this is Good2Go Roofing Team following up on the contract we sent. Let us know if you have any questions before signing.",
    "Good2Go Roofing Team here. Just checking in on the contract we sent over. If you are ready, we can help with the next step or resend anything you need.",
    "Following up from Good2Go Roofing Team on your contract. If timing, materials, scheduling, or any part of the agreement is holding things up, reply here and we will help.",
    "This is Good2Go Roofing Team checking in again on your contract. If you are ready to move forward, reply here and our team will assist right away.",
    "Final follow-up from Good2Go Roofing Team on the contract we sent. If you still want to proceed, reply here and we will get the next step moving.",
  ],
  inbound_auto_replies: {
    estimate_request:
      "Thanks {{name}}. We received your estimate request and our team will review the details and follow up with next steps.",
    inspection_request:
      "Thanks {{name}}. We received your inspection request. A member of our team will follow up about scheduling.",
    callback_request:
      "Thanks {{name}}. We received your callback request and someone from Good2Go Roofing Team will follow up.",
    contract_request:
      "Thanks {{name}}. We received your contract request. Our team will review and follow up with the next step.",
    pricing_objection:
      "Thanks {{name}}. We received your pricing question. Our team will review it and follow up with you.",
    general_question:
      "Thanks {{name}}. We received your question and our team will follow up with more information.",
    buying_signal_only:
      "Thanks {{name}}. We received your message and our team will follow up shortly.",
    unknown:
      "Thanks {{name}}. We received your message and our team will follow up shortly.",
  },
}

async function ensureTable() {
  await pool.query(`
    create table if not exists developer_settings (
      tenant_id bigint primary key references tenants(id) on delete cascade,
      settings jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
}

export async function getTenantIdBySlug(slug: string): Promise<number> {
  const result = await pool.query(
    `select id from tenants where slug = $1 limit 1`,
    [slug]
  )

  if (!result.rowCount) {
    throw new Error(`Tenant not found: ${slug}`)
  }

  return Number(result.rows[0].id)
}

function sanitizeSettings(input: any): DevSettings {
  const safe = input || {}
  const inbound = safe.inbound_auto_replies || {}

  return {
    alert_sms_to: String(safe.alert_sms_to || DEFAULT_SETTINGS.alert_sms_to),
    alert_email_to: String(safe.alert_email_to || DEFAULT_SETTINGS.alert_email_to),
    lead_timings_minutes: Array.isArray(safe.lead_timings_minutes)
      ? safe.lead_timings_minutes.map((n: any) => Number(n)).filter(Number.isFinite)
      : DEFAULT_SETTINGS.lead_timings_minutes,
    estimate_timings_minutes: Array.isArray(safe.estimate_timings_minutes)
      ? safe.estimate_timings_minutes.map((n: any) => Number(n)).filter(Number.isFinite)
      : DEFAULT_SETTINGS.estimate_timings_minutes,
    contract_timings_minutes: Array.isArray(safe.contract_timings_minutes)
      ? safe.contract_timings_minutes.map((n: any) => Number(n)).filter(Number.isFinite)
      : DEFAULT_SETTINGS.contract_timings_minutes,
    lead_messages: Array.isArray(safe.lead_messages)
      ? safe.lead_messages.map((s: any) => String(s))
      : DEFAULT_SETTINGS.lead_messages,
    estimate_messages: Array.isArray(safe.estimate_messages)
      ? safe.estimate_messages.map((s: any) => String(s))
      : DEFAULT_SETTINGS.estimate_messages,
    contract_messages: Array.isArray(safe.contract_messages)
      ? safe.contract_messages.map((s: any) => String(s))
      : DEFAULT_SETTINGS.contract_messages,
    inbound_auto_replies: {
      estimate_request: String(
        inbound.estimate_request || DEFAULT_SETTINGS.inbound_auto_replies.estimate_request
      ),
      inspection_request: String(
        inbound.inspection_request || DEFAULT_SETTINGS.inbound_auto_replies.inspection_request
      ),
      callback_request: String(
        inbound.callback_request || DEFAULT_SETTINGS.inbound_auto_replies.callback_request
      ),
      contract_request: String(
        inbound.contract_request || DEFAULT_SETTINGS.inbound_auto_replies.contract_request
      ),
      pricing_objection: String(
        inbound.pricing_objection || DEFAULT_SETTINGS.inbound_auto_replies.pricing_objection
      ),
      general_question: String(
        inbound.general_question || DEFAULT_SETTINGS.inbound_auto_replies.general_question
      ),
      buying_signal_only: String(
        inbound.buying_signal_only || DEFAULT_SETTINGS.inbound_auto_replies.buying_signal_only
      ),
      unknown: String(
        inbound.unknown || DEFAULT_SETTINGS.inbound_auto_replies.unknown
      ),
    },
  }
}

export async function getDeveloperSettingsByTenantSlug(slug: string): Promise<DevSettings> {
  await ensureTable()
  const tenantId = await getTenantIdBySlug(slug)

  const result = await pool.query(
    `select settings from developer_settings where tenant_id = $1 limit 1`,
    [tenantId]
  )

  if (!result.rowCount) {
    await pool.query(
      `
      insert into developer_settings (tenant_id, settings)
      values ($1, $2::jsonb)
      on conflict (tenant_id) do nothing
      `,
      [tenantId, JSON.stringify(DEFAULT_SETTINGS)]
    )
    return DEFAULT_SETTINGS
  }

  return sanitizeSettings(result.rows[0].settings)
}

export async function saveDeveloperSettingsByTenantSlug(slug: string, input: any): Promise<DevSettings> {
  await ensureTable()
  const tenantId = await getTenantIdBySlug(slug)
  const settings = sanitizeSettings(input)

  await pool.query(
    `
    insert into developer_settings (tenant_id, settings, created_at, updated_at)
    values ($1, $2::jsonb, now(), now())
    on conflict (tenant_id)
    do update set
      settings = excluded.settings,
      updated_at = now()
    `,
    [tenantId, JSON.stringify(settings)]
  )

  return settings
}

export function getDefaultDeveloperSettings(): DevSettings {
  return DEFAULT_SETTINGS
}
