import { pool } from "../db/db"
import { sendSMS } from "./twilioService"

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
}

type TimelineRow = {
  id: number
  kind: string
  message: string
  meta: any
  created_at: string
}

const ALERT_SMS_TO = process.env.ALERT_SMS_TO || "+17272154507"
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO || "sales@g2groofing.com"

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
]

function normalizePhone(phone: string | null | undefined) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (phone.startsWith("+")) return phone
  return digits ? `+${digits}` : null
}

async function getTenantIdBySlug(slug: string): Promise<number> {
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

function countExistingAiMessages(timeline: TimelineRow[]) {
  return timeline.filter((t) =>
    ["ai_message_generated", "ai_message_sent", "ai_message_send_failed"].includes(
      t.kind.toLowerCase()
    )
  ).length
}

function buildEstimateSentSequence(customerName: string | null, count: number) {
  const name = customerName || "there"

  const messages = [
    `Thank you for using our estimating tool. This is Good2Go Roofing Team. Your estimate has been generated, and our team may follow up with additional information or next steps if needed.`,
    `Hi ${name}, this is Good2Go Roofing Team checking in to see if you had a chance to review your estimate. Let us know if you have any questions.`,
    `Good2Go Roofing Team here. We wanted to follow up on your estimate and see if you would like to review materials, timing, or next steps.`,
    `Just following up from Good2Go Roofing Team regarding your estimate. If you would like to move forward or review options, reply here and our team will help.`,
  ]

  return messages[Math.min(count, messages.length - 1)]
}

function buildContractSentSequence(customerName: string | null, count: number) {
  const name = customerName || "there"

  const messages = [
    `Hi ${name}, this is Good2Go Roofing Team following up on the contract we sent. Let us know if you have any questions before signing.`,
    `Good2Go Roofing Team here. Just checking in on the contract we sent over. If you are ready, we can help with the next step.`,
    `Following up from Good2Go Roofing Team on your contract. If timing, materials, or scheduling is holding things up, reply here and we will help.`,
    `This is Good2Go Roofing Team checking one more time on your contract. If you are ready to move forward, let us know and we will get things moving.`,
  ]

  return messages[Math.min(count, messages.length - 1)]
}

function buildAiMessage(job: JobRow, timeline: TimelineRow[]) {
  const count = countExistingAiMessages(timeline)

  if (job.stage === "estimate_sent") {
    return {
      stage: "estimate_sent",
      order: count + 1,
      message: buildEstimateSentSequence(job.customer_name, count),
    }
  }

  if (job.stage === "contract_sent") {
    return {
      stage: "contract_sent",
      order: count + 1,
      message: buildContractSentSequence(job.customer_name, count),
    }
  }

  return null
}

function detectBuyingSignals(message: string) {
  const normalized = message.toLowerCase()
  return BUYING_SIGNAL_PATTERNS.filter((pattern) => normalized.includes(pattern))
}

export async function queueAiFollowupByTenantSlug(tenantSlug: string, jobId: number) {
  const tenantId = await getTenantIdBySlug(tenantSlug)
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

  const timeline = await getTimeline(tenantId, jobId)
  const aiMessage = buildAiMessage(job, timeline)

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
  from: string | null
) {
  const tenantId = await getTenantIdBySlug(tenantSlug)
  const trimmed = inboundMessage.trim()

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

  const matchedSignals = detectBuyingSignals(trimmed)

  if (matchedSignals.length) {
    await addTimelineEvent(
      tenantId,
      jobId,
      "buying_signal_detected",
      "Buying signal detected from customer reply",
      {
        matched_signals: matchedSignals,
        alert_sms_to: ALERT_SMS_TO,
        alert_email_to: ALERT_EMAIL_TO,
      }
    )

    await addTimelineEvent(
      tenantId,
      jobId,
      "alert_routed_stub",
      `Buying signal alert would be sent to ${ALERT_SMS_TO} and ${ALERT_EMAIL_TO}`,
      {
        matched_signals: matchedSignals,
        alert_sms_to: ALERT_SMS_TO,
        alert_email_to: ALERT_EMAIL_TO,
      }
    )
  }

  return {
    ok: true,
    tenant_id: tenantId,
    job_id: jobId,
    matched_signals: matchedSignals,
    alert_sms_to: matchedSignals.length ? ALERT_SMS_TO : null,
    alert_email_to: matchedSignals.length ? ALERT_EMAIL_TO : null,
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
        "alert_routed_stub",
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
