// src/services/voiceIntakeService.ts

import { pool } from "../db/db"
import { getDeveloperSettingsByTenantSlug } from "./devSettingsService"
import { sendSMS } from "./twilioService"
import { sendAlertEmail } from "./emailService"
import {
  createLeadFromInboundCallByTenantSlug,
  getTenantIdBySlug,
  handleInboundMessageByTenantSlug,
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

/* =========================
   🔥 NEW: CLEAN NAME
========================= */
function cleanName(name: string | null | undefined) {
  if (!name) return "Inbound Caller"

  return name
    .replace(/^(um+|uh+|ah+|hey|hi|hello)[,\s]+/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

/* ========================= */

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
    if (/^\d+$/.test(part)) out += part
    else if (map[part]) out += map[part]
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

/* =========================
   🔥 CLEANED SUMMARY OUTPUT
========================= */

export async function getVoiceSummary(
  tenantSlug: string,
  jobId: number
): Promise<VoiceSummary> {
  const ctx = await getJobContext(tenantSlug, jobId)

  const reason =
    (await getLatestVoiceValue(ctx.tenant_id, ctx.job_id, "voice_reason_captured")) ||
    "General callback request"

  const rawName =
    (await getLatestVoiceValue(ctx.tenant_id, ctx.job_id, "voice_name_captured")) ||
    ctx.customer_name ||
    "Inbound Caller"

  const customerName = cleanName(rawName)

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

/* =========================
   🔥 IMPROVED ALERT
========================= */

export async function sendVoiceIntakeAlert(tenantSlug: string, jobId: number) {
  const ctx = await getJobContext(tenantSlug, jobId)
  const settings = await getDeveloperSettingsByTenantSlug(tenantSlug)
  const summary = await getVoiceSummary(tenantSlug, jobId)

  const isUrgent = summary.emergencyTarpRequested

  const header = isUrgent
    ? "🚨 URGENT DISPATCH SUMMARY"
    : "📞 VOICE LEAD DISPATCH SUMMARY"

  const nextAction = isUrgent
    ? "CALL IMMEDIATELY — Emergency tarp required."
    : "Call customer and schedule next step."

  const smsBody =
    `${header}\n` +
    `Customer: ${summary.customerName}\n` +
    `Need: ${summary.reason}\n` +
    `Phone: ${summary.callbackNumber}\n` +
    `Address: ${summary.propertyAddress}\n` +
    `Best time: ${summary.callbackTime}\n` +
    `Next: ${nextAction}`

  /* 🔥 MUCH BETTER SUBJECT */
  const emailSubject = isUrgent
    ? `🚨 CALL NOW — ${summary.customerName} (Emergency)`
    : `📞 New Lead — ${summary.customerName}`

  const emailBody =
    `${header}\n\n` +
    `Customer: ${summary.customerName}\n` +
    `Job ID: ${jobId}\n` +
    `Service Need: ${summary.reason}\n` +
    `Callback Number: ${summary.callbackNumber}\n` +
    `Property Address: ${summary.propertyAddress}\n` +
    `Best Callback Time: ${summary.callbackTime}\n\n` +
    `Recommended Action:\n${nextAction}\n`

  let smsResult: any = null
  let emailResult: any = null

  const alertSmsTo =
    settings.alert_sms_to ||
    process.env.ALERT_SMS_TO ||
    ""

  const alertEmailTo =
    settings.alert_email_to ||
    process.env.ALERT_EMAIL_TO ||
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
    `Voice intake alert sent`,
    {
      alert_sms_to: alertSmsTo,
      alert_email_to: alertEmailTo,
      summary,
    }
  )
}
