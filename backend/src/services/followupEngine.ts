import { pool } from "../db/db"
import { countCompletedAiFollowups } from "./followupProgress"
import { sendSMS } from "./twilioService"

async function setConversationMemory(
  tenantId: number,
  phone: string | null,
  jobId: number
) {
  if (!phone) return

  const digits = String(phone).replace(/\D/g, "")
  if (!digits) return

  await pool.query(`
    create table if not exists conversation_memory (
      tenant_id bigint not null,
      phone_digits text not null,
      active_job_id bigint not null,
      last_activity_at timestamptz not null default now(),
      primary key (tenant_id, phone_digits)
    )
  `)

  await pool.query(
    `
    insert into conversation_memory (
      tenant_id,
      phone_digits,
      active_job_id,
      last_activity_at
    )
    values ($1,$2,$3,now())
    on conflict (tenant_id, phone_digits)
    do update set
      active_job_id = excluded.active_job_id,
      last_activity_at = now()
    `,
    [tenantId, digits, jobId]
  )
}

import { sendAlertEmail } from "./emailService"
import {
  getDeveloperSettingsByTenantSlug,
  getStageFollowupConfig,
  type DevSettings,
} from "./devSettingsService"
import {
  composeNavigatorCandidate,
  submitNavigatorObservation,
} from "./headquartersService"
import { isPhoneDnc } from "./dncService"

const PERMANENT_TWILIO_ERROR_CODES = new Set([
  21211,
  21265,
  21266,
  21268,
])

function getTwilioErrorCode(error: any): number | null {
  const code = Number(error?.code)

  return Number.isFinite(code)
    ? code
    : null
}

function isPermanentTwilioDeliveryFailure(error: any) {
  const code = getTwilioErrorCode(error)

  return code !== null &&
    PERMANENT_TWILIO_ERROR_CODES.has(code)
}

async function pauseAiFollowupForDeliveryFailure(
  tenantId: number,
  jobId: number,
  reason: string
) {
  await pool.query(
    `
    update jobs
       set bot_paused = true,
           bot_pause_reason = $3,
           updated_at = now()
     where tenant_id = $1
       and id = $2
    `,
    [tenantId, jobId, reason]
  )
}



async function reportAaCustomerActivity(payload: {
  tenant_slug: string;
  module_id: string;
  module_name: string;
  activity_type: string;
  title: string;
  description?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}) {
  const gatewayUrl =
    process.env.AA_ACTIVITY_GATEWAY_URL ||
    "https://actual-assistant-owner-controls.vercel.app/api/record-activity";

  const gatewaySecret = process.env.AA_ACTIVITY_GATEWAY_SECRET;

  if (!gatewaySecret) {
    console.warn("Skipping AA activity report: missing AA_ACTIVITY_GATEWAY_SECRET");
    return;
  }

  try {
    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-aa-activity-secret": gatewaySecret,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const details = await response.text();
      console.warn("AA activity report failed:", response.status, details);
    }
  } catch (err) {
    console.warn("AA activity report error:", err);
  }
}

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
  customer_email: string | null
  address1?: string | null
  city?: string | null
  state?: string | null
  crm_flow_key?: string | null
  crm_substatus?: string | null
  active_followup_workflow?: string | null
  followup_workflow_started_at?: string | null
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

const CUSTOMER_FRUSTRATION_PATTERNS = [
  "i am frustrated",
  "i'm frustrated",
  "im frustrated",
  "getting frustrated",
  "getting frustrating",
  "this is frustrating",
  "this is getting frustrating",
  "very frustrating",

  "i am annoyed",
  "i'm annoyed",
  "im annoyed",
  "this is annoying",
  "this is getting annoying",
  "you are annoying",

  "this is ridiculous",
  "this is ludicrous",
  "this is absurd",
  "this is unbelievable",
  "this is unacceptable",
  "this is pathetic",
  "this is useless",
  "this is terrible",
  "this is awful",
  "this is garbage",
  "this is a joke",
  "what a joke",

  "you are not listening",
  "you're not listening",
  "youre not listening",
  "not listening to me",
  "you don't listen",
  "you dont listen",

  "i already told you",
  "already told you",
  "i've already told you",
  "ive already told you",
  "you keep asking",
  "keep asking me",
  "same question",
  "keep repeating",
  "you keep repeating",
  "why do you keep asking",

  "are you a bot",
  "is this a bot",
  "talk to a real person",
  "speak to a real person",
  "real person please",
  "talk to a human",
  "speak to a human",
  "let me talk to someone",
  "get me a person",
  "get me a human",
  "get me a real person",
  "human please",

  "stop texting me",
  "stop messaging me",
  "stop contacting me",
  "quit texting me",
  "quit messaging me",
  "leave me alone",
  "stop bothering me",
  "do not text me",
  "don't text me",
  "dont text me",
  "do not message me",
  "don't message me",
  "dont message me",
  "do not contact me",
  "don't contact me",
  "dont contact me",
  "shut up",
  "go away",

  "i am pissed",
  "i'm pissed",
  "im pissed",
  "pissed off",
  "you pissed me off",
  "this pisses me off",

  "you are stupid",
  "you're stupid",
  "youre stupid",
  "this is stupid",
  "you are dumb",
  "you're dumb",
  "youre dumb",
  "this is dumb",
  "you are useless",
  "you're useless",
  "youre useless",
  "you are an idiot",
  "you're an idiot",
  "youre an idiot",
  "you are a moron",
  "you're a moron",
  "youre a moron",
]

const CUSTOMER_PROFANITY_PATTERNS = [
  /\bfuck\b/i,
  /\bfucks\b/i,
  /\bfucking\b/i,
  /\bfucked\b/i,
  /\bfucker\b/i,
  /\bfuckers\b/i,
  /\bshit\b/i,
  /\bshitty\b/i,
  /\bbullshit\b/i,
  /\bdamn\b/i,
  /\bdammit\b/i,
  /\bgoddamn\b/i,
  /\basshole\b/i,
  /\bassholes\b/i,
  /\bass hole\b/i,
  /\bbitch\b/i,
  /\bbitches\b/i,
  /\bbastard\b/i,
  /\bbastards\b/i,
  /\bcrap\b/i,
  /\bidiot\b/i,
  /\bidiots\b/i,
  /\bmoron\b/i,
  /\bmorons\b/i,
  /\bstupid\b/i,
  /\bdumb\b/i,
  /\bpathetic\b/i,
  /\buseless\b/i,
  /\bridiculous\b/i,
  /\bludicrous\b/i,
  /\babsurd\b/i,
  /\bpissed\b/i,
  /\bpiss off\b/i,
  /\bscrew you\b/i,
  /\bgo to hell\b/i,
  /\bwhat the hell\b/i,
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

function extractZip(value: string) {
  const match = String(value || "").match(/\b\d{5}(?:-\d{4})?\b/)
  return match ? match[0].slice(0, 5) : null
}

function cleanIntakeName(value: string) {
  return String(value || "")
    .replace(/^(um+|uh+|ah+|hey|hi|hello)[,\s]+/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeIntakeText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isInvalidIntakeName(value: string | null | undefined) {
  const normalized = normalizeIntakeText(value)

  return (
    !normalized ||
    [
      "inbound caller",
      "unknown",
      "unknown customer",
      "call me",
      "please call me",
      "call me please",
      "can someone call me",
      "can you call me",
      "can you call me please",
      "test",
      "na",
      "n a"
    ].includes(normalized)
  )
}

function isWeakServiceNeed(value: string | null | undefined) {
  const normalized = normalizeIntakeText(value)

  return (
    normalized.length < 8 ||
    [
      "call me",
      "please call me",
      "call me please",
      "can someone call me",
      "can you call me",
      "can you call me please",
      "someone call me",
      "callback",
      "call back"
    ].includes(normalized)
  )
}

function detectSalesIntent(message: string) {
  const text = message.toLowerCase()

  if (text.includes("just looking") || text.includes("not ready") || text.includes("shopping around") || text.includes("ballpark")) return "just_looking"

  if (text.includes("too expensive") || text.includes("price is high") || text.includes("cheaper") || text.includes("lower price") || text.includes("better price")) return "pricing_objection"

  if (text.includes("call me") || text.includes("call back") || text.includes("please call") || text.includes("can you call")) return "callback_request"

  if (text.includes("send contract") || text.includes("send paperwork") || text.includes("where do i sign") || text.includes("ready to sign") || text.includes("move forward")) return "contract_request"

  if (text.includes("tarp") || text.includes("leaking") || text.includes("active leak") || text.includes("storm damage") || text.includes("emergency")) return "tarp_request"

  if (text.includes("estimate") || text.includes("quote") || text.includes("price") || text.includes("number")) return "estimate_request"

  return null
}

function buildSalesIntentReply(intent: string, job: JobRow) {
  const name = String(job.customer_name || "there").trim().split(/\s+/)[0] || "there"

  if (intent === "just_looking") {
    return `Totally understand, ${name} — most people start there and nobody wants to be pressured. Just so I point you in the right direction, are you looking because you already know there is an issue, or are you just being proactive? Either way is fine.`
  }

  if (intent === "pricing_objection") {
    return `${name}, I understand. Compared to what? Roof pricing can vary a lot depending on materials, scope, and even ZIP code. What specifically feels high to you — the total cost, the monthly impact, or something else?`
  }

  if (intent === "callback_request") {
    return `Absolutely, ${name}. I can have someone call you. Quick heads up — what is the main thing you want to go over so they are prepared and not wasting your time?`
  }

  if (intent === "contract_request") {
    return `Great, ${name} — that is exactly what we want to hear. Before we move to paperwork, is there anything you want clarified on pricing, materials, or timing? Once we lock that in, we can get everything moving for you.`
  }

  if (intent === "tarp_request") {
    return `${name}, we received this as an urgent tarp-related request. If this is storm or active leak damage, we will need a signed work authorization before dispatch. We can send that by text or email. What is the best way to send it?`
  }

  if (intent === "estimate_request") {
    return `${name}, we can get you a solid estimate range. The fastest way is through our estimator because roof pricing depends on size, pitch, materials, and location. If you are not ready to move forward yet, it is better to start there than guessing a number that may change later.`
  }

  return null
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
      j.active_followup_workflow,
      j.followup_workflow_started_at,
      c.full_name as customer_name,
      c.email as customer_email
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

async function logSystemEvent(
  eventType: string,
  entityType: string,
  entityId: string | number | null,
  metadata: Record<string, unknown> = {}
) {
  try {
    await pool.query(
      `
      insert into system_events (event_type, entity_type, entity_id, metadata)
      values ($1, $2, $3, $4::jsonb)
      `,
      [
        eventType,
        entityType,
        entityId ? String(entityId) : null,
        JSON.stringify(metadata),
      ]
    )
  } catch (err) {
    console.error("system event log failed", err)
  }
}

type NavigatorHeadquartersExecutionMode =
  | "baseline"
  | "headquarters"

const NAVIGATOR_INBOUND_SMS_SWITCH_POINT =
  "inbound_customer_sms_response"

const NAVIGATOR_OUTBOUND_SMS_SWITCH_POINT_PREFIX =
  "outbound_followup_sms"

function buildNavigatorOutboundSmsSwitchPoint(
  workflowKey: string
) {
  return `${NAVIGATOR_OUTBOUND_SMS_SWITCH_POINT_PREFIX}:${workflowKey}`
}

async function getTenantDisplayName(
  tenantId: number,
  tenantSlug: string
): Promise<string> {
  try {
    const result =
      await pool.query(
        `
        select
          coalesce(
            nullif(
              d.branding
                ->> 'business_display_name',
              ''
            ),
            nullif(t.name, ''),
            t.slug
          ) as display_name
        from tenants t
        left join tenant_company_dna d
          on d.tenant_id = t.id
        where t.id = $1
        limit 1
        `,
        [tenantId]
      )

    const displayName =
      String(
        result.rows?.[0]
          ?.display_name || ""
      ).trim()

    if (displayName) {
      return displayName
    }
  } catch (error: any) {
    /*
     * Older tenants may predate the Company DNA
     * persistence table. Fall through to the
     * authoritative tenants table rather than
     * introducing a tenant-specific fallback.
     */
    if (error?.code !== "42P01") {
      console.warn(
        "Navigator tenant branding lookup failed; using tenant identity fallback.",
        error
      )
    }
  }

  const fallback =
    await pool.query(
      `
      select
        coalesce(
          nullif(name, ''),
          slug
        ) as display_name
      from tenants
      where id = $1
      limit 1
      `,
      [tenantId]
    )

  return (
    String(
      fallback.rows?.[0]
        ?.display_name ||
      tenantSlug
    ).trim() ||
    tenantSlug
  )
}

async function getNavigatorHeadquartersExecutionMode(
  tenantId: number,
  switchPoint: string
): Promise<NavigatorHeadquartersExecutionMode> {
  const result =
    await pool.query(
      `
      select
        count(*)::int as count
      from timeline_events
      where tenant_id = $1
        and kind =
          'headquarters_execution_selection'
        and meta
          ->> 'switch_point' = $2
      `,
      [
        tenantId,
        switchPoint,
      ]
    )

  const priorSelections =
    Number(
      result.rows?.[0]?.count || 0
    )

  return priorSelections % 2 === 0
    ? "baseline"
    : "headquarters"
}

async function recordNavigatorHeadquartersExecutionSelection(
  tenantId: number,
  jobId: number,
  input: {
    switch_point: string
    intended_selection_mode:
      NavigatorHeadquartersExecutionMode
    execution_mode:
      NavigatorHeadquartersExecutionMode
    headquarters_composition_status:
      | "not_requested"
      | "applied"
      | "unavailable"
    headquarters_learning_record_ids:
      string[]
  }
) {
  await addTimelineEvent(
    tenantId,
    jobId,
    "headquarters_execution_selection",
    `Navigator ${input.switch_point} executed via ${input.execution_mode}.`,
    {
      switch_point:
        input.switch_point,
      intended_selection_mode:
        input.intended_selection_mode,
      execution_mode:
        input.execution_mode,
      headquarters_composition_status:
        input.headquarters_composition_status,
      headquarters_learning_record_ids:
        input.headquarters_learning_record_ids,
    }
  )
}

function countExistingAiMessagesForStage(timeline: TimelineRow[], stage: string) {
  return countCompletedAiFollowups(timeline, stage)
}

function hasTimelineKind(timeline: TimelineRow[], kind: string) {
  const target = kind.toLowerCase()
  return timeline.some((t) => String(t.kind || "").toLowerCase() === target)
}

async function getActiveEmsTarpAuthorization(
  tenantId: number,
  jobId: number
) {
  const result = await pool.query(
    `
    select
      id,
      document_title,
      status,
      sent_at
    from job_document_packages
    where tenant_id = $1
      and job_id = $2
      and package_type = 'ems_tarp'
      and status = 'sent'
      and signed_at is null
    order by sent_at desc nulls last, created_at desc, id desc
    limit 1
    `,
    [tenantId, jobId]
  )

  if (!result.rowCount) return null

  const row = result.rows[0]
  const signBaseUrl =
    process.env.PUBLIC_SIGN_BASE_URL ||
    process.env.FRONTEND_BASE_URL ||
    "https://contractor-navigator.vercel.app"

  return {
    package_id: Number(row.id),
    document_title: String(row.document_title || "Emergency Tarp Work Authorization"),
    sign_url: `${signBaseUrl.replace(/\/$/, "")}/sign/${Number(row.id)}`,
  }
}

async function maybeRecordAndRouteWaUtc(
  tenantId: number,
  jobId: number,
  job: JobRow,
  callbackNumber: string | null,
  alertTargets: AlertTargets,
  packageId: number,
  attemptOrder: number
) {
  if (attemptOrder < 3) return

  const existing = await pool.query(
    `
    select id
    from timeline_events
    where tenant_id = $1
      and job_id = $2
      and kind = 'wa_utc_notified'
      and coalesce(meta->>'package_id', '') = $3
    limit 1
    `,
    [tenantId, jobId, String(packageId)]
  )

  if (existing.rowCount) return

  const address = buildAddressLine(job)

  const note =
    `UTC — Unable To Contact after 3 attempts to obtain Emergency Tarp Work Authorization. ` +
    `Staff notified to advise adjuster. Automated contact attempts will continue.`

  const alert =
    `UTC — EMERGENCY TARP AUTHORIZATION\n` +
    `Customer: ${job.customer_name || "Unknown Customer"}\n` +
    `Job ID: ${jobId}\n` +
    `Address: ${address}\n` +
    `Phone: ${callbackNumber || "Unknown"}\n` +
    `Carrier: ${job.carrier || "Unknown"}\n` +
    `Claim: ${job.claim_number || "Unknown"}\n\n` +
    `Three successful outreach attempts have been made without receiving the signed Emergency Tarp Work Authorization.\n` +
    `Action: Notify the adjuster that the insured is currently UTC — Unable To Contact.\n` +
    `Navigator will continue automated attempts to obtain authorization.`

  let smsResult: any = null
  let emailResult: any = null

  if (alertTargets.alert_sms_to) {
    try {
      smsResult = await sendSMS(
        alertTargets.alert_sms_to,
        alert
      )
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
        `UTC — Emergency Tarp Authorization — ${job.customer_name || `Job #${jobId}`}`,
        alert
      )
    } catch (err: any) {
      emailResult = { error: err?.message || String(err) }
    }
  } else {
    emailResult = { skipped: true, reason: "missing_alert_email_to" }
  }

  await addTimelineEvent(
    tenantId,
    jobId,
    "wa_utc_notified",
    note,
    {
      package_id: packageId,
      workflow: "wa_sent",
      attempt_count: attemptOrder,
      utc: true,
      adjuster_notification_required: true,
      automated_followup_continues: true,
      carrier: job.carrier || null,
      claim_number: job.claim_number || null,
      customer_phone: callbackNumber || null,
      alert_sms_to: alertTargets.alert_sms_to,
      alert_email_to: alertTargets.alert_email_to,
      sms_result: smsResult,
      email_result: emailResult,
    }
  )
}

function getWorkflowMessages(settings: DevSettings, job: JobRow) {
  if (job.crm_flow_key === "weather_evidence_report") {
    return {
      workflowKey: "weather_evidence_report",
      messages: settings.weather_report_messages || [],
    }
  }

  const stageKey =
    String(
      job.active_followup_workflow ||
      job.stage ||
      "",
    ).trim()

  const configuration =
    getStageFollowupConfig(
      settings,
      stageKey,
    )

  return {
    workflowKey: stageKey || "unknown",
    messages:
      configuration?.messages || [],
  }
}

function buildAiMessage(job: JobRow, timeline: TimelineRow[], settings: DevSettings) {
  if (
    !job.active_followup_workflow &&
    job.crm_flow_key !== "weather_evidence_report"
  ) {
    return null
  }

  const workflow = getWorkflowMessages(settings, job)
  const stageMessages = workflow.messages.filter((m) => String(m || "").trim().length > 0)
  if (!stageMessages.length) return null

  const count = countExistingAiMessagesForStage(timeline, workflow.workflowKey)
  const rawMessage = stageMessages[Math.min(count, stageMessages.length - 1)]

  return {
    stage: workflow.workflowKey,
    order: count + 1,
    message: fillTemplate(rawMessage, job.customer_name),
  }
}

function detectBuyingSignals(message: string) {
  const normalized = message.toLowerCase()
  return BUYING_SIGNAL_PATTERNS.filter((pattern) => normalized.includes(pattern))
}

export function detectCustomerFrustration(
  message: string
) {
  const normalized =
    String(message || "")
      .toLowerCase()
      .replace(/[’]/g, "'")
      .replace(/\s+/g, " ")
      .trim()

  const phraseMatches =
    CUSTOMER_FRUSTRATION_PATTERNS.filter(
      (pattern) =>
        normalized.includes(pattern)
    )

  const profanityMatches =
    CUSTOMER_PROFANITY_PATTERNS
      .filter((pattern) =>
        pattern.test(normalized)
      )
      .map((pattern) =>
        pattern.source
      )

  return [
    ...new Set([
      ...phraseMatches,
      ...profanityMatches,
    ]),
  ]
}

function containsAny(text: string, patterns: string[]) {
  return patterns.some((p) => text.includes(p))
}

function detectDefinitiveDisengagement(
  value: string | null | undefined
) {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()

  if (!text) return null

  const patterns: Array<[RegExp, string]> = [
    [/\bi already hired (someone|somebody|another (roofer|contractor|company))\b/i, "already_hired_someone"],
    [/\bi've already hired (someone|somebody|another (roofer|contractor|company))\b/i, "already_hired_someone"],
    [/\bwe already hired (someone|somebody|another (roofer|contractor|company))\b/i, "already_hired_someone"],
    [/\bwent with (someone|somebody|another (roofer|contractor|company))\b/i, "went_with_someone_else"],
    [/\busing another (roofer|contractor|company)\b/i, "using_another_company"],
    [/\bhired another (roofer|contractor|company)\b/i, "hired_another_company"],
    [/\bnot interested\b/i, "not_interested"],
    [/\bno longer interested\b/i, "no_longer_interested"],
    [/\bdon't need (it|this|service|the service|roofing|a roofer|a contractor|help) anymore\b/i, "service_no_longer_needed"],
    [/\bdo not need (it|this|service|the service|roofing|a roofer|a contractor|help) anymore\b/i, "service_no_longer_needed"],
    [/\bwe('re| are) all set\b/i, "customer_all_set"],
    [/\bi('m| am) all set\b/i, "customer_all_set"],
  ]

  for (const [pattern, reason] of patterns) {
    if (pattern.test(text)) return reason
  }

  return null
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
  const map =
    settings.inbound_auto_replies ||
    ({} as Partial<DevSettings["inbound_auto_replies"]>)

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
  tenantSlug: string,
  tenantId: number,
  jobId: number,
  job: JobRow,
  classification: InboundClassification,
  settings: DevSettings,
  fallbackPhone: string | null,
  inboundMessage: string
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

  const tenantDisplayName =
    await getTenantDisplayName(
      tenantId,
      tenantSlug
    )

  const baselineReplyMessage =
    buildClassificationReply(
      classification,
      job.customer_name,
      settings
    )

  const intendedSelectionMode =
    await getNavigatorHeadquartersExecutionMode(
      tenantId,
      NAVIGATOR_INBOUND_SMS_SWITCH_POINT
    )

  let executionMode:
    NavigatorHeadquartersExecutionMode =
    intendedSelectionMode

  let replyMessage =
    baselineReplyMessage

  let headquartersCompositionStatus:
    | "not_requested"
    | "applied"
    | "unavailable" =
    "not_requested"

  let headquartersLearningRecordIds:
    string[] = []

  /*
   * Reuse the proven Universal Outreach pattern:
   *
   * baseline
   * → Headquarters
   * → baseline
   * → Headquarters
   *
   * If Headquarters is due but unavailable,
   * this execution alone falls back to baseline
   * and the Headquarters turn does NOT advance.
   */
  if (
    intendedSelectionMode ===
      "headquarters"
  ) {
    try {
      const candidate =
        await composeNavigatorCandidate({
          tenantSlug,
          task:
            NAVIGATOR_INBOUND_SMS_SWITCH_POINT,
          channel:
            "sms",
          currentContext: {
            inbound_message:
              inboundMessage,
            classification,
            customer_name:
              job.customer_name || null,
            tenant_display_name:
              tenantDisplayName,
            job_id:
              jobId,
            job_stage:
              job.stage || null,
            crm_substatus:
              job.crm_substatus || null,
            crm_flow_key:
              job.crm_flow_key || null,
            baseline_reply:
              baselineReplyMessage,
          },
        })

      replyMessage =
        candidate.text.trim()

      headquartersCompositionStatus =
        "applied"

      if (
        Array.isArray(
          candidate.learning_record_ids
        )
      ) {
        headquartersLearningRecordIds =
          candidate.learning_record_ids
      }
    } catch (error) {
      executionMode =
        "baseline"

      headquartersCompositionStatus =
        "unavailable"

      console.warn(
        "Navigator Headquarters inbound SMS composition unavailable; existing Developer Settings response retained for this execution only.",
        error
      )
    }
  }

  await addTimelineEvent(
    tenantId,
    jobId,
    "ai_inbound_response_generated",
    replyMessage,
    {
      stage: job.stage,
      classification,
      sender:
        tenantDisplayName,
      headquarters_switch_point:
        NAVIGATOR_INBOUND_SMS_SWITCH_POINT,
      intended_selection_mode:
        intendedSelectionMode,
      execution_mode:
        executionMode,
      headquarters_composition:
        headquartersCompositionStatus,
      headquarters_learning_record_ids:
        headquartersLearningRecordIds,
    }
  )

  try {
    const sms = await sendSMS(phone, replyMessage)

    /*
     * Advance alternation only when the intended
     * execution was actually fulfilled.
     *
     * Headquarters failure falls back to baseline
     * but leaves Headquarters due next time.
     */
    if (
      intendedSelectionMode ===
        "baseline" ||
      headquartersCompositionStatus ===
        "applied"
    ) {
      await recordNavigatorHeadquartersExecutionSelection(
        tenantId,
        jobId,
        {
          switch_point:
            NAVIGATOR_INBOUND_SMS_SWITCH_POINT,
          intended_selection_mode:
            intendedSelectionMode,
          execution_mode:
            executionMode,
          headquarters_composition_status:
            headquartersCompositionStatus,
          headquarters_learning_record_ids:
            headquartersLearningRecordIds,
        }
      )
    }

    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_inbound_response_sent",
      replyMessage,
      {
        stage: job.stage,
        classification,
        sender:
          tenantDisplayName,
        channel: "sms",
        to: phone,
        twilio_sid: sms.sid,
        twilio_status: sms.status,
      }
    )

    await reportAaCustomerActivity({
      tenant_slug: tenantSlug,
      module_id: "ai_followup",
      module_name: "AI Follow-Up & After-Hours Assistant",
      activity_type: "ai_sms_sent",
      title: "AI follow-up text sent",
      description: replyMessage,
      source: "ai_followup_sms",
      metadata: {
        customer_name: job.customer_name || null,
        phone,
        job_id: jobId,
        stage: job.stage || null,
        classification,
        twilio_sid: sms.sid,
      },
    })

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

  const ownerSms =
    `🚨 HIGH INTENT LEAD\n\n` +
    `Customer: ${job.customer_name || "Unknown"}\n` +
    `Job ID: ${job.id}\n` +
    `Phone: ${callbackNumber || "Unknown"}\n` +
    `Email: ${job.customer_email || "Unknown"}\n` +
    `Address: ${buildAddressLine(job)}\n\n` +
    `Customer said:\n"${inboundMessage}"\n\n` +
    `Reason: ${matchedSignals.join(", ") || "high intent reply"}\n` +
    `Action: Call immediately and close.`

  if (alertTargets.alert_sms_to) {
    try {
      smsResult = await sendSMS(alertTargets.alert_sms_to, ownerSms)
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

async function sendFrustratedCustomerAlert(
  job: JobRow,
  inboundMessage: string,
  matchedPatterns: string[],
  settings: DevSettings,
  callbackNumber: string | null
) {
  const alertTargets =
    resolveAlertTargets(settings)

  const summary =
    buildDispatcherSummary(
      "FRUSTRATED CUSTOMER — HUMAN TAKEOVER",
      job,
      {
        callbackNumber,
        message:
          inboundMessage,
        nextAction:
          "Automation has been paused. Contact customer personally as soon as possible.",
        channel:
          "sms",
        classification:
          "frustrated_customer",
      }
    )

  const ownerSms =
    `⚠️ FRUSTRATED CUSTOMER\n\n` +
    `Customer: ${job.customer_name || "Unknown"}\n` +
    `Job ID: ${job.id}\n` +
    `Phone: ${callbackNumber || "Unknown"}\n` +
    `Address: ${buildAddressLine(job)}\n\n` +
    `Customer said:\n"${inboundMessage}"\n\n` +
    `Automation has been paused. Please contact the customer personally.`

  let smsResult: any = null
  let emailResult: any = null

  if (alertTargets.alert_sms_to) {
    try {
      smsResult =
        await sendSMS(
          alertTargets.alert_sms_to,
          ownerSms
        )
    } catch (err: any) {
      smsResult = {
        error:
          err?.message ||
          String(err),
      }
    }
  } else {
    smsResult = {
      skipped: true,
      reason:
        "missing_alert_sms_to",
    }
  }

  if (alertTargets.alert_email_to) {
    try {
      emailResult =
        await sendAlertEmail(
          alertTargets.alert_email_to,
          `Frustrated customer: ${
            job.customer_name ||
            `Job #${job.id}`
          }`,
          summary.email
        )
    } catch (err: any) {
      emailResult = {
        error:
          err?.message ||
          String(err),
      }
    }
  } else {
    emailResult = {
      skipped: true,
      reason:
        "missing_alert_email_to",
    }
  }

  return {
    sms:
      smsResult,
    email:
      emailResult,
    matched_patterns:
      matchedPatterns,
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

  summary.email =
    summary.email +
    `\n\nSOURCE DETAILS\n` +
    `Source: ${job.lead_source || "-"}\n` +
    `How They Heard About Us: ${job.lead_source_detail || "-"}\n`

  try {
    const estimateResult = await pool.query(
      `
      select
        roof_type,
        roof_squares,
        low_amount,
        high_amount,
        estimator_remarks,
        created_at
      from job_estimate_details
      where tenant_id = $1
        and job_id = $2
      limit 1
      `,
      [job.tenant_id, job.id]
    )

    if (estimateResult.rowCount) {
      const e = estimateResult.rows[0]

      summary.email =
        summary.email +
        `\n\nESTIMATOR DETAILS\n` +
        `Roof Type: ${e.roof_type || "-"}\n` +
        `Roof Squares: ${e.roof_squares || "-"}\n` +
        `Estimate Low: ${e.low_amount || "-"}\n` +
        `Estimate High: ${e.high_amount || "-"}\n` +
        `Estimate Summary: ${e.estimator_remarks || "-"}\n` +
        `Captured At: ${e.created_at || "-"}\n`
    }
  } catch (err: any) {
    console.error("Failed to attach estimator details to estimate alert", err)
  }

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

  if (
    job.stage === "lead" &&
    !hasTimelineKind(timelineBefore, "new_lead_alert_routed") &&
    !hasTimelineKind(timelineBefore, "voice_intake_alert_routed")
  ) {
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

  const tenantDisplayName =
    await getTenantDisplayName(
      tenantId,
      tenantSlug
    )

  await addTimelineEvent(
    tenantId,
    jobId,
    "ai_message_generated",
    aiMessage.message,
    {
      stage:
        aiMessage.stage,
      order:
        aiMessage.order,
      sender:
        tenantDisplayName,
    }
  )

  if (!callbackNumber) {
    const reason =
      "AI follow-up paused because customer phone is missing"

    await pauseAiFollowupForDeliveryFailure(
      tenantId,
      jobId,
      reason
    )

    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_message_delivery_halted",
      reason,
      {
        stage: aiMessage.stage,
        order: aiMessage.order,
        channel: "sms",
        permanent: true,
        reason: "missing_phone",
      }
    )

    return {
      ok: true,
      skipped: true,
      tenant_id: tenantId,
      job_id: jobId,
      stage: aiMessage.stage,
      order: aiMessage.order,
      message: aiMessage.message,
      sent: false,
      reason: "missing_phone",
      permanent: true,
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

  const outboundSwitchPoint =
    buildNavigatorOutboundSmsSwitchPoint(
      aiMessage.stage
    )

  const intendedSelectionMode =
    await getNavigatorHeadquartersExecutionMode(
      tenantId,
      outboundSwitchPoint
    )

  let executionMode:
    NavigatorHeadquartersExecutionMode =
    intendedSelectionMode

  let outboundMessage =
    aiMessage.message

  let headquartersCompositionStatus:
    | "not_requested"
    | "applied"
    | "unavailable" =
    "not_requested"

  let headquartersLearningRecordIds:
    string[] = []

  if (
    intendedSelectionMode ===
      "headquarters"
  ) {
    try {
      const candidate =
        await composeNavigatorCandidate({
          tenantSlug,
          task:
            "outbound_followup_sms",
          channel:
            "sms",
          currentContext: {
            tenant_display_name:
              tenantDisplayName,
            customer_name:
              job.customer_name || null,
            job_id:
              jobId,
            job_stage:
              job.stage || null,
            crm_substatus:
              job.crm_substatus || null,
            crm_flow_key:
              job.crm_flow_key || null,
            followup_workflow:
              aiMessage.stage,
            followup_order:
              aiMessage.order,
            baseline_message:
              aiMessage.message,
          },
        })

      outboundMessage =
        candidate.text.trim()

      headquartersCompositionStatus =
        "applied"

      if (
        Array.isArray(
          candidate.learning_record_ids
        )
      ) {
        headquartersLearningRecordIds =
          candidate.learning_record_ids
      }
    } catch (error) {
      executionMode =
        "baseline"

      headquartersCompositionStatus =
        "unavailable"

      console.warn(
        "Navigator Headquarters outbound SMS composition unavailable; existing Developer Settings follow-up retained for this execution only.",
        error
      )
    }
  }

  let activeEmsAuthorization:
    | {
        package_id: number
        document_title: string
        sign_url: string
      }
    | null = null

  if (aiMessage.stage === "wa_sent") {
    activeEmsAuthorization =
      await getActiveEmsTarpAuthorization(
        tenantId,
        jobId
      )

    if (!activeEmsAuthorization) {
      await addTimelineEvent(
        tenantId,
        jobId,
        "ai_message_send_failed",
        "WA follow-up could not be sent because no active unsigned Emergency Tarp Work Authorization was found.",
        {
          stage: "wa_sent",
          order: aiMessage.order,
          reason: "missing_active_ems_authorization",
        }
      )

      return {
        ok: true,
        skipped: true,
        reason: "missing_active_ems_authorization",
        tenant_id: tenantId,
        job_id: jobId,
        stage: aiMessage.stage,
        order: aiMessage.order,
      }
    }

    outboundMessage =
      `${outboundMessage.trim()}\n\n` +
      `Emergency Tarp Work Authorization: ${activeEmsAuthorization.sign_url}`
  }

  try {
    const sms =
      await sendSMS(
        callbackNumber,
        outboundMessage
      )

    if (
      intendedSelectionMode ===
        "baseline" ||
      headquartersCompositionStatus ===
        "applied"
    ) {
      await recordNavigatorHeadquartersExecutionSelection(
        tenantId,
        jobId,
        {
          switch_point:
            outboundSwitchPoint,
          intended_selection_mode:
            intendedSelectionMode,
          execution_mode:
            executionMode,
          headquarters_composition_status:
            headquartersCompositionStatus,
          headquarters_learning_record_ids:
            headquartersLearningRecordIds,
        }
      )
    }

    await setConversationMemory(
      tenantId,
      callbackNumber,
      jobId
    )

    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_message_sent",
      outboundMessage,
      {
        stage:
          aiMessage.stage,
        order:
          aiMessage.order,
        sender:
          tenantDisplayName,
        channel:
          "sms",
        to:
          callbackNumber,
        twilio_sid:
          sms.sid,
        twilio_status:
          sms.status,
        headquarters_switch_point:
          outboundSwitchPoint,
        intended_selection_mode:
          intendedSelectionMode,
        execution_mode:
          executionMode,
        headquarters_composition:
          headquartersCompositionStatus,
        headquarters_learning_record_ids:
          headquartersLearningRecordIds,
      }
    )

    if (
      aiMessage.stage === "wa_sent" &&
      activeEmsAuthorization
    ) {
      await maybeRecordAndRouteWaUtc(
        tenantId,
        jobId,
        job,
        callbackNumber,
        alertTargets,
        activeEmsAuthorization.package_id,
        aiMessage.order
      )
    }

    /*
     * Return the completed outbound execution to Headquarters
     * after Twilio has accepted the message.
     *
     * This remains fail-safe and cannot interrupt the existing
     * Navigator follow-up workflow.
     */
    try {
      const observedAt = new Date().toISOString()

      await submitNavigatorObservation({
        id:
          `navigator-sms-outbound-${tenantId}-${jobId}-${sms.sid}`,
        tenant_id:
          String(tenantId),
        tenant_slug:
          tenantSlug,
        assistant_type:
          "ai_followup",
        type:
          "service_result",
        summary:
          `Navigator completed outbound AI follow-up SMS for workflow '${aiMessage.stage}' step ${aiMessage.order}.`,
        observed_at:
          observedAt,
        approved_at:
          observedAt,
        evidence: {
          job_id:
            jobId,
          channel:
            "sms",
          direction:
            "outbound",
          workflow:
            aiMessage.stage,
          followup_order:
            aiMessage.order,
          customer_name:
            job.customer_name || null,
          job_stage:
            job.stage || null,
          to:
            callbackNumber,
          message:
            outboundMessage,
          twilio_sid:
            sms.sid,
          twilio_status:
            sms.status,
          intended_selection_mode:
            intendedSelectionMode,
          execution_mode:
            executionMode,
          headquarters_composition_status:
            headquartersCompositionStatus,
          headquarters_learning_record_ids:
            headquartersLearningRecordIds,
        },
      })
    } catch (error) {
      console.warn(
        "Navigator outbound SMS Headquarters observation unavailable; existing SMS workflow continues unchanged.",
        error
      )
    }

    return {
      ok: true,
      skipped: false,
      tenant_id: tenantId,
      job_id: jobId,
      stage: aiMessage.stage,
      order: aiMessage.order,
      message: outboundMessage,
      sent: true,
      to: callbackNumber,
      twilio_sid: sms.sid,
    }
  } catch (err: any) {
    const errorMessage = err?.message || String(err)
    const twilioErrorCode = getTwilioErrorCode(err)
    const permanent =
      isPermanentTwilioDeliveryFailure(err)

    if (permanent) {
      const reason =
        `AI follow-up paused after permanent Twilio error ` +
        `${twilioErrorCode}: ${errorMessage}`

      await pauseAiFollowupForDeliveryFailure(
        tenantId,
        jobId,
        reason
      )

      await addTimelineEvent(
        tenantId,
        jobId,
        "ai_message_delivery_halted",
        reason,
        {
          stage: aiMessage.stage,
          order: aiMessage.order,
          to: callbackNumber,
          channel: "sms",
          permanent: true,
          twilio_error_code: twilioErrorCode,
        }
      )

      return {
        ok: true,
        skipped: true,
        reason: "permanent_delivery_failure",
        tenant_id: tenantId,
        job_id: jobId,
        stage: aiMessage.stage,
        order: aiMessage.order,
        message: aiMessage.message,
        sent: false,
        to: callbackNumber,
        permanent: true,
        twilio_error_code: twilioErrorCode,
        error: errorMessage,
      }
    }

    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_message_send_failed",
      `AI message failed to send: ${errorMessage}`,
      {
        stage: aiMessage.stage,
        order: aiMessage.order,
        to: callbackNumber,
        permanent: false,
        twilio_error_code: twilioErrorCode,
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
      permanent: false,
      twilio_error_code: twilioErrorCode,
      error: errorMessage,
    }
  }
}


async function getLatestIntakeQuestion(tenantId: number, jobId: number) {
  const result = await pool.query(
    `
    select kind, message, meta, created_at
    from timeline_events
    where tenant_id = $1
      and job_id = $2
      and kind = 'intake_question_sent'
    order by created_at desc, id desc
    limit 1
    `,
    [tenantId, jobId]
  )

  if (!result.rowCount) return null
  return result.rows[0]
}

async function updateCustomerNameForIntake(
  tenantId: number,
  customerId: number | null,
  fullName: string
) {
  if (!customerId || !fullName.trim()) return

  await pool.query(
    `
    update customers
       set full_name = $1,
           updated_at = now()
     where tenant_id = $2
       and id = $3
    `,
    [fullName.trim(), tenantId, customerId]
  )
}

async function updateJobAddressForIntake(
  tenantId: number,
  jobId: number,
  address: string
) {
  if (!address.trim()) return

  await pool.query(
    `
    update jobs
       set address1 = $1,
           updated_at = now()
     where tenant_id = $2
       and id = $3
    `,
    [address.trim(), tenantId, jobId]
  )
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

  await logSystemEvent("customer_reply_logged", "job", jobId, {
    tenant_slug: tenantSlug,
    from,
    channel: "sms",
    message: trimmed,
    customer_name: job.customer_name || null,
    stage: job.stage || null,
  })


  await reportAaCustomerActivity({
    tenant_slug: tenantSlug,
    module_id: "ai_followup",
    module_name: "AI Follow-Up & After-Hours Assistant",
    activity_type: "customer_sms_reply",
    title: "Homeowner replied to AI conversation",
    description: trimmed,
    source: "twilio_inbound_sms",
    metadata: {
      customer_name: job.customer_name || null,
      phone: callbackNumber || from || null,
      job_id: jobId,
      stage: job.stage || null,
      message: trimmed,
      needs_attention: true,
    },
  })

  /*
   * Customer-frustration safety valve.
   *
   * This runs before normal intake, sales-intent,
   * classification and AI-response handling.
   *
   * One final apology is allowed; all continuing
   * automation is paused and pending scheduled
   * actions are cancelled for human takeover.
   */
  const frustrationSignals =
    detectCustomerFrustration(
      trimmed
    )

  if (frustrationSignals.length) {
    const tenantDisplayName =
      await getTenantDisplayName(
        tenantId,
        tenantSlug
      )

    await pool.query(
      `
      update jobs
      set
        bot_paused = true,
        bot_pause_reason =
          'frustrated_customer',
        crm_substatus =
          'frustrated_customer',
        crm_flow_key =
          'human_takeover_frustration',
        updated_at = now()
      where tenant_id = $1
        and id = $2
      `,
      [
        tenantId,
        jobId,
      ]
    )

    await pool.query(
      `
      update scheduled_actions
      set
        status = 'cancelled',
        updated_at = now()
      where tenant_id = $1
        and job_id = $2
        and status = 'pending'
      `,
      [
        tenantId,
        jobId,
      ]
    )

    await addTimelineEvent(
      tenantId,
      jobId,
      "customer_frustration_detected",
      "Customer frustration detected; automation paused for human takeover.",
      {
        from,
        channel:
          "sms",
        message:
          trimmed,
        matched_patterns:
          frustrationSignals,
      }
    )

    await addTimelineEvent(
      tenantId,
      jobId,
      "bot_paused",
      "Bot automatically paused because customer frustration was detected.",
      {
        reason:
          "frustrated_customer",
        from,
        channel:
          "sms",
        matched_patterns:
          frustrationSignals,
      }
    )

    const firstName =
      String(
        job.customer_name ||
        "there"
      )
        .trim()
        .split(/\s+/)[0] ||
      "there"

    const apology =
      `I'm sorry, ${firstName}. ` +
      `It sounds like this automated conversation has been frustrating. ` +
      `I've stopped the automated messages and asked a ${tenantDisplayName} representative to contact you directly.`

    let apologyResult: any = null

    if (callbackNumber) {
      try {
        const sms =
          await sendSMS(
            callbackNumber,
            apology
          )

        apologyResult = {
          sent: true,
          to:
            callbackNumber,
          twilio_sid:
            sms.sid,
          twilio_status:
            sms.status,
        }

        await addTimelineEvent(
          tenantId,
          jobId,
          "ai_inbound_response_sent",
          apology,
          {
            classification:
              "frustrated_customer",
            sender:
              tenantDisplayName,
            channel:
              "sms",
            to:
              callbackNumber,
            twilio_sid:
              sms.sid,
            twilio_status:
              sms.status,
            final_automated_message:
              true,
          }
        )
      } catch (err: any) {
        apologyResult = {
          sent: false,
          error:
            err?.message ||
            String(err),
        }

        await addTimelineEvent(
          tenantId,
          jobId,
          "ai_message_send_failed",
          `Frustration apology failed to send: ${
            err?.message ||
            String(err)
          }`,
          {
            classification:
              "frustrated_customer",
            channel:
              "sms",
            to:
              callbackNumber,
          }
        )
      }
    } else {
      apologyResult = {
        sent: false,
        skipped: true,
        reason:
          "missing_phone",
      }
    }

    const alertResult =
      await sendFrustratedCustomerAlert(
        job,
        trimmed,
        frustrationSignals,
        settings,
        callbackNumber
      )

    await addTimelineEvent(
      tenantId,
      jobId,
      "frustrated_customer_alert_routed",
      "Frustrated customer routed to Good2Go for human takeover.",
      {
        from,
        channel:
          "sms",
        matched_patterns:
          frustrationSignals,
        apology_result:
          apologyResult,
        alert_result:
          alertResult,
      }
    )

    await logSystemEvent(
      "customer_frustration_detected",
      "job",
      jobId,
      {
        tenant_slug:
          tenantSlug,
        from,
        channel:
          "sms",
        message:
          trimmed,
        matched_patterns:
          frustrationSignals,
        bot_paused:
          true,
        apology_result:
          apologyResult,
        alert_result:
          alertResult,
      }
    )

    return {
      ok: true,
      tenant_id:
        tenantId,
      job_id:
        jobId,
      classification:
        "frustrated_customer",
      bot_paused:
        true,
      human_takeover_required:
        true,
      matched_patterns:
        frustrationSignals,
      apology:
        apologyResult,
      alert:
        alertResult,
    }
  }

  const definitiveDisengagement =
    detectDefinitiveDisengagement(trimmed)

  if (definitiveDisengagement) {
    await pool.query(
      `
      update jobs
      set
        bot_paused = true,
        bot_pause_reason = $3,
        crm_substatus = 'customer_disengaged',
        crm_flow_key = 'human_review_customer_disengaged',
        updated_at = now()
      where tenant_id = $1
        and id = $2
      `,
      [
        tenantId,
        jobId,
        definitiveDisengagement,
      ]
    )

    await pool.query(
      `
      update scheduled_actions
      set
        status = 'cancelled',
        updated_at = now()
      where tenant_id = $1
        and job_id = $2
        and status = 'pending'
      `,
      [
        tenantId,
        jobId,
      ]
    )

    await addTimelineEvent(
      tenantId,
      jobId,
      "customer_disengaged",
      trimmed,
      {
        from,
        channel: "sms",
        reason:
          definitiveDisengagement,
        automation_paused:
          true,
      }
    )

    await addTimelineEvent(
      tenantId,
      jobId,
      "bot_paused",
      "Automated follow-up stopped because customer indicated the opportunity is no longer active.",
      {
        from,
        channel: "sms",
        reason:
          definitiveDisengagement,
      }
    )

    await logSystemEvent(
      "customer_disengaged",
      "job",
      jobId,
      {
        tenant_slug:
          tenantSlug,
        from,
        channel:
          "sms",
        message:
          trimmed,
        reason:
          definitiveDisengagement,
        bot_paused:
          true,
      }
    )

    return {
      ok: true,
      tenant_id:
        tenantId,
      job_id:
        jobId,
      classification:
        "customer_disengaged",
      disengagement_reason:
        definitiveDisengagement,
      bot_paused:
        true,
      automated_followup_stopped:
        true,
    }
  }

  const latestIntakeQuestion = await getLatestIntakeQuestion(tenantId, jobId)

  if (latestIntakeQuestion?.meta?.missing_service_need) {
    const currentNameIsValid =
      !!job.customer_name &&
      job.customer_name.length > 3 &&
      !isInvalidIntakeName(job.customer_name)

    if (isWeakServiceNeed(trimmed)) {
      const question = currentNameIsValid
        ? `Hi ${String(job.customer_name || "there").trim().split(/\s+/)[0]} — got your message. Briefly, what do you need help with? For example: roof leak, estimate, inspection, tarp, repair, or insurance claim.`
        : "Got it — what’s your full name?"

      await sendSMS(callbackNumber, question)

      await addTimelineEvent(
        tenantId,
        jobId,
        "intake_question_sent",
        question,
        {
          stage: "intake",
          missing_name: !currentNameIsValid,
          missing_address: false,
          missing_service_need: currentNameIsValid,
          weak_service_need_reprompt: true,
        }
      )

      return {
        ok: true,
        intake_in_progress: true,
        reason: currentNameIsValid
          ? "waiting_for_clear_service_need"
          : "waiting_for_customer_name",
      }
    }

    const updatedJob = await getJob(tenantId, jobId)

    await addTimelineEvent(
      tenantId,
      jobId,
      "intake_service_need_captured",
      trimmed,
      {
        from,
        channel: "sms",
      }
    )

    const intakeAlertText =
      `SMS INTAKE COMPLETE\n` +
      `Customer: ${updatedJob.customer_name || "Unknown Customer"}\n` +
      `Job ID: ${jobId}\n` +
      `Phone: ${callbackNumber || from || "Unknown"}\n` +
      `Address / ZIP: ${updatedJob.address1 || "Not provided"}\n` +
      `Need: ${trimmed}\n\n` +
      `Next: Call customer and confirm next step.`

    let intakeEmailResult: any = null
    let intakeSmsResult: any = null

    if (alertTargets.alert_sms_to) {
      try {
        intakeSmsResult = await sendSMS(alertTargets.alert_sms_to, intakeAlertText)
      } catch (err: any) {
        intakeSmsResult = { error: err?.message || String(err) }
      }
    }

    if (alertTargets.alert_email_to) {
      try {
        intakeEmailResult = await sendAlertEmail(
          alertTargets.alert_email_to,
          `SMS intake complete: ${updatedJob.customer_name || `Job #${jobId}`}`,
          intakeAlertText
        )
      } catch (err: any) {
        intakeEmailResult = { error: err?.message || String(err) }
      }
    }

    await addTimelineEvent(
      tenantId,
      jobId,
      "intake_complete_alert_routed",
      "SMS intake completed and routed to owner",
      {
        from,
        channel: "sms",
        service_need: trimmed,
        alert_sms_to: alertTargets.alert_sms_to,
        alert_email_to: alertTargets.alert_email_to,
        sms_result: intakeSmsResult,
        email_result: intakeEmailResult,
        sms_preview: intakeAlertText,
      }
    )

    await logSystemEvent("sms_intake_completed", "job", jobId, {
      tenant_slug: tenantSlug,
      from,
      channel: "sms",
      service_need: trimmed,
      alert_sms_to: alertTargets.alert_sms_to,
      alert_email_to: alertTargets.alert_email_to,
      sms_result: intakeSmsResult,
      email_result: intakeEmailResult,
    })

    const intakeTenantDisplayName =
      await getTenantDisplayName(
        tenantId,
        tenantSlug
      )

    await sendSMS(
      callbackNumber,
      `Thanks — we received your information and someone from ${intakeTenantDisplayName} will follow up.`
    )

    return {
      ok: true,
      intake_complete: true,
      tenant_id: tenantId,
      job_id: jobId,
      alert_sms_to: alertTargets.alert_sms_to,
      alert_email_to: alertTargets.alert_email_to,
    }
  }

  if (latestIntakeQuestion?.meta?.missing_name) {
    const capturedName = cleanIntakeName(trimmed)

    if (capturedName.length >= 3) {
      await updateCustomerNameForIntake(tenantId, job.customer_id, capturedName)

      await addTimelineEvent(
        tenantId,
        jobId,
        "intake_name_captured",
        capturedName,
        {
          from,
          channel: "sms",
        }
      )

      const nextQuestion = "Thanks — what’s the property address or ZIP?"

      await sendSMS(callbackNumber, nextQuestion)

      await addTimelineEvent(
        tenantId,
        jobId,
        "intake_question_sent",
        nextQuestion,
        {
          stage: "intake",
          missing_name: false,
          missing_address: true,
        }
      )

      return {
        ok: true,
        intake_in_progress: true,
        intake_step_completed: "name",
        reason: "waiting_for_property_address",
      }
    }
  }

  if (latestIntakeQuestion?.meta?.missing_address) {
    await updateJobAddressForIntake(tenantId, jobId, trimmed)
    job.address1 = trimmed

    await addTimelineEvent(
      tenantId,
      jobId,
      "intake_address_captured",
      trimmed,
      {
        from,
        channel: "sms",
        zip_detected: extractZip(trimmed),
      }
    )

    const nextQuestion =
      "Thanks — briefly, what do you need help with? For example: roof leak, estimate, inspection, tarp, repair, or insurance claim."

    await sendSMS(callbackNumber, nextQuestion)

    await addTimelineEvent(
      tenantId,
      jobId,
      "intake_question_sent",
      nextQuestion,
      {
        stage: "intake",
        missing_name: false,
        missing_address: false,
        missing_service_need: true,
      }
    )

    return {
      ok: true,
      intake_in_progress: true,
      intake_step_completed: "address",
      reason: "waiting_for_service_need",
    }
  }

  const classification = classifyInboundMessage(trimmed)
  const matchedSignals = detectBuyingSignals(trimmed)

  const salesIntent = detectSalesIntent(trimmed)
  const salesIntentReply = salesIntent ? buildSalesIntentReply(salesIntent, job) : null

  if (salesIntent && salesIntentReply && callbackNumber) {
    await addTimelineEvent(
      tenantId,
      jobId,
      "sales_intent_detected",
      `Sales intent detected: ${salesIntent}`,
      {
        intent: salesIntent,
        from,
        channel: "sms",
        stage: job.stage,
      }
    )

    await logSystemEvent("sales_intent_detected", "job", jobId, {
      tenant_slug: tenantSlug,
      intent: salesIntent,
      from,
      channel: "sms",
      stage: job.stage,
      message: trimmed,
    })

    const sms = await sendSMS(callbackNumber, salesIntentReply)

    await addTimelineEvent(
      tenantId,
      jobId,
      "ai_inbound_response_sent",
      salesIntentReply,
      {
        intent: salesIntent,
        from,
        to: callbackNumber,
        channel: "sms",
        twilio_sid: sms.sid,
        twilio_status: sms.status,
      }
    )

    let buyingSignalAlertResult: any = null

    const isHighIntent =
      salesIntent === "contract_request" ||
      matchedSignals.length > 0 ||
      trimmed.toLowerCase().includes("ready") ||
      trimmed.toLowerCase().includes("move forward") ||
      trimmed.toLowerCase().includes("get started")

    if (isHighIntent) {
      /*
       * Buying-signal durability is a Navigator invariant.
       *
       * The dashboard derives has_buying_signal from the
       * buying_signal_detected timeline event. Sales-intent
       * handling returns early, so the signal must become
       * durable here before the alert is dispatched.
       */
      const durableBuyingSignals =
        matchedSignals.length
          ? matchedSignals
          : [salesIntent]

      await addTimelineEvent(
        tenantId,
        jobId,
        "buying_signal_detected",
        "Buying signal detected from customer reply",
        {
          matched_signals: durableBuyingSignals,
          alert_sms_to: alertTargets.alert_sms_to,
          alert_email_to: alertTargets.alert_email_to,
        }
      )

      await logSystemEvent(
        "buying_signal_detected",
        "job",
        jobId,
        {
          tenant_slug: tenantSlug,
          from,
          channel: "sms",
          matched_signals: durableBuyingSignals,
          alert_sms_to: alertTargets.alert_sms_to,
          alert_email_to: alertTargets.alert_email_to,
          message: trimmed,
        }
      )

      buyingSignalAlertResult = await sendBuyingSignalAlerts(
        job,
        trimmed,
        durableBuyingSignals,
        settings,
        callbackNumber
      )

      await addTimelineEvent(
        tenantId,
        jobId,
        "high_intent_alert_routed",
        "High-intent customer reply routed to owner.",
        {
          intent: salesIntent,
          matched_signals: matchedSignals,
          alert_result: buyingSignalAlertResult,
          from,
          channel: "sms",
        }
      )


      await logSystemEvent("high_intent_alert_sent", "job", jobId, {
        tenant_slug: tenantSlug,
        intent: salesIntent,
        matched_signals: matchedSignals,
        alert_result: buyingSignalAlertResult,
        from,
        channel: "sms",
      })
    }

    if (salesIntent === "callback_request") {
      await pool.query(
        `
        update jobs
        set bot_paused = true,
            crm_substatus = 'callback_context_requested',
            updated_at = now()
        where tenant_id = $1
          and id = $2
        `,
        [tenantId, jobId]
      )

      await addTimelineEvent(
        tenantId,
        jobId,
        "bot_paused",
        "Bot paused after callback request so staff can take over after customer provides context.",
        {
          reason: "callback_request",
          from,
          channel: "sms",
        }
      )
    }

    return {
      ok: true,
      handled_by_sales_intent_engine: true,
      intent: salesIntent,
      message: salesIntentReply,
      high_intent_alert_routed: Boolean(buyingSignalAlertResult),
    }
  }

// Customer replies proceed through the normal inbound routing path.
// Explicit intake remains controlled by latestIntakeQuestion state above.
// No message-length or "weak message" heuristic is applied.

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
      matched_signals: matchedSignals,
    }
  )

  await logSystemEvent("sms_reply_classified", "job", jobId, {
    tenant_slug: tenantSlug,
    classification,
    crm_substatus: routing.crm_substatus,
    crm_flow_key: routing.crm_flow_key,
    from,
    channel: "sms",
    matched_signals: matchedSignals,
  })

  /*
   * Navigator executes the customer interaction.
   * Headquarters learns from the resulting evidence.
   *
   * Observation submission is deliberately fail-safe:
   * Headquarters availability must never interrupt the
   * existing SMS workflow.
   */
  try {
    const observedAt = new Date().toISOString()

    await submitNavigatorObservation({
      id:
        `navigator-sms-${tenantId}-${jobId}-${Date.now()}`,
      tenant_id:
        String(tenantId),
      tenant_slug:
        tenantSlug,
      assistant_type:
        "ai_followup",
      type:
        "customer_behavior",
      summary:
        `Navigator classified an inbound SMS reply as '${classification}'.`,
      observed_at:
        observedAt,
      approved_at:
        observedAt,
      evidence: {
        job_id:
          jobId,
        channel:
          "sms",
        direction:
          "inbound",
        customer_message:
          trimmed,
        from:
          from,
        customer_name:
          job.customer_name || null,
        job_stage:
          job.stage || null,
        classification:
          classification,
        crm_substatus:
          routing.crm_substatus,
        crm_flow_key:
          routing.crm_flow_key,
        matched_signals:
          matchedSignals,
      },
    })
  } catch (error) {
    console.warn(
      "Navigator inbound SMS Headquarters observation unavailable; existing SMS workflow continues unchanged.",
      error
    )
  }

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

    await logSystemEvent("buying_signal_detected", "job", jobId, {
      tenant_slug: tenantSlug,
      from,
      channel: "sms",
      matched_signals: matchedSignals,
      alert_sms_to: alertTargets.alert_sms_to,
      alert_email_to: alertTargets.alert_email_to,
      message: trimmed,
    })

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
  } else if (classification !== "unknown") {
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
  } else {
    const customerReplyAlertText =
      `CUSTOMER RESPONSE ALERT\n` +
      `Customer: ${job.customer_name || "Unknown Customer"}\n` +
      `Job ID: ${jobId}\n` +
      `Phone: ${callbackNumber || from || "Unknown"}\n\n` +
      `Message:\n${trimmed}\n\n` +
      `Next: Review this customer response and reply if needed.`

    let customerReplyEmailResult: any = null

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
        sms_result: { skipped: true, reason: "email_only_customer_reply_alert" },
        email_result: customerReplyEmailResult,
        sms_preview: customerReplyAlertText,
      }
    )


    await logSystemEvent("customer_reply_alert_sent", "job", jobId, {
      tenant_slug: tenantSlug,
      from,
      channel: "sms",
      alert_sms_to: alertTargets.alert_sms_to,
      alert_email_to: alertTargets.alert_email_to,
      email_result: customerReplyEmailResult,
      message: trimmed,
    })
  }

  await sendAutoClassificationReply(
    tenantSlug,
    tenantId,
    jobId,
    job,
    classification,
    settings,
    callbackNumber,
    trimmed
  )

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
        "customer_frustration_detected",
        "frustrated_customer_alert_routed",
        "bot_paused",
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
        'VOICE_INTAKE',
        'intake_pending',
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
    "voice_intake_started",
    "Voice intake started; not counted as qualified lead until caller provides required information.",
    {
      from: phone,
      source,
    }
  )

  await addTimelineEvent(
    tenantId,
    jobId,
    "voice_generic_lead_alert_skipped",
    "Generic voice lead alert skipped because voice dispatch summary is the primary owner notification",
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
