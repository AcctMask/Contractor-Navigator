import { pool } from "../db/db"

/*
 Developer Settings Service
 Clean version with tarp support built-in
*/

export type DevSettings = {
  alert_email_to?: string
  alert_sms_to?: string

  lead_messages: string[]
  demo_scheduled_messages: string[]
  demo_completed_follow_up_messages: string[]
  estimate_messages: string[]
  contract_messages: string[]
  tarp_messages: string[]
  weather_report_messages: string[]

  lead_timings_minutes: number[]
  demo_scheduled_timings_minutes: number[]
  demo_completed_follow_up_timings_minutes: number[]
  estimate_timings_minutes: number[]
  contract_timings_minutes: number[]
  tarp_timings_minutes: number[]
  weather_report_timings_minutes: number[]
}

function defaultSettings(): DevSettings {
  return {
    alert_email_to: "",
    alert_sms_to: "",

    lead_messages: ["", "", "", "", "", "", "", "", "", ""],
    demo_scheduled_messages: ["", "", "", "", "", "", "", "", "", ""],
    demo_completed_follow_up_messages: ["", "", "", "", "", "", "", "", "", ""],
    estimate_messages: ["", "", "", "", "", "", "", "", "", ""],
    contract_messages: ["", "", "", "", "", "", "", "", "", ""],

    tarp_messages: [
      "Hi {{name}}, Good2Go Roofing has completed your emergency tarp service to help protect your property while permanent repairs are arranged. If you have questions about the roof, insurance process, or what happens next, simply reply here anytime.",
      "Many homeowners first meet us during an emergency, but Good2Go is a full-service Florida licensed roofing contractor, License #CCC1331529. We provide roof inspections, repairs, and complete roof replacements. Reply here if you would like to discuss your permanent roofing needs.",
      "When a tarp assignment comes through an insurance carrier or managed repair program, the contractor must meet their licensing, insurance, and business-practice requirements. Good2Go has been vetted and accepted to perform this work, and we are available to help throughout the recovery process.",
      "Insurance adjusters can become extremely busy after storms, so claim reviews sometimes take longer than expected. If you receive estimates, paperwork, or requests you do not understand, reply here. We will be glad to help explain what you are seeing.",
      "Good2Go is a licensed roofing contractor, and our owner is also a licensed Florida insurance adjuster, License #D076345. This experience helps us understand both the roofing work and the insurance process while keeping the carrier responsible for all coverage decisions.",
      "If you choose Good2Go for the permanent roof work, we can prepare a roofing contract while your claim is pending. Once under contract, we can speak directly with your adjuster about the roofing scope and help move questions toward resolution. If coverage is not awarded, the contract becomes void. Reply CONTRACT if you would like one prepared.",
      "We know roofing projects can stall between adjuster schedules, paperwork, and everyday life. Have you received a claim decision or discussed the permanent repairs yet? Reply here and tell us where things stand so we can help with the next step.",
      "Our weather systems indicate your area may have experienced winds exceeding 40 mph since your tarp was installed. High winds can sometimes loosen temporary protection. If you notice movement, lifting, or leaking, notify your adjuster and ask them to authorize Good2Go to inspect and reset the tarp. You may also reply here for help.",
      "If your roof has not been permanently repaired, we would appreciate the opportunity to earn your business. Good2Go provides complete roofing services whether the work is covered by insurance or handled privately. Reply INSPECTION to schedule a complimentary roof inspection.",
      "Thank you again for trusting Good2Go during your emergency. If your tarp remains in place or the permanent roofing work is still unresolved, reply here anytime. We are available for roofing advice, inspections, repairs, replacement, or help communicating about the roofing scope."
    ],

    weather_report_messages: [
      "Hi {{name}}, your Weather Evidence Report has been generated. If you have questions about the report, reply here and we can help.",
      "Hi {{name}}, just confirming you received your Weather Evidence Report. We are happy to answer questions about the weather data shown.",
      "Hi {{name}}, your report summarizes documented weather observations near the property. If you would like help understanding the report, reply here anytime.",
      "Hi {{name}}, if you have questions about what the weather evidence may mean for your roof, we can help review the next steps.",
      "Hi {{name}}, if you would like, Good2Go Roofing can provide a complimentary roof inspection based on the property and report information.",
      "Hi {{name}}, you can also request a free roof estimate anytime here: https://g2g-instant-estimator.netlify.app/",
      "Hi {{name}}, insurance timing and documentation can matter after storm activity. If you have questions about the process, we can help explain what to expect.",
      "Hi {{name}}, storm season is a good time to make sure your roof is ready. If you would like a roof check or estimate, reply here anytime.",
      "Hi {{name}}, just checking in to see if you had any remaining questions about your Weather Evidence Report or roof options.",
      "Hi {{name}}, final courtesy follow-up. If you need help with your roof, inspection, or estimate, reply here anytime."
    ],

    lead_timings_minutes: [0, 1440, 2880, 4320, 10080, 20160, 30240, 43200, 64800, 129600],
    demo_scheduled_timings_minutes: [0, 1440, 2880, 4320, 10080, 20160, 30240, 43200, 64800, 129600],
    demo_completed_follow_up_timings_minutes: [0, 1440, 2880, 4320, 10080, 20160, 30240, 43200, 64800, 129600],
    estimate_timings_minutes: [0, 1440, 4320, 7200, 10080, 20160, 30240, 43200, 64800, 129600],
    contract_timings_minutes: [0, 1440, 4320, 7200, 10080, 20160, 30240, 43200, 64800, 129600],

    tarp_timings_minutes: [0, 2880, 7200, 12960, 20160, 30240, 43200, 64800, 86400, 129600],
    weather_report_timings_minutes: [0, 1440, 4320, 10080, 20160, 30240, 43200, 64800, 86400, 129600]
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
    demo_scheduled_messages: [...(merged.demo_scheduled_messages || []), ...defaults.demo_scheduled_messages].slice(0, 10),
    demo_completed_follow_up_messages: [...(merged.demo_completed_follow_up_messages || []), ...defaults.demo_completed_follow_up_messages].slice(0, 10),
    estimate_messages: [...(merged.estimate_messages || []), ...defaults.estimate_messages].slice(0, 10),
    contract_messages: [...(merged.contract_messages || []), ...defaults.contract_messages].slice(0, 10),
    tarp_messages: [...(merged.tarp_messages || []), ...defaults.tarp_messages].slice(0, 10),
    lead_timings_minutes: [...(merged.lead_timings_minutes || []), ...defaults.lead_timings_minutes].slice(0, 10),
    demo_scheduled_timings_minutes: [...(merged.demo_scheduled_timings_minutes || []), ...defaults.demo_scheduled_timings_minutes].slice(0, 10),
    demo_completed_follow_up_timings_minutes: [...(merged.demo_completed_follow_up_timings_minutes || []), ...defaults.demo_completed_follow_up_timings_minutes].slice(0, 10),
    estimate_timings_minutes: [...(merged.estimate_timings_minutes || []), ...defaults.estimate_timings_minutes].slice(0, 10),
    contract_timings_minutes: [...(merged.contract_timings_minutes || []), ...defaults.contract_timings_minutes].slice(0, 10),
    tarp_timings_minutes: [...(merged.tarp_timings_minutes || []), ...defaults.tarp_timings_minutes].slice(0, 10),
    weather_report_messages: [...(merged.weather_report_messages || []), ...defaults.weather_report_messages].slice(0, 10),
    weather_report_timings_minutes: [...(merged.weather_report_timings_minutes || []), ...defaults.weather_report_timings_minutes].slice(0, 10),
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
