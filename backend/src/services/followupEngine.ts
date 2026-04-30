import { pool } from "../db/db"
import { sendSMS } from "./twilioService"
import { sendAlertEmail } from "./emailService"
import { getDeveloperSettingsByTenantSlug, type DevSettings } from "./devSettingsService"
import { isPhoneDnc } from "./dncService"

type JobRow = {
  id: number
  tenant_id: number
  customer_id: number | null
  stage: string | null
  zip: string | null
  carrier: string | null
  claim_number: string | null
  lead_source: string | null
  lead_source_detail: string | null
  marketing_campaign: string | null
  bot_paused: boolean
  contract_status: string | null
  estimate_status: string | null
  manual_owner: string | null
  customer_name: string | null
  address1?: string | null
  city?: string | null
  state?: string | null
  crm_flow_key?: string | null
  crm_substatus?: string | null
}

type TimelineRow = {
  id: number
  kind: string
  message: string
  meta: any
  created_at: string
}

type AlertTargets = {
  alert_sms_to: string | null
  alert_email_to: string | null
}

type InboundClassification =
  | "estimate_request"
  | "inspection_request"
  | "callback_request"
  | "contract_request"
  | "pricing_objection"
  | "general_question"
  | "buying_signal_only"
  | "unknown"

const BUYING_SIGNAL_PATTERNS = [
  "ready to move forward",
  "send contract",
  "when can you start",
  "what is the next step",
  "next step",
  "how do i sign",
  "where do i sign",
  "please call me",
  "call me",
  "can someone call me",
  "i'm ready",
  "im ready",
  "we are ready",
  "can we get started",
  "let's do it",
  "lets do it",
]

function normalizePhone(phone: string | null | undefined) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (phone.startsWith("+")) return phone
  return digits ? `+${digits}` : null
}

function normalizeEmail(email: string | null | undefined) {
  if (!email) return null
  const cleaned = email.trim().toLowerCase()
  return cleaned || null
}

function cleanPart(value: string | null | undefined) {
  return value && value.trim() ? value.trim() : ""
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }
  return null
}

function resolveAlertTargets(settings: Partial<DevSettings> | null | undefined): AlertTargets {
  const alert_sms_to = normalizePhone(
    firstNonEmpty(
      settings?.alert_sms_to,
      process.env.ALERT_SMS_TO,
      process.env.ESCALATION_SMS_TO,
      process.env.TWILIO_ALERT_TO
    )
  )

  const alert_email_to = normalizeEmail(
    firstNonEmpty(
      settings?.alert_email_to,
      process.env.ALERT_EMAIL_TO,
      process.env.ESCALATION_EMAIL_TO
    )
  )

  return { alert_sms_to, alert_email_to }
}

function buildAddressLine(job: JobRow) {
  const address1 = cleanPart(job.address1)
  const city = cleanPart(job.city)
  const state = cleanPart(job.state)
  const zip = cleanPart(job.zip || "")
  const cityState = [city, state].filter(Boolean).join(", ")
  const secondLine = [cityState, zip].filter(Boolean).join(" ")
  return [address1, secondLine].filter(Boolean).join(" | ") || "Address not yet available"
}

function fillTemplate(message: string, customerName: string | null) {
  const name = customerName && customerName.trim() ? customerName.trim() : "there"
  return message.replace(/\{\{\s*name\s*\}\}/gi, name)
}

function buildAlertMeta(
  channelLabel: string,
  alertTargets: AlertTargets,
  smsResult: any,
  emailResult: any,
  smsPreview: string
) {
  return {
    channel: channelLabel,
    alert_sms_to: alertTargets.alert_sms_to,
    alert_email_to: alertTargets.alert_email_to,
    sms_result: smsResult,
    email_result: emailResult,
    sms_preview: smsPreview,
  }
}

export async function getTenantIdBySlug(slug: string): Promise<number> {
  const result = await pool.query(`select id from tenants where slug = $1 limit 1`, [slug])

  if (!result.rowCount) {
    throw new Error(`Tenant not found: ${slug}`)
  }

  return Number(result.rows[0].id)
}

async function getJob(tenantId: number, jobId: number): Promise<JobRow> {
  const result = await pool.query(
    `
    select
      j.id,
      j.tenant_id,
      j.customer_id,
      j.stage,
      j.zip,
      j.carrier,
      j.claim_number,
      j.lead_source,
      j.lead_source_detail,
      j.marketing_campaign,
      j.bot_paused,
      j.contract_status,
      j.estimate_status,
      j.manual_owner,
      j.address1,
      j.city,
      j.state,
      j.crm_flow_key,
      j.crm_substatus,
      c.full_name as customer_name
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

  return result.rows[0] as JobRow
}

async function getCustomerPhone(tenantId: number, customerId: number | null) {
  if (!customerId) return null

  const result = await pool.query(
    `
    select phone
    from customers
    where tenant_id = $1
      and id = $2
    limit 1
    `,
    [tenantId, customerId]
  )

  if (!result.rowCount) return null
  return normalizePhone(result.rows[0].phone)
}

async function getTimeline(tenantId: number, jobId: number): Promise<TimelineRow[]> {
  const result = await pool.query(
    `
    select id, kind, message, meta, created_at
    from timeline_events
    where tenant_id = $1
      and job_id = $2
    order by created_at asc, id asc
    `,
    [tenantId, jobId]
  )

  return result.rows as TimelineRow[]
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

function countExistingAiMessagesForStage(timeline: TimelineRow[], stage: string) {
  return timeline.filter((t) => {
    const kind = t.kind.toLowerCase()
    const metaStage = String(t.meta?.stage || "")
    return (
      ["ai_message_generated", "ai_message_sent", "ai_message_send_failed"].includes(kind) &&
      metaStage === stage
    )
  }).length
}

function hasTimelineKind(timeline: TimelineRow[], kind: string) {
  const target = kind.toLowerCase()
  return timeline.some((t) => String(t.kind || "").toLowerCase() === target)
}

function getStageMessages(settings: DevSettings, stage: string | null) {
  if (stage === "lead") return settings.lead_messages
  if (stage === "estimate_sent") return settings.estimate_messages
  if (stage === "contract_sent") return settings.contract_messages
  return []
}

function buildAiMessage(job: JobRow, timeline: TimelineRow[], settings: DevSettings) {
  if (!job.stage) return null

  const stageMessages = getStageMessages(settings, job.stage)
  if (!stageMessages.length) return null

  const count = countExistingAiMessagesForStage(timeline, job.stage)
  const rawMessage = stageMessages[Math.min(count, stageMessages.length - 1)]

  return {
    stage: job.stage,
    order: count + 1,
    message: fillTemplate(rawMessage, job.customer_name),
  }
}

function detectBuyingSignals(message: string) {
  const normalized = message.toLowerCase()
  return BUYING_SIGNAL_PATTERNS.filter((pattern) => normalized.includes(pattern))
}

function containsAny(text: string, patterns: string[]) {
  return patterns.some((p) => text.includes(p))
}

function classifyInboundMessage(message: string): InboundClassification {
  const text = message.toLowerCase()

  const estimateRequestPatterns = [
    "estimate",
    "roof estimate",
    "replace my roof",
    "roof replacement",
    "need a roof estimate",
    "need an estimate",
    "want an estimate",
    "quote my roof",
  ]

  const inspectionRequestPatterns = [
    "inspection",
    "inspect",
    "check my roof",
    "roof inspection",
    "schedule an inspection",
  ]

  const callbackPatterns = [
    "call me",
    "please call me",
    "can you call me",
    "have someone call",
    "callback",
    "call back",
  ]

  const contractPatterns = [
    "send contract",
    "send me the contract",
    "where do i sign",
    "how do i sign",
    "contract",
    "paperwork",
  ]

  const pricingObjectionPatterns = [
    "better price",
    "lower price",
    "discount",
    "too expensive",
    "price is high",
    "price seems high",
  ]

  const questionPatterns = [
    "what is",
    "what's",
    "how soon",
    "when can",
    "can you help",
    "can you tell me",
    "need more information",
    "existing job",
    "question",
  ]

  if (containsAny(text, estimateRequestPatterns)) return "estimate_request"
  if (containsAny(text, inspectionRequestPatterns)) return "inspection_request"
  if (containsAny(text, callbackPatterns)) return "callback_request"
  if (containsAny(text, contractPatterns)) return "contract_request"
  if (containsAny(text, pricingObjectionPatterns)) return "pricing_objection"

  const buyingSignals = detectBuyingSignals(text)
  if (buyingSignals.length) return "buying_signal_only"

  if (containsAny(text, questionPatterns) || text.includes("?")) return "general_question"

  return "unknown"
}

function buildClassificationReply(
  classification: InboundClassification,
  customerName: string | null,
  settings: DevSettings
) {
  const map = settings.inbound_auto_replies
  const raw =
    map[classification] ||
    map.unknown ||
    "Thanks {{name}}. We received your message and our team will follow up shortly."

  return fillTemplate(raw, customerName)
}

async function updateJobRoutingForClassification(
  tenantId: number,
  jobId: number,
  classification: InboundClassification
) {
  let crmSubstatus: string | null = null
  let crmFlowKey: string | null = null

  if (classification === "estimate_request") {
    crmSubstatus = "estimate_requested"
    crmFlowKey = "inbound_estimate_request"
  } else if (classification === "inspection_request") {
    crmSubstatus = "inspection_requested"
    crmFlowKey = "inbound_inspection_request"
  } else if (classification === "callback_request") {
    crmSubstatus = "callback_requested"
    crmFlowKey = "inbound_callback_request"
  } else if (classification === "contract_request") {
    crmSubstatus = "contract_requested"
    crmFlowKey = "inbound_contract_request"
  } else if (classification === "pricing_objection") {
    crmSubstatus = "pricing_objection"
    crmFlowKey = "inbound_pricing_objection"
  } else if (classification === "general_question") {
    crmSubstatus = "question_received"
    crmFlowKey = "inbound_general_question"
  } else if (classification === "buying_signal_only") {
    crmSubstatus = "buying_signal_received"
    crmFlowKey = "inbound_buying_signal"
  } else {
    crmSubstatus = "message_received"
    crmFlowKey = "inbound_message_received"
  }

  await pool.query(
    `
    update jobs
    set
      crm_substatus = $3,
      crm_flow_key = $4,
      updated_at = now()
    where tenant_id = $1
      and id = $2
    `,
    [tenantId, jobId, crmSubstatus, crmFlowKey]
  )

  return { crm_substatus: crmSubstatus, crm_flow_key: crmFlowKey }
}

function buildDispatcherSummary(
  label: string,
  job: JobRow,
  body: {
    classification?: string
    message?: string
    callbackNumber?: string | null
    nextAction?: string
    channel?: string
  }
) {
  const customer = job.customer_name || "Inbound Caller"
  const address = buildAddressLine(job)

  const sms =
    `${label}\n` +
    `Customer: ${customer}\n` +
    `Job ID: ${job.id}\n` +
    `${body.classification ? `Need: ${body.classification}\n` : ""}` +
    `${body.callbackNumber ? `Phone: ${body.callbackNumber}\n` : ""}` +
    `Address: ${address}\n` +
    `${body.message ? `Message: ${body.message}\n` : ""}` +
    `${body.nextAction ? `Next: ${body.nextAction}` : ""}`

  const email =
    `${label}\n\n` +
    `Customer: ${customer}\n` +
    `Job ID: ${job.id}\n` +
    `Stage: ${job.stage || "unknown"}\n` +
    `Address: ${address}\n` +
    `${body.callbackNumber ? `Callback Number: ${body.callbackNumber}\n` : ""}` +
    `${body.channel ? `Channel: ${body.channel}\n` : ""}` +
    `${body.classification ? `Classification: ${body.classification}\n` : ""}` +
    `${body.message ? `Customer Message: ${body.message}\n` : ""}` +
    `${body.nextAction ? `Recommended Next Action: ${body.nextAction}\n` : ""}`

  return { sms, email }
}

async function sendAutoClassificationReply(
  tenantId: number,
  jobId: number,
  job: JobRow,
  classification: InboundClassification,
  settings: DevSettings,
  fallbackPhone: string | null
) {
  const phone = (await getCustomerPhone(tenantId, job.customer_id)) || fallbackPhone
  if (!phone) {
    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_message_send_failed",
      "Auto-response could not be sent because customer phone is missing",
      {
        stage: job.stage,
        channel: "sms",
        classification,
      }
    )

    return { sent: false, reason: "missing_phone" }
  }

  const dnc = await isPhoneDnc(tenantId, phone)
  if (dnc) {
    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_message_skipped",
      "Auto-response skipped because phone is marked DNC",
      {
        stage: job.stage,
        classification,
        channel: "sms",
        to: phone,
      }
    )

    return { sent: false, reason: "dnc" }
  }

  const replyMessage = buildClassificationReply(classification, job.customer_name, settings)

  await addTimelineEvent(
    tenantId,
    jobId,
    "ai_inbound_response_generated",
    replyMessage,
    {
      stage: job.stage,
      classification,
      sender: "Good2Go Roofing Team",
    }
  )

  try {
    const sms = await sendSMS(phone, replyMessage)

    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_inbound_response_sent",
      replyMessage,
      {
        stage: job.stage,
        classification,
        sender: "Good2Go Roofing Team",
        channel: "sms",
        to: phone,
        twilio_sid: sms.sid,
        twilio_status: sms.status,
      }
    )

    return { sent: true, to: phone, twilio_sid: sms.sid }
  } catch (err: any) {
    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_message_send_failed",
      `Auto-response failed to send: ${err?.message || String(err)}`,
      {
        stage: job.stage,
        classification,
        channel: "sms",
        to: phone,
      }
    )

    return { sent: false, error: err?.message || String(err) }
  }
}

async function sendBuyingSignalAlerts(
  job: JobRow,
  inboundMessage: string,
  matchedSignals: string[],
  settings: DevSettings,
  callbackNumber: string | null
) {
  const alertTargets = resolveAlertTargets(settings)

  console.log("🚨 ALERT TARGET DEBUG", {
    alert_email_from_settings: settings?.alert_email_to,
    alert_email_final: alertTargets.alert_email_to,
  });
  const summary = buildDispatcherSummary("BUYING SIGNAL DISPATCH SUMMARY", job, {
    callbackNumber,
    message: inboundMessage,
    nextAction: `Call customer promptly. Signals: ${matchedSignals.join(", ")}`,
    channel: "sms",
  })

  let smsResult: any = null
  let emailResult: any = null

  console.log("📣 BUYING SIGNAL ALERT TARGETS", {
    alert_sms_to: alertTargets.alert_sms_to,
    alert_email_to: alertTargets.alert_email_to,
    matchedSignals,
    jobId: job.id,
  })

  if (false && alertTargets.alert_sms_to) {
    try {
      smsResult = await sendSMS(alertTargets.alert_sms_to, summary.sms)
    } catch (err: any) {
      smsResult = { error: err?.message || String(err) }
    }
  } else {
    smsResult = { skipped: true, reason: "missing_alert_sms_to" }
  }

  if (alertTargets.alert_email_to) {
    try {
      emailResult = await sendAlertEmail(
        alertTargets.alert_email_to,
        `Buying signal: ${job.customer_name || `Job #${job.id}`}`,
        summary.email
      )
    } catch (err: any) {
      emailResult = { error: err?.message || String(err) }
    }
  } else {
    emailResult = { skipped: true, reason: "missing_alert_email_to" }
  }

  return {
    sms: smsResult,
    email: emailResult,
    sms_preview: summary.sms,
    alertTargets,
  }
}

async function sendActionAlert(
  job: JobRow,
  classification: InboundClassification,
  inboundMessage: string,
  settings: DevSettings,
  callbackNumber: string | null,
  channel: "sms" | "voice"
) {
  const alertTargets = resolveAlertTargets(settings)

  const nextActionMap: Record<string, string> = {
    estimate_request: "Call customer and schedule estimate / inspection.",
    inspection_request: "Call customer and confirm inspection timing.",
    callback_request: "Return call as soon as possible.",
    contract_request: "Send contract / paperwork and confirm next step.",
    pricing_objection: "Call customer and address pricing concerns.",
    general_question: "Call or text customer with answers.",
    buying_signal_only: "Call customer promptly; strong buying intent.",
    unknown: "Review message and decide next action.",
  }

  const summary = buildDispatcherSummary("ACTION NEEDED DISPATCH SUMMARY", job, {
    classification,
    message: inboundMessage,
    callbackNumber,
    nextAction: nextActionMap[classification] || "Review and follow up.",
    channel,
  })

  let smsResult: any = null
  let emailResult: any = null

  console.log("📣 ACTION ALERT TARGETS", {
    alert_sms_to: alertTargets.alert_sms_to,
    alert_email_to: alertTargets.alert_email_to,
    classification,
    jobId: job.id,
    channel,
  })

  if (false && alertTargets.alert_sms_to) {
    try {
      smsResult = await sendSMS(alertTargets.alert_sms_to, summary.sms)
    } catch (err: any) {
      smsResult = { error: err?.message || String(err) }
    }
  } else {
    smsResult = { skipped: true, reason: "missing_alert_sms_to" }
  }

  if (alertTargets.alert_email_to) {
    try {
      emailResult = await sendAlertEmail(
        alertTargets.alert_email_to,
        `Action needed: ${classification} - ${job.customer_name || `Job #${job.id}`}`,
        summary.email
      )
    } catch (err: any) {
      emailResult = { error: err?.message || String(err) }
    }
  } else {
    emailResult = { skipped: true, reason: "missing_alert_email_to" }
  }

  return {
    sms: smsResult,
    email: emailResult,
    sms_preview: summary.sms,
    alertTargets,
  }
}

async function sendNewLeadAlert(job: JobRow, settings: DevSettings, callbackNumber: string | null) {
  const alertTargets = resolveAlertTargets(settings)

  const summary = buildDispatcherSummary("NEW LEAD DISPATCH SUMMARY", job, {
    callbackNumber,
    nextAction: "Review lead and call customer.",
    channel: "voice",
  })

  let smsResult: any = null
  let emailResult: any = null

  console.log("📣 NEW LEAD ALERT TARGETS", {
    alert_sms_to: alertTargets.alert_sms_to,
    alert_email_to: alertTargets.alert_email_to,
    jobId: job.id,
  })

  if (false && alertTargets.alert_sms_to) {
    try {
      smsResult = await sendSMS(alertTargets.alert_sms_to, summary.sms)
    } catch (err: any) {
      smsResult = { error: err?.message || String(err) }
    }
  } else {
    smsResult = { skipped: true, reason: "missing_alert_sms_to" }
  }

  if (alertTargets.alert_email_to) {
    try {
      emailResult = await sendAlertEmail(
        alertTargets.alert_email_to,
        `New lead: ${job.customer_name || `Job #${job.id}`}`,
        summary.email
      )
    } catch (err: any) {
      emailResult = { error: err?.message || String(err) }
    }
  } else {
    emailResult = { skipped: true, reason: "missing_alert_email_to" }
  }

  return {
    sms: smsResult,
    email: emailResult,
    sms_preview: summary.sms,
    alertTargets,
  }
}

async function sendNewEstimateAlert(job: JobRow, settings: DevSettings, callbackNumber: string | null) {
  const alertTargets = resolveAlertTargets(settings)

  const summary = buildDispatcherSummary("NEW ESTIMATE DISPATCH SUMMARY", job, {
    callbackNumber,
    nextAction: "Review estimate and follow up.",
    channel: "sms",
  })

  let smsResult: any = null
  let emailResult: any = null

  console.log("📣 NEW ESTIMATE ALERT TARGETS", {
    alert_sms_to: alertTargets.alert_sms_to,
    alert_email_to: alertTargets.alert_email_to,
    jobId: job.id,
  })

  if (false && alertTargets.alert_sms_to) {
    try {
      smsResult = await sendSMS(alertTargets.alert_sms_to, summary.sms)
    } catch (err: any) {
      smsResult = { error: err?.message || String(err) }
    }
  } else {
    smsResult = { skipped: true, reason: "missing_alert_sms_to" }
  }

  if (alertTargets.alert_email_to) {
    try {
      emailResult = await sendAlertEmail(
        alertTargets.alert_email_to,
        `New estimate: ${job.customer_name || `Job #${job.id}`}`,
        summary.email
      )
    } catch (err: any) {
      emailResult = { error: err?.message || String(err) }
    }
  } else {
    emailResult = { skipped: true, reason: "missing_alert_email_to" }
  }

  return {
    sms: smsResult,
    email: emailResult,
    sms_preview: summary.sms,
    alertTargets,
  }
}

export async function queueAiFollowupByTenantSlug(tenantSlug: string, jobId: number) {
  const tenantId = await getTenantIdBySlug(tenantSlug)
  const settings = await getDeveloperSettingsByTenantSlug(tenantSlug)
  const alertTargets = resolveAlertTargets(settings)
  const job = await getJob(tenantId, jobId)

  if (job.bot_paused) {
    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_message_skipped",
      "AI follow-up skipped because bot is paused",
      { stage: job.stage, reason: "bot_paused" }
    )

    return { ok: true, skipped: true, reason: "bot_paused" }
  }

  const callbackNumber = await getCustomerPhone(tenantId, job.customer_id)
  const customerIsDnc = await isPhoneDnc(tenantId, callbackNumber)

  const timelineBefore = await getTimeline(tenantId, jobId)

  if (job.stage === "lead" && !hasTimelineKind(timelineBefore, "new_lead_alert_routed")) {
    const alertResults = await sendNewLeadAlert(job, settings, callbackNumber)

    await addTimelineEvent(
      tenantId,
      jobId,
      "new_lead_alert_routed",
      `New lead alert processed for ${alertTargets.alert_sms_to || "no-sms-target"} and ${alertTargets.alert_email_to || "no-email-target"}`,
      buildAlertMeta(
        "lead",
        alertResults.alertTargets,
        alertResults.sms,
        alertResults.email,
        alertResults.sms_preview
      )
    )
  }

  if (job.stage === "estimate_sent" && !hasTimelineKind(timelineBefore, "new_estimate_alert_routed")) {
    const alertResults = await sendNewEstimateAlert(job, settings, callbackNumber)

    await addTimelineEvent(
      tenantId,
      jobId,
      "new_estimate_alert_routed",
      `New estimate alert processed for ${alertTargets.alert_sms_to || "no-sms-target"} and ${alertTargets.alert_email_to || "no-email-target"}`,
      buildAlertMeta(
        "estimate",
        alertResults.alertTargets,
        alertResults.sms,
        alertResults.email,
        alertResults.sms_preview
      )
    )
  }

  const timeline = await getTimeline(tenantId, jobId)
  const aiMessage = buildAiMessage(job, timeline, settings)

  if (!aiMessage) {
    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_message_skipped",
      "AI follow-up skipped because stage is not automated yet",
      { stage: job.stage }
    )

    return { ok: true, skipped: true, reason: "stage_not_supported" }
  }

  await addTimelineEvent(
    tenantId,
    jobId,
    "ai_message_generated",
    aiMessage.message,
    {
      stage: aiMessage.stage,
      order: aiMessage.order,
      sender: "Good2Go Roofing Team",
    }
  )

  if (!callbackNumber) {
    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_message_send_failed",
      "AI message could not be sent because customer phone is missing",
      {
        stage: aiMessage.stage,
        order: aiMessage.order,
      }
    )

    return {
      ok: true,
      skipped: false,
      tenant_id: tenantId,
      job_id: jobId,
      stage: aiMessage.stage,
      order: aiMessage.order,
      message: aiMessage.message,
      sent: false,
      reason: "missing_phone",
    }
  }

  if (customerIsDnc) {
    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_message_skipped",
      "AI message skipped because phone is marked DNC",
      {
        stage: aiMessage.stage,
        order: aiMessage.order,
        to: callbackNumber,
      }
    )

    return {
      ok: true,
      skipped: true,
      reason: "dnc",
      tenant_id: tenantId,
      job_id: jobId,
      to: callbackNumber,
    }
  }

  try {
    const sms = await sendSMS(callbackNumber, aiMessage.message)

    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_message_sent",
      aiMessage.message,
      {
        stage: aiMessage.stage,
        order: aiMessage.order,
        sender: "Good2Go Roofing Team",
        channel: "sms",
        to: callbackNumber,
        twilio_sid: sms.sid,
        twilio_status: sms.status,
      }
    )

    return {
      ok: true,
      skipped: false,
      tenant_id: tenantId,
      job_id: jobId,
      stage: aiMessage.stage,
      order: aiMessage.order,
      message: aiMessage.message,
      sent: true,
      to: callbackNumber,
      twilio_sid: sms.sid,
    }
  } catch (err: any) {
    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_message_send_failed",
      `AI message failed to send: ${err?.message || String(err)}`,
      {
        stage: aiMessage.stage,
        order: aiMessage.order,
        to: callbackNumber,
      }
    )

    return {
      ok: true,
      skipped: false,
      tenant_id: tenantId,
      job_id: jobId,
      stage: aiMessage.stage,
      order: aiMessage.order,
      message: aiMessage.message,
      sent: false,
      to: callbackNumber,
      error: err?.message || String(err),
    }
  }
}

export async function handleInboundMessageByTenantSlug(
  tenantSlug: string,
  jobId: number,
  inboundMessage: string,
  from: string | null
) {
  const tenantId = await getTenantIdBySlug(tenantSlug)
  const settings = await getDeveloperSettingsByTenantSlug(tenantSlug)
  const alertTargets = resolveAlertTargets(settings)
  const job = await getJob(tenantId, jobId)
  const trimmed = inboundMessage.trim()
  const callbackNumber = (await getCustomerPhone(tenantId, job.customer_id)) || normalizePhone(from)

  await addTimelineEvent(
    tenantId,
    jobId,
    "customer_reply",
    trimmed,
    {
      from,
      channel: "sms",
    }
  )

  const customerReplyAlertText =
    `CUSTOMER RESPONSE ALERT\n` +
    `Customer: ${job.customer_name || "Unknown Customer"}\n` +
    `Job ID: ${jobId}\n` +
    `Phone: ${callbackNumber || from || "Unknown"}\n\n` +
    `Message:\n${trimmed}\n\n` +
    `Next: Review this customer response and reply if needed.`

  let customerReplySmsResult: any = null
  let customerReplyEmailResult: any = null

  if (false && alertTargets.alert_sms_to) {
    try {
      customerReplySmsResult = await sendSMS(alertTargets.alert_sms_to, customerReplyAlertText)
    } catch (err: any) {
      customerReplySmsResult = { error: err?.message || String(err) }
    }
  } else {
    customerReplySmsResult = { skipped: true, reason: "missing_alert_sms_to" }
  }

  if (alertTargets.alert_email_to) {
    try {
      customerReplyEmailResult = await sendAlertEmail(
        alertTargets.alert_email_to,
        `Customer response: ${job.customer_name || `Job #${jobId}`}`,
        customerReplyAlertText
      )
    } catch (err: any) {
      customerReplyEmailResult = { error: err?.message || String(err) }
    }
  } else {
    customerReplyEmailResult = { skipped: true, reason: "missing_alert_email_to" }
  }

  await addTimelineEvent(
    tenantId,
    jobId,
    "customer_reply_alert_routed",
    "Customer response alert routed to internal team",
    {
      from,
      channel: "sms",
      alert_sms_to: alertTargets.alert_sms_to,
      alert_email_to: alertTargets.alert_email_to,
      sms_result: customerReplySmsResult,
      email_result: customerReplyEmailResult,
      sms_preview: customerReplyAlertText,
    }
  )

  const classification = classifyInboundMessage(trimmed)
  const routing = await updateJobRoutingForClassification(tenantId, jobId, classification)

  await addTimelineEvent(
    tenantId,
    jobId,
    "inbound_message_classified",
    `Inbound message classified as ${classification}`,
    {
      classification,
      crm_substatus: routing.crm_substatus,
      crm_flow_key: routing.crm_flow_key,
      from,
      channel: "sms",
    }
  )

  await addTimelineEvent(
    tenantId,
    jobId,
    "next_action_routed",
    `Next action routed for ${classification}`,
    {
      classification,
      crm_substatus: routing.crm_substatus,
      crm_flow_key: routing.crm_flow_key,
    }
  )

  const actionAlertResults = await sendActionAlert(
    job,
    classification,
    trimmed,
    settings,
    callbackNumber,
    "sms"
  )

  await addTimelineEvent(
    tenantId,
    jobId,
    "action_alert_routed",
    `Action alert processed for ${classification}`,
    buildAlertMeta(
      "sms_reply_action",
      actionAlertResults.alertTargets,
      actionAlertResults.sms,
      actionAlertResults.email,
      actionAlertResults.sms_preview
    )
  )

  await sendAutoClassificationReply(
    tenantId,
    jobId,
    job,
    classification,
    settings,
    callbackNumber
  )

  const matchedSignals = detectBuyingSignals(trimmed)

  if (matchedSignals.length) {
    await addTimelineEvent(
      tenantId,
      jobId,
      "buying_signal_detected",
      "Buying signal detected from customer reply",
      {
        matched_signals: matchedSignals,
        alert_sms_to: alertTargets.alert_sms_to,
        alert_email_to: alertTargets.alert_email_to,
      }
    )

    const alertResults = await sendBuyingSignalAlerts(
      job,
      trimmed,
      matchedSignals,
      settings,
      callbackNumber
    )

    await addTimelineEvent(
      tenantId,
      jobId,
      "alert_routed",
      "Buying signal alert processed",
      buildAlertMeta(
        "buying_signal",
        alertResults.alertTargets,
        alertResults.sms,
        alertResults.email,
        alertResults.sms_preview
      )
    )
  }

  return {
    ok: true,
    tenant_id: tenantId,
    job_id: jobId,
    classification,
    crm_substatus: routing.crm_substatus,
    crm_flow_key: routing.crm_flow_key,
    matched_signals: matchedSignals,
    alert_sms_to: alertTargets.alert_sms_to,
    alert_email_to: alertTargets.alert_email_to,
  }
}

export async function getAiConversationByTenantSlug(tenantSlug: string, jobId: number) {
  const tenantId = await getTenantIdBySlug(tenantSlug)
  const timeline = await getTimeline(tenantId, jobId)

  const conversation = timeline
    .filter((t) =>
      [
        "ai_message_generated",
        "ai_message_sent",
        "ai_message_send_failed",
        "ai_message_skipped",
        "customer_reply",
        "buying_signal_detected",
        "alert_routed",
        "new_lead_alert_routed",
        "new_estimate_alert_routed",
        "inbound_message_classified",
        "next_action_routed",
        "action_alert_routed",
        "ai_inbound_response_generated",
        "ai_inbound_response_sent",
        "voice_call_received",
        "voice_ai_summary_created",
        "lead_created_from_call",
        "voice_reason_captured",
        "voice_name_captured",
        "voice_address_captured",
        "voice_callback_number_captured",
        "voice_callback_time_captured",
        "voice_emergency_tarp_detected",
        "voice_intake_alert_routed",
        "voice_ai_response_spoken",
        "dnc_marked",
        "dnc_cleared",
      ].includes(t.kind.toLowerCase())
    )
    .map((t) => ({
      id: t.id,
      kind: t.kind,
      message: t.message,
      meta: t.meta || {},
      created_at: t.created_at,
    }))

  return {
    ok: true,
    tenant_id: tenantId,
    job_id: jobId,
    conversation,
  }
}

export async function createLeadFromInboundCallByTenantSlug(
  tenantSlug: string,
  payload: {
    callerPhone: string | null
    callerName?: string | null
    notes?: string | null
    source?: string | null
  }
) {
  const tenantId = await getTenantIdBySlug(tenantSlug)
  const settings = await getDeveloperSettingsByTenantSlug(tenantSlug)
  const phone = normalizePhone(payload.callerPhone)
  const fullName = payload.callerName?.trim() || "Inbound Caller"
  const source = payload.source?.trim() || "Phone Call"
  const notes = payload.notes?.trim() || "Inbound voice AI lead created"

  const customerResult = await pool.query(
    `
    insert into customers
      (tenant_id, full_name, phone, created_at, updated_at)
    values
      ($1, $2, $3, now(), now())
    returning id
    `,
    [tenantId, fullName, phone]
  )

  const customerId = Number(customerResult.rows[0].id)

  const jobResult = await pool.query(
    `
    insert into jobs
      (
        tenant_id,
        customer_id,
        external_crm,
        external_customer_id,
        external_job_id,
        job_type,
        stage,
        address1,
        city,
        state,
        zip,
        lead_source,
        lead_source_detail,
        created_at,
        updated_at
      )
    values
      (
        $1,
        $2,
        'twilio_voice',
        null,
        $3,
        'INSPECTION',
        'lead',
        null,
        null,
        null,
        null,
        $4,
        'voice_ai',
        now(),
        now()
      )
    returning id
    `,
    [tenantId, customerId, `voice-${Date.now()}`, source]
  )

  const jobId = Number(jobResult.rows[0].id)

  await addTimelineEvent(
    tenantId,
    jobId,
    "voice_call_received",
    "Inbound call received on Twilio number",
    {
      from: phone,
      source,
    }
  )

  await addTimelineEvent(
    tenantId,
    jobId,
    "voice_ai_summary_created",
    notes,
    {
      from: phone,
      source,
    }
  )

  await addTimelineEvent(
    tenantId,
    jobId,
    "lead_created_from_call",
    "Lead created from inbound voice AI call",
    {
      from: phone,
      source,
    }
  )

  if (!hasTimelineKind(await getTimeline(tenantId, jobId), "new_lead_alert_routed")) {
    const alertResults = await sendNewLeadAlert(
      await getJob(tenantId, jobId),
      settings,
      phone
    )

    await addTimelineEvent(
      tenantId,
      jobId,
      "new_lead_alert_routed",
      "New voice lead alert processed",
      buildAlertMeta(
        "voice_lead",
        alertResults.alertTargets,
        alertResults.sms,
        alertResults.email,
        alertResults.sms_preview
      )
    )
  }

  return {
    ok: true,
    tenant_id: tenantId,
    customer_id: customerId,
    job_id: jobId,
    source,
  }
}
