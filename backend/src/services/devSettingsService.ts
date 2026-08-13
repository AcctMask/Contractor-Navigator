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
  wa_sent_messages: string[]
  tarp_active_messages: string[]
  tarp_messages: string[]
  weather_report_messages: string[]

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

  lead_timings_minutes: number[]
  demo_scheduled_timings_minutes: number[]
  demo_completed_follow_up_timings_minutes: number[]
  estimate_timings_minutes: number[]
  contract_timings_minutes: number[]
  wa_sent_timings_minutes: number[]
  tarp_active_timings_minutes: number[]
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

    wa_sent_messages: [
      "Hi {{name}}, we are still waiting for your signed Emergency Tarp Work Authorization. We cannot enter the property or perform emergency tarp work until we have the required authorization. Please use the Work Authorization link below. If you no longer need a tarp or need help completing it, reply here.",
      "Hi {{name}}, Good2Go Roofing is following up on your emergency tarp request. We still do not have the signed Work Authorization required before we can move forward with the tarp crew. Please complete the authorization using the link below. If you are having trouble, reply here.",
      "Hi {{name}}, we have not yet received your Emergency Tarp Work Authorization. Do you still need a tarp? We will continue trying to reach you because we cannot dispatch for work requiring authorization until it is signed. Please use the Work Authorization link below or reply if you need assistance."
    ],

    tarp_active_messages: [
      "Hi {{name}}, Good2Go Roofing has received your authorization and your property is in our emergency tarp queue. We have not forgotten you. Storm conditions, power outages, blocked roads, safety conditions, and geographic crew routing can affect response times. If there is a tree on the roof, severe active water intrusion, unsafe access, or another urgent circumstance, reply here so our staff and crew can be notified.",
      "Hi {{name}}, your emergency tarp remains in our active queue. We group tarp jobs geographically when practical so crews can respond as efficiently as conditions allow. If conditions at the property have changed or there is information that would help the crew arrive better prepared, please reply here.",
      "Hi {{name}}, Good2Go Roofing is continuing to coordinate emergency tarp crews and has not forgotten your property. If you have severe water intrusion, structural concerns, a tree on the roof, access problems, or another extenuating circumstance, reply here and a staff member will be notified."
    ],

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

    inbound_auto_replies: {
      estimate_request:
        "Thanks {{name}}. We received your estimate request. Our team will review it and follow up with you.",
      inspection_request:
        "Thanks {{name}}. We received your inspection request. Our team will follow up to coordinate the next step.",
      callback_request:
        "Thanks {{name}}. We received your request for a call. A member of our team will follow up with you.",
      contract_request:
        "Thanks {{name}}. We received your request regarding the contract. Our team will follow up with you.",
      pricing_objection:
        "Thanks {{name}}. We received your message about pricing. Our team will review it and follow up with you.",
      general_question:
        "Thanks {{name}}. We received your question and our team will follow up with you.",
      buying_signal_only:
        "Thanks {{name}}. We received your message and our team will follow up with you shortly.",
      unknown:
        "Thanks {{name}}. We received your message and our team will follow up shortly."
    },

    lead_timings_minutes: [0, 1440, 2880, 4320, 10080, 20160, 30240, 43200, 64800, 129600],
    demo_scheduled_timings_minutes: [0, 1440, 2880, 4320, 10080, 20160, 30240, 43200, 64800, 129600],
    demo_completed_follow_up_timings_minutes: [0, 1440, 2880, 4320, 10080, 20160, 30240, 43200, 64800, 129600],
    estimate_timings_minutes: [0, 1440, 4320, 7200, 10080, 20160, 30240, 43200, 64800, 129600],
    contract_timings_minutes: [0, 1440, 4320, 7200, 10080, 20160, 30240, 43200, 64800, 129600],

    wa_sent_timings_minutes: [30, 120, 360, 720, 1440, 2880, 4320, 10080, 20160, 30240],
    tarp_active_timings_minutes: [120, 360, 720, 1440, 2880, 4320, 10080, 20160, 30240, 43200],

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
    wa_sent_messages: [...(merged.wa_sent_messages || []), ...defaults.wa_sent_messages].slice(0, 10),
    tarp_active_messages: [...(merged.tarp_active_messages || []), ...defaults.tarp_active_messages].slice(0, 10),
    tarp_messages: [...(merged.tarp_messages || []), ...defaults.tarp_messages].slice(0, 10),
    lead_timings_minutes: [...(merged.lead_timings_minutes || []), ...defaults.lead_timings_minutes].slice(0, 10),
    demo_scheduled_timings_minutes: [...(merged.demo_scheduled_timings_minutes || []), ...defaults.demo_scheduled_timings_minutes].slice(0, 10),
    demo_completed_follow_up_timings_minutes: [...(merged.demo_completed_follow_up_timings_minutes || []), ...defaults.demo_completed_follow_up_timings_minutes].slice(0, 10),
    estimate_timings_minutes: [...(merged.estimate_timings_minutes || []), ...defaults.estimate_timings_minutes].slice(0, 10),
    contract_timings_minutes: [...(merged.contract_timings_minutes || []), ...defaults.contract_timings_minutes].slice(0, 10),
    wa_sent_timings_minutes: [...(merged.wa_sent_timings_minutes || []), ...defaults.wa_sent_timings_minutes].slice(0, 10),
    tarp_active_timings_minutes: [...(merged.tarp_active_timings_minutes || []), ...defaults.tarp_active_timings_minutes].slice(0, 10),
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
