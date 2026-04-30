import { pool } from "../db/db"
import { getDeveloperSettingsByTenantSlug } from "./devSettingsService"
import { sendSMS } from "./twilioService"
import { sendAlertEmail } from "./emailService"
import {
  createLeadFromInboundCallByTenantSlug,
  getTenantIdBySlug,
} from "./followupEngine"

type JobContext = {
  tenant_id: number
  job_id: number
  customer_id: number | null
  customer_name: string | null
  customer_phone: string | null
  address1: string | null
  city: string | null
  state: string | null
  zip: string | null
}

type VoiceSummary = {
  reason: string
  customerName: string
  propertyAddress: string
  callbackNumber: string
  callbackTime: string
  emergencyTarpRequested: boolean
}

function normalizePhone(phone: string | null | undefined) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (phone.startsWith("+")) return phone
  return digits ? `+${digits}` : null
}

function looksAffirmative(value: string) {
  const text = value.trim().toLowerCase()
  return (
    text === "yes" ||
    text === "yeah" ||
    text === "yep" ||
    text === "correct" ||
    text === "that is correct" ||
    text === "use this number" ||
    text === "same number"
  )
}

function wordsToDigits(value: string) {
  const map: Record<string, string> = {
    zero: "0",
    oh: "0",
    o: "0",
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
  }

  const parts = value
    .toLowerCase()
    .replace(/[().,-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)

  let out = ""
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      out += part
    } else if (map[part]) {
      out += map[part]
    }
  }

  return out
}

function extractZip(value: string) {
  const match = String(value || "").match(/\b\d{5}(?:-\d{4})?\b/)
  return match ? match[0].slice(0, 5) : null
}

function formatAddressLine(ctx: JobContext) {
  const parts = [ctx.address1, ctx.city, ctx.state, ctx.zip].filter(Boolean)
  return parts.length ? parts.join(", ") : "Address not yet available"
}

function isEmergencyTarpReason(reason: string) {
  const text = String(reason || "").toLowerCase()
  return (
    text.includes("emergency tarp") ||
    text.includes("tarp") ||
    text.includes("active leak") ||
    text.includes("leak right now") ||
    text.includes("roof leak") ||
    text.includes("water coming in")
  )
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

async function getJobContext(tenantSlug: string, jobId: number): Promise<JobContext> {
  const tenantId = await getTenantIdBySlug(tenantSlug)

  const result = await pool.query(
    `
    select
      j.tenant_id,
      j.id as job_id,
      j.customer_id,
      j.address1,
      j.city,
      j.state,
      j.zip,
      c.full_name as customer_name,
      c.phone as customer_phone
    from jobs j
    left join customers c
      on c.id = j.customer_id
     and c.tenant_id = j.tenant_id
    where j.tenant_id = $1
      and j.id = $2
    limit 1
    `,
    [tenantId, jobId]
  )

  if (!result.rowCount) {
    throw new Error(`Job not found: ${jobId}`)
  }

  const row = result.rows[0]

  return {
    tenant_id: Number(row.tenant_id),
    job_id: Number(row.job_id),
    customer_id: row.customer_id ? Number(row.customer_id) : null,
    customer_name: row.customer_name || null,
    customer_phone: row.customer_phone || null,
    address1: row.address1 || null,
    city: row.city || null,
    state: row.state || null,
    zip: row.zip || null,
  }
}

async function updateCustomerName(tenantId: number, customerId: number | null, fullName: string) {
  if (!customerId) return

  await pool.query(
    `
    update customers
    set
      full_name = $3,
      updated_at = now()
    where tenant_id = $1
      and id = $2
    `,
    [tenantId, customerId, fullName]
  )
}

async function updateCustomerPhone(tenantId: number, customerId: number | null, phone: string) {
  if (!customerId) return

  await pool.query(
    `
    update customers
    set
      phone = $3,
      updated_at = now()
    where tenant_id = $1
      and id = $2
    `,
    [tenantId, customerId, phone]
  )
}

async function updateJobAddress(tenantId: number, jobId: number, spokenAddress: string) {
  const zip = extractZip(spokenAddress)

  await pool.query(
    `
    update jobs
    set
      address1 = $3,
      zip = coalesce($4, zip),
      updated_at = now()
    where tenant_id = $1
      and id = $2
    `,
    [tenantId, jobId, spokenAddress, zip]
  )
}

async function updateJobForEmergencyTarp(tenantId: number, jobId: number) {
  await pool.query(
    `
    update jobs
    set
      crm_substatus = 'emergency_tarp_requested',
      crm_flow_key = 'voice_emergency_tarp',
      updated_at = now()
    where tenant_id = $1
      and id = $2
    `,
    [tenantId, jobId]
  )
}

async function getLatestVoiceValue(
  tenantId: number,
  jobId: number,
  kind: string
): Promise<string | null> {
  const result = await pool.query(
    `
    select message
    from timeline_events
    where tenant_id = $1
      and job_id = $2
      and kind = $3
    order by created_at desc, id desc
    limit 1
    `,
    [tenantId, jobId, kind]
  )

  if (!result.rowCount) return null
  return result.rows[0].message || null
}

export async function startVoiceIntakeLead(tenantSlug: string, from: string | null) {
  const created = await createLeadFromInboundCallByTenantSlug(tenantSlug, {
    callerPhone: from,
    callerName: null,
    notes:
      "Inbound voice AI lead created. Caller reached Good2Go Roofing Team and entered the voice workflow.",
    source: "Phone Call",
  })

  return created
}

export async function saveVoiceReason(
  tenantSlug: string,
  jobId: number,
  from: string | null,
  reason: string
) {
  const ctx = await getJobContext(tenantSlug, jobId)
  const emergencyTarpRequested = isEmergencyTarpReason(reason)

  await addTimelineEvent(
    ctx.tenant_id,
    ctx.job_id,
    "voice_reason_captured",
    reason,
    {
      from,
      channel: "voice",
      input: "speech",
      emergency_tarp_requested: emergencyTarpRequested,
    }
  )


  if (emergencyTarpRequested) {
    await updateJobForEmergencyTarp(ctx.tenant_id, ctx.job_id)

    await addTimelineEvent(
      ctx.tenant_id,
      ctx.job_id,
      "voice_emergency_tarp_detected",
      "Emergency tarp request detected from caller",
      {
        from,
        channel: "voice",
      }
    )
  }

  return { emergencyTarpRequested }
}

export async function saveVoiceName(tenantSlug: string, jobId: number, name: string) {
  const ctx = await getJobContext(tenantSlug, jobId)

  if (name) {
    await updateCustomerName(ctx.tenant_id, ctx.customer_id, name)
  }

  await addTimelineEvent(
    ctx.tenant_id,
    ctx.job_id,
    "voice_name_captured",
    name,
    { channel: "voice" }
  )
}

export async function saveVoiceAddress(tenantSlug: string, jobId: number, address: string) {
  const ctx = await getJobContext(tenantSlug, jobId)

  if (address) {
    await updateJobAddress(ctx.tenant_id, ctx.job_id, address)
  }

  await addTimelineEvent(
    ctx.tenant_id,
    ctx.job_id,
    "voice_address_captured",
    address,
    {
      channel: "voice",
      zip_detected: extractZip(address),
    }
  )
}

export async function saveVoiceCallbackNumber(
  tenantSlug: string,
  jobId: number,
  callerId: string | null,
  spokenValue: string
) {
  const ctx = await getJobContext(tenantSlug, jobId)

  let callbackNumber = normalizePhone(callerId)
  let source = "caller_id_confirmed"

  if (!looksAffirmative(spokenValue)) {
    const parsedDigits = wordsToDigits(spokenValue)
    const parsedPhone = normalizePhone(parsedDigits)

    if (parsedPhone) {
      callbackNumber = parsedPhone
      source = "spoken_phone"
    } else if (spokenValue.trim()) {
      callbackNumber = spokenValue.trim()
      source = "spoken_raw"
    }
  }

  if (callbackNumber && callbackNumber.startsWith("+") && ctx.customer_id) {
    await updateCustomerPhone(ctx.tenant_id, ctx.customer_id, callbackNumber)
  }

  await addTimelineEvent(
    ctx.tenant_id,
    ctx.job_id,
    "voice_callback_number_captured",
    callbackNumber || "No callback number captured",
    {
      channel: "voice",
      source,
      caller_id: callerId,
      spoken_value: spokenValue,
    }
  )

  return callbackNumber || "No callback number captured"
}

export async function saveVoiceCallbackTime(
  tenantSlug: string,
  jobId: number,
  callbackTime: string
) {
  const ctx = await getJobContext(tenantSlug, jobId)

  await addTimelineEvent(
    ctx.tenant_id,
    ctx.job_id,
    "voice_callback_time_captured",
    callbackTime,
    { channel: "voice" }
  )
}

export async function getVoiceSummary(
  tenantSlug: string,
  jobId: number
): Promise<VoiceSummary> {
  const ctx = await getJobContext(tenantSlug, jobId)

  const reason =
    (await getLatestVoiceValue(ctx.tenant_id, ctx.job_id, "voice_reason_captured")) ||
    "General callback request"

  const customerName =
    (await getLatestVoiceValue(ctx.tenant_id, ctx.job_id, "voice_name_captured")) ||
    ctx.customer_name ||
    "Inbound Caller"

  const propertyAddress =
    (await getLatestVoiceValue(ctx.tenant_id, ctx.job_id, "voice_address_captured")) ||
    formatAddressLine(ctx)

  const callbackNumber =
    (await getLatestVoiceValue(ctx.tenant_id, ctx.job_id, "voice_callback_number_captured")) ||
    ctx.customer_phone ||
    "No callback number captured"

  const callbackTime =
    (await getLatestVoiceValue(ctx.tenant_id, ctx.job_id, "voice_callback_time_captured")) ||
    "No callback time provided"

  return {
    reason,
    customerName,
    propertyAddress,
    callbackNumber,
    callbackTime,
    emergencyTarpRequested: isEmergencyTarpReason(reason),
  }
}

export async function sendVoiceIntakeAlert(tenantSlug: string, jobId: number) {
  const ctx = await getJobContext(tenantSlug, jobId)
  const settings = await getDeveloperSettingsByTenantSlug(tenantSlug)
  const summary = await getVoiceSummary(tenantSlug, jobId)

  const header = summary.emergencyTarpRequested
    ? "URGENT DISPATCH SUMMARY"
    : "VOICE LEAD DISPATCH SUMMARY"

  const nextAction = summary.emergencyTarpRequested
    ? "Dispatch emergency tarp callback immediately."
    : "Call customer and schedule next step."

  const smsBody =
    `${header}\n` +
    `Customer: ${summary.customerName}\n` +
    `Job ID: ${jobId}\n` +
    `Need: ${summary.reason}\n` +
    `Phone: ${summary.callbackNumber}\n` +
    `Address: ${summary.propertyAddress}\n` +
    `Best time: ${summary.callbackTime}\n` +
    `Next: ${nextAction}`

  const emailSubject = summary.emergencyTarpRequested
    ? `URGENT dispatch: ${summary.customerName}`
    : `Dispatch summary: ${summary.customerName}`

  const emailBody =
    `${header}\n\n` +
    `Customer: ${summary.customerName}\n` +
    `Job ID: ${jobId}\n` +
    `Service Need: ${summary.reason}\n` +
    `Callback Number: ${summary.callbackNumber}\n` +
    `Property Address / ZIP: ${summary.propertyAddress}\n` +
    `Best Callback Time: ${summary.callbackTime}\n` +
    `Emergency Tarp: ${summary.emergencyTarpRequested ? "YES" : "NO"}\n` +
    `Recommended Next Action: ${nextAction}\n`

  let smsResult: any = null
  let emailResult: any = null

  const alertSmsTo =
    settings.alert_sms_to ||
    process.env.ALERT_SMS_TO ||
    process.env.ESCALATION_SMS_TO ||
    process.env.TWILIO_ALERT_TO ||
    ""

  const alertEmailTo =
    settings.alert_email_to ||
    process.env.ALERT_EMAIL_TO ||
    process.env.ESCALATION_EMAIL_TO ||
    ""

  try {
    smsResult = await sendSMS(alertSmsTo, smsBody)
  } catch (err: any) {
    smsResult = { error: err?.message || String(err) }
  }

  try {
    emailResult = await sendAlertEmail(alertEmailTo, emailSubject, emailBody)
  } catch (err: any) {
    emailResult = { error: err?.message || String(err) }
  }

  await addTimelineEvent(
    ctx.tenant_id,
    ctx.job_id,
    "voice_intake_alert_routed",
    `Voice intake alert sent to ${alertSmsTo} and ${alertEmailTo}`,
    {
      channel: "voice",
      alert_sms_to: alertSmsTo,
      alert_email_to: alertEmailTo,
      sms_result: smsResult,
      email_result: emailResult,
      sms_preview: smsBody,
      summary,
    }
  )


  try {
    const { planFollowUps } = await import("./conversationEngine")

    const workflowStage = "lead"

    await planFollowUps({
      tenant_id: ctx.tenant_id,
      job_id: ctx.job_id,
      stage: workflowStage,
      occurred_at: new Date().toISOString(),
    })

    await addTimelineEvent(
      ctx.tenant_id,
      ctx.job_id,
      "workflow_planned",
      `follow-ups scheduled after completed voice intake for stage=${workflowStage}`,
      {
        stage: workflowStage,
        source: "voice_intake_completed",
      }
    )
  } catch (err: any) {
    await addTimelineEvent(
      ctx.tenant_id,
      ctx.job_id,
      "workflow_plan_failed",
      "follow-up scheduling failed after completed voice intake",
      {
        error: err?.message || String(err),
        source: "voice_intake_completed",
      }
    )
  }
}

export async function getVoiceFinalConfirmation(tenantSlug: string, jobId: number) {
  const summary = await getVoiceSummary(tenantSlug, jobId)

  if (summary.emergencyTarpRequested) {
    return (
      `Thanks ${summary.customerName}. ` +
      `We received your emergency tarp request. ` +
      `Our team will call ${summary.callbackNumber} around ${summary.callbackTime}. Goodbye.`
    )
  }

  return (
    `Thanks ${summary.customerName}. ` +
    `We received your request about ${summary.reason}. ` +
    `We will call ${summary.callbackNumber} around ${summary.callbackTime}. Goodbye.`
  )
}

export async function getVoiceStatusResponse(tenantSlug: string, jobId: number, body: any) {
  const tenantId = await getTenantIdBySlug(tenantSlug)

  await addTimelineEvent(
    tenantId,
    jobId,
    "voice_call_status_received",
    `Twilio voice status: ${String(body.CallStatus || "unknown")}`,
    {
      channel: "voice",
      call_sid: String(body.CallSid || ""),
      call_status: String(body.CallStatus || ""),
      from: String(body.From || ""),
      to: String(body.To || ""),
      call_duration: String(body.CallDuration || ""),
    }
  )

  return { ok: true }
}
