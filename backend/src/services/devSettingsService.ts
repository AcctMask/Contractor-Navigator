import { pool } from "../db/db"

/*
 Developer Settings Service
 Clean version with tarp support built-in
*/

export type DevSettings = {
  alert_email_to?: string
  alert_sms_to?: string

  lead_messages: string[]
  estimate_messages: string[]
  contract_messages: string[]
  tarp_messages: string[]

  lead_timings_minutes: number[]
  estimate_timings_minutes: number[]
  contract_timings_minutes: number[]
  tarp_timings_minutes: number[]
}

function defaultSettings(): DevSettings {
  return {
    alert_email_to: "",
    alert_sms_to: "",

    lead_messages: ["", "", "", "", "", "", "", "", "", ""],
    estimate_messages: ["", "", "", "", "", "", "", "", "", ""],
    contract_messages: ["", "", "", "", "", "", "", "", "", ""],

    tarp_messages: [
      "Good2Go Roofing & Construction LLC has completed your emergency tarp service. Please remember coverage, cause of loss, and repair scope are determined by the carrier and desk adjuster after claim review. If you have questions in the meantime, feel free to reply here anytime.",
      "Just checking in regarding your recent emergency tarp service. If you receive paperwork, estimates, or requests for information from your carrier and have questions about the process, feel free to send them over and we will do our best to help explain what you are seeing.",
      "We know claim review can take time after severe weather events. Timely roof repairs are strongly recommended to help prevent additional water damage and interior discoloration once claim decisions are made.",
      "If your claim process becomes delayed or difficult to navigate, Good2Go Roofing & Construction LLC License# CCC1331529 and Licensed Insurance Adjusters License# D076345 may be able to assist with communication and documentation related to authorized repairs.",
      "If you would like, you can also request a free roof estimate anytime through our website: https://g2g-instant-estimator.netlify.app/ or by contacting sales@g2groofing.com."
    ],

    lead_timings_minutes: [0, 1440, 2880, 4320, 10080, 20160, 30240, 43200, 64800, 129600],
    estimate_timings_minutes: [0, 1440, 4320, 7200, 10080, 20160, 30240, 43200, 64800, 129600],
    contract_timings_minutes: [0, 1440, 4320, 7200, 10080, 20160, 30240, 43200, 64800, 129600],

    tarp_timings_minutes: [180, 7200, 20160, 43200, 86400]
  }
}

export async function getDeveloperSettings(tenantId: number): Promise<DevSettings> {
  const result = await pool.query(
    `select settings from developer_settings where tenant_id = $1 limit 1`,
    [tenantId]
  )

  if (!result.rowCount) {
    const defaults = defaultSettings()

    await pool.query(
      `insert into developer_settings (tenant_id, settings, created_at, updated_at)
       values ($1, $2, now(), now())`,
      [tenantId, JSON.stringify(defaults)]
    )

    return defaults
  }

  const existing = result.rows[0].settings || {}

  const defaults = defaultSettings()
  const merged = {
    ...defaults,
    ...existing
  }

  return {
    ...merged,
    lead_messages: [...(merged.lead_messages || []), ...defaults.lead_messages].slice(0, 10),
    estimate_messages: [...(merged.estimate_messages || []), ...defaults.estimate_messages].slice(0, 10),
    contract_messages: [...(merged.contract_messages || []), ...defaults.contract_messages].slice(0, 10),
    lead_timings_minutes: [...(merged.lead_timings_minutes || []), ...defaults.lead_timings_minutes].slice(0, 10),
    estimate_timings_minutes: [...(merged.estimate_timings_minutes || []), ...defaults.estimate_timings_minutes].slice(0, 10),
    contract_timings_minutes: [...(merged.contract_timings_minutes || []), ...defaults.contract_timings_minutes].slice(0, 10),
  }
}

export async function saveDeveloperSettings(tenantId: number, settings: DevSettings) {
  await pool.query(
    `
    insert into developer_settings (tenant_id, settings, created_at, updated_at)
    values ($1, $2, now(), now())
    on conflict (tenant_id)
    do update set settings = excluded.settings, updated_at = now()
    `,
    [tenantId, JSON.stringify(settings)]
  )

  return { ok: true }
}

export async function getDeveloperSettingsByTenantSlug(tenantSlug: string): Promise<DevSettings> {
  const { getTenantIdBySlug } = await import("./followupEngine")
  const tenantId = await getTenantIdBySlug(tenantSlug)

  return getDeveloperSettings(tenantId)
}

export async function saveDeveloperSettingsByTenantSlug(
  tenantSlug: string,
  settings: DevSettings
) {
  const { getTenantIdBySlug } = await import("./followupEngine")
  const tenantId = await getTenantIdBySlug(tenantSlug)

  return saveDeveloperSettings(tenantId, settings)
}
