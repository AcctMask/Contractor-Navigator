import { pool } from "../db/db"

/*
 Developer Settings Service
 Clean version with tarp support built-in
*/

export type DevSettings = {
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
    lead_messages: ["", "", "", ""],
    estimate_messages: ["", "", "", ""],
    contract_messages: ["", "", "", "", ""],

    tarp_messages: [
      "Hi {{name}}, your emergency tarp work is complete. The next step is reviewing the roof damage and options for permanent repair or replacement.",
      "Following up after the tarp {{name}} — would you like help with the insurance process and roof replacement?",
      "Tarps are temporary {{name}} — we can help move this toward a permanent solution before further damage occurs.",
      "Final follow-up {{name}} — if you want help converting this into a full roof project, just reply here."
    ],

    lead_timings_minutes: [0, 1440, 2880, 4320],
    estimate_timings_minutes: [0, 1440, 4320, 7200],
    contract_timings_minutes: [0, 1440, 4320, 7200, 10080],

    tarp_timings_minutes: [0, 1440, 2880, 4320]
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

  return {
    ...defaultSettings(),
    ...existing
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

/* Compatibility helpers (DO NOT REMOVE) */

export async function getDeveloperSettingsByTenantSlug(tenantSlug: string) {
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
