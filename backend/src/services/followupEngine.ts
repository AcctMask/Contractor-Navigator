import { pool } from "../db/db"
import { sendSMS } from "./twilioService"
import { sendAlertEmail } from "./emailService"
import { getDeveloperSettingsByTenantSlug, type DevSettings } from "./devSettingsService"

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
  "can you do it for",
  "do you offer veteran discounts",
  "do you use peel and stick",
  "do you have a backlog",
  "how soon can you schedule",
  "what is your availability",
  "when are you available",
  "want to move forward",
  "how do i sign",
  "how do we sign",
  "can we get started",
  "lets do it",
  "let's do it",
  "i'm ready",
  "im ready",
  "we are ready",
  "i want to proceed",
  "can you send it again",
  "where do i sign",
  "please call me",
  "call me",
  "need more information",
  "can someone call me",
  "can you tell me more",
]

function normalizePhone(phone: string | null | undefined) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (phone.startsWith("+")) return phone
  return digits ? `+${digits}` : null
}

function cleanPart(value: string | null | undefined) {
  return value && value.trim() ? value.trim() : ""
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
    "i'd like an estimate",
    "id like an estimate",
    "need an estimate",
    "want an estimate",
    "can i get an estimate",
    "can you give me an estimate",
    "quote my roof",
    "replace my roof",
    "roof replacement estimate",
    "need a roof replacement",
  ]

  const inspectionRequestPatterns = [
    "need an inspection",
    "want an inspection",
    "can you inspect",
    "roof inspection",
    "come inspect",
    "check my roof",
    "can someone inspect",
  ]

  const callbackPatterns = [
    "call me",
    "please call me",
    "can you call me",
    "give me a call",
    "have someone call",
    "callback",
    "call back",
  ]

  const contractPatterns = [
    "send contract",
    "send me the contract",
    "where do i sign",
    "how do i sign",
    "how do we sign",
    "send paperwork",
    "send the paperwork",
    "contract",
  ]

  const pricingObjectionPatterns = [
    "can you do it for less",
    "little less",
    "better price",
    "lower price",
    "discount",
    "too expensive",
    "price is high",
    "price seems high",
    "veteran discount",
  ]

  const questionPatterns = [
    "what can you do",
    "do you offer",
    "how soon",
    "when can",
    "can you help",
    "how does",
    "what is",
    "what's",
    "do you use",
    "can you tell me",
    "need more information",
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

async function sendAutoClassificationReply(
  tenantId: number,
  jobId: number,
  job: JobRow,
  classification: InboundClassification,
  settings: DevSettings
) {
  const phone = await getCustomerPhone(tenantId, job.customer_id)
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

    return {
      sent: false,
      reason: "missing_phone",
    }
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

    return {
      sent: true,
      to: phone,
      twilio_sid: sms.sid,
    }
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

    return {
      sent: false,
      error: err?.message || String(err),
    }
  }
}

async function sendBuyingSignalAlerts(
  job: JobRow,
  inboundMessage: string,
  matchedSignals: string[],
  settings: DevSettings
) {
  const customerName = job.customer_name || `Job #${job.id}`
  const addressLine = buildAddressLine(job)
  const stageLine = job.stage || "unknown"

  const smsBody =
    `Buying signal: ${customerName}\n` +
    `${addressLine}\n` +
    `Stage: ${stageLine}\n` +
    `Signals: ${matchedSignals.join(", ")}`

  const subject = `Buying signal detected: ${customerName}`
  const alertBody =
    `Customer: ${customerName}\n` +
    `Job ID: ${job.id}\n` +
    `Address: ${addressLine}\n` +
    `Stage: ${stageLine}\n` +
    `Source: ${job.lead_source || "—"}\n` +
    `Matched Signals: ${matchedSignals.join(", ")}\n\n` +
    `Customer Message:\n${inboundMessage}`

  let smsResult: any = null
  let emailResult: any = null

  try {
    smsResult = await sendSMS(settings.alert_sms_to, smsBody)
  } catch (err: any) {
    smsResult = { error: err?.message || String(err) }
  }

  try {
    emailResult = await sendAlertEmail(settings.alert_email_to, subject, alertBody)
  } catch (err: any) {
    emailResult = { error: err?.message || String(err) }
  }

  return {
    sms: smsResult,
    email: emailResult,
    sms_preview: smsBody,
  }
}

async function sendActionAlert(
  job: JobRow,
  classification: InboundClassification,
  inboundMessage: string,
  settings: DevSettings
) {
  const customerName = job.customer_name || `Job #${job.id}`
  const addressLine = buildAddressLine(job)

  const smsBody =
    `Action needed: ${classification}\n` +
    `${customerName}\n` +
    `${addressLine}\n` +
    `Message: ${inboundMessage}`

  const subject = `Action needed: ${classification} - ${customerName}`
  const emailBody =
    `Classification: ${classification}\n` +
    `Customer: ${customerName}\n` +
    `Job ID: ${job.id}\n` +
    `Address: ${addressLine}\n` +
    `Stage: ${job.stage || "unknown"}\n\n` +
    `Customer Message:\n${inboundMessage}`

  let smsResult: any = null
  let emailResult: any = null

  try {
    smsResult = await sendSMS(settings.alert_sms_to, smsBody)
  } catch (err: any) {
    smsResult = { error: err?.message || String(err) }
  }

  try {
    emailResult = await sendAlertEmail(settings.alert_email_to, subject, emailBody)
  } catch (err: any) {
    emailResult = { error: err?.message || String(err) }
  }

  return {
    sms: smsResult,
    email: emailResult,
    sms_preview: smsBody,
  }
}

async function sendNewLeadAlert(job: JobRow, settings: DevSettings) {
  const customerName = job.customer_name || `Job #${job.id}`
  const addressLine = buildAddressLine(job)

  const smsBody =
    `New Lead: ${customerName}\n` +
    `${addressLine}\n` +
    `Source: ${job.lead_source || "Unknown"}`

  const subject = `New Lead: ${customerName}`
  const emailBody =
    `Customer: ${customerName}\n` +
    `Job ID: ${job.id}\n` +
    `Address: ${addressLine}\n` +
    `Source: ${job.lead_source || "Unknown"}`

  let smsResult: any = null
  let emailResult: any = null

  try {
    smsResult = await sendSMS(settings.alert_sms_to, smsBody)
  } catch (err: any) {
    smsResult = { error: err?.message || String(err) }
  }

  try {
    emailResult = await sendAlertEmail(settings.alert_email_to, subject, emailBody)
  } catch (err: any) {
    emailResult = { error: err?.message || String(err) }
  }

  return {
    sms: smsResult,
    email: emailResult,
    sms_preview: smsBody,
  }
}

async function sendNewEstimateAlert(job: JobRow, settings: DevSettings) {
  const customerName = job.customer_name || `Job #${job.id}`
  const addressLine = buildAddressLine(job)

  const smsBody =
    `New Estimate: ${customerName}\n` +
    `${addressLine}\n` +
    `Stage: ${job.stage || "estimate_sent"}`

  const subject = `New Estimate: ${customerName}`
  const emailBody =
    `Customer: ${customerName}\n` +
    `Job ID: ${job.id}\n` +
    `Address: ${addressLine}\n` +
    `Stage: ${job.stage || "estimate_sent"}`

  let smsResult: any = null
  let emailResult: any = null

  try {
    smsResult = await sendSMS(settings.alert_sms_to, smsBody)
  } catch (err: any) {
    smsResult = { error: err?.message || String(err) }
  }

  try {
    emailResult = await sendAlertEmail(settings.alert_email_to, subject, emailBody)
  } catch (err: any) {
    emailResult = { error: err?.message || String(err) }
  }

  return {
    sms: smsResult,
    email: emailResult,
    sms_preview: smsBody,
  }
}

export async function queueAiFollowupByTenantSlug(tenantSlug: string, jobId: number) {
  const tenantId = await getTenantIdBySlug(tenantSlug)
  const settings = await getDeveloperSettingsByTenantSlug(tenantSlug)
  const job = await getJob(tenantId, jobId)

  if (job.bot_paused) {
    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_message_skipped",
      "AI follow-up skipped because bot is paused",
      { stage: job.stage, reason: "bot_paused" }
    )

    return {
      ok: true,
      skipped: true,
      reason: "bot_paused",
    }
  }

  const timelineBefore = await getTimeline(tenantId, jobId)

  if (job.stage === "lead" && !hasTimelineKind(timelineBefore, "new_lead_alert_routed")) {
    const alertResults = await sendNewLeadAlert(job, settings)

    await addTimelineEvent(
      tenantId,
      jobId,
      "new_lead_alert_routed",
      `New lead alert sent to ${settings.alert_sms_to} and ${settings.alert_email_to}`,
      {
        alert_sms_to: settings.alert_sms_to,
        alert_email_to: settings.alert_email_to,
        sms_result: alertResults.sms,
        email_result: alertResults.email,
        sms_preview: alertResults.sms_preview,
      }
    )
  }

  if (job.stage === "estimate_sent" && !hasTimelineKind(timelineBefore, "new_estimate_alert_routed")) {
    const alertResults = await sendNewEstimateAlert(job, settings)

    await addTimelineEvent(
      tenantId,
      jobId,
      "new_estimate_alert_routed",
      `New estimate alert sent to ${settings.alert_sms_to} and ${settings.alert_email_to}`,
      {
        alert_sms_to: settings.alert_sms_to,
        alert_email_to: settings.alert_email_to,
        sms_result: alertResults.sms,
        email_result: alertResults.email,
        sms_preview: alertResults.sms_preview,
      }
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

    return {
      ok: true,
      skipped: true,
      reason: "stage_not_supported",
    }
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

  const phone = await getCustomerPhone(tenantId, job.customer_id)

  if (!phone) {
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

  try {
    const sms = await sendSMS(phone, aiMessage.message)

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
        to: phone,
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
      to: phone,
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
        to: phone,
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
      to: phone,
      error: err?.message || String(err),
    }
  }
}

export async function handleInboundMessageByTenantSlug(
  tenantSlug: string,
  jobId: number,
  inboundMessage: string,
  from: string | null,
  channel: "sms" | "voice" = "sms"
) {
  const tenantId = await getTenantIdBySlug(tenantSlug)
  const settings = await getDeveloperSettingsByTenantSlug(tenantSlug)
  const job = await getJob(tenantId, jobId)
  const trimmed = inboundMessage.trim()

  await addTimelineEvent(
    tenantId,
    jobId,
    "customer_reply",
    trimmed,
    {
      from,
      channel,
      ...(channel === "voice" ? { input: "speech" } : {}),
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
      channel,
    }
  )

  const matchedSignals = detectBuyingSignals(trimmed)
  let autoReplyMessage: string | null = null

  if (classification !== "unknown") {
    await addTimelineEvent(
      tenantId,
      jobId,
      "next_action_routed",
      `Next action routed for ${classification}`,
      {
        channel,
        classification,
        crm_substatus: routing.crm_substatus,
        crm_flow_key: routing.crm_flow_key,
      }
    )

    const actionAlertResults = await sendActionAlert(job, classification, trimmed, settings)

    await addTimelineEvent(
      tenantId,
      jobId,
      "action_alert_routed",
      `Action alert sent for ${classification}`,
      {
        channel,
        classification,
        alert_sms_to: settings.alert_sms_to,
        alert_email_to: settings.alert_email_to,
        sms_result: actionAlertResults.sms,
        email_result: actionAlertResults.email,
        sms_preview: actionAlertResults.sms_preview,
      }
    )

    autoReplyMessage = buildClassificationReply(classification, job.customer_name, settings)

    if (channel === "sms") {
      await sendAutoClassificationReply(tenantId, jobId, job, classification, settings)
    }
  }

  if (matchedSignals.length) {
    await addTimelineEvent(
      tenantId,
      jobId,
      "buying_signal_detected",
      "Buying signal detected from customer reply",
      {
        matched_signals: matchedSignals,
        alert_sms_to: settings.alert_sms_to,
        alert_email_to: settings.alert_email_to,
      }
    )

    const alertResults = await sendBuyingSignalAlerts(job, trimmed, matchedSignals, settings)

    await addTimelineEvent(
      tenantId,
      jobId,
      "alert_routed",
      `Buying signal alert sent to ${settings.alert_sms_to} and ${settings.alert_email_to}`,
      {
        matched_signals: matchedSignals,
        alert_sms_to: settings.alert_sms_to,
        alert_email_to: settings.alert_email_to,
        sms_result: alertResults.sms,
        email_result: alertResults.email,
        sms_preview: alertResults.sms_preview,
      }
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
    alert_sms_to: matchedSignals.length || classification !== "unknown" ? settings.alert_sms_to : null,
    alert_email_to: matchedSignals.length || classification !== "unknown" ? settings.alert_email_to : null,
    auto_reply_message: autoReplyMessage,
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
        "voice_ai_response_spoken",
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
    [
      tenantId,
      customerId,
      `voice-${Date.now()}`,
      source,
    ]
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

  return {
    ok: true,
    tenant_id: tenantId,
    customer_id: customerId,
    job_id: jobId,
    source,
  }
}
