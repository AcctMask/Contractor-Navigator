import { pool } from "../db/db"
import { queueAiFollowupByTenantSlug } from "./followupEngine"
import { getDeveloperSettingsByTenantSlug } from "./devSettingsService"
import { AI_FOLLOWUP_PROGRESS_KIND } from "./followupProgress"
import { sendAlertEmail } from "./emailService"

type SchedJob = {
  id: number
  tenant_id: number
  tenant_slug: string
  stage: string | null
  bot_paused: boolean
  created_at: string
  updated_at: string | null
  estimate_sent_at: string | null
  contract_sent_at: string | null
  crm_flow_key: string | null
  active_followup_workflow: string | null
  followup_workflow_started_at: string | null
}

type StageStats = {
  count: number
  last_message_at: string | null
}

let schedulerStarted = false

const POLL_MS = 60 * 1000

const QUIET_TIME_ZONE = "America/New_York"
const QUIET_START_HOUR = 19
const QUIET_END_HOUR = 7

function isQuietHoursNow() {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: QUIET_TIME_ZONE,
      hour: "2-digit",
      hour12: false,
    }).format(new Date())
  )

  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR
}

function timingsToMs(values: number[]) {
  return values.map((n) => Number(n) * 60 * 1000)
}

async function workflowDelaysForTenant(
  tenantSlug: string,
  activeWorkflow: string | null,
  crmFlowKey?: string | null
) {
  const settings = await getDeveloperSettingsByTenantSlug(tenantSlug)

  if (crmFlowKey === "weather_evidence_report") {
    return timingsToMs(settings.weather_report_timings_minutes || [])
  }

  if (activeWorkflow === "lead") {
    return timingsToMs(settings.lead_timings_minutes || [])
  }

  if (activeWorkflow === "demo_scheduled") {
    return timingsToMs(settings.demo_scheduled_timings_minutes || [])
  }

  if (activeWorkflow === "demo_completed_follow_up") {
    return timingsToMs(settings.demo_completed_follow_up_timings_minutes || [])
  }

  if (activeWorkflow === "estimate_sent") {
    return timingsToMs(settings.estimate_timings_minutes || [])
  }

  if (activeWorkflow === "contract_sent") {
    return timingsToMs(settings.contract_timings_minutes || [])
  }

  if (activeWorkflow === "wa_sent") {
    return timingsToMs(settings.wa_sent_timings_minutes || [])
  }

  if (activeWorkflow === "tarp_active") {
    return timingsToMs(settings.tarp_active_timings_minutes || [])
  }

  if (activeWorkflow === "tarp") {
    return timingsToMs(settings.tarp_timings_minutes || [])
  }

  return []
}

function nextGapMs(delays: number[], alreadySentCount: number) {
  if (!delays.length) return null
  if (alreadySentCount >= delays.length) return null

  if (alreadySentCount === 0) {
    return delays[0]
  }

  return delays[alreadySentCount] - delays[alreadySentCount - 1]
}

async function getAutomatedJobs(): Promise<SchedJob[]> {
  const result = await pool.query(
    `
    select
      j.id,
      j.tenant_id,
      t.slug as tenant_slug,
      j.stage,
      j.bot_paused,
      j.created_at,
      j.updated_at,
      j.estimate_sent_at,
      j.contract_sent_at,
      j.crm_flow_key,
      j.active_followup_workflow,
      j.followup_workflow_started_at
    from jobs j
    join tenants t
      on t.id = j.tenant_id
    where (
      j.active_followup_workflow is not null
      or j.crm_flow_key = 'weather_evidence_report'
    )
    order by coalesce(j.followup_workflow_started_at, j.created_at) desc
    limit 500
    `
  )

  return result.rows as SchedJob[]
}

async function getStageStats(jobId: number, stage: string): Promise<StageStats> {
  const result = await pool.query(
    `
    select
      count(*)::int as count,
      max(created_at) as last_message_at
    from timeline_events
    where job_id = $1
      and lower(kind) = $3
      and coalesce(meta->>'stage', '') = $2
    `,
    [jobId, stage, AI_FOLLOWUP_PROGRESS_KIND]
  )

  return {
    count: Number(result.rows[0]?.count || 0),
    last_message_at: result.rows[0]?.last_message_at || null,
  }
}

function getWorkflowClockAt(job: SchedJob) {
  return job.followup_workflow_started_at || job.created_at
}

function getAutomationKey(job: SchedJob) {
  if (job.crm_flow_key === "weather_evidence_report") {
    return "weather_evidence_report"
  }

  return job.active_followup_workflow || "unknown"
}

const AA_DEMO_PROPOSAL_REMINDER_KIND =
  "aa_demo_proposal_reminder_sent"

const AA_DEMO_PROPOSAL_REMINDER_MS =
  7 * 24 * 60 * 60 * 1000

async function maybeSendAaDemoProposalReminder(
  job: SchedJob,
  workflowClockAt: string
) {
  if (
    job.tenant_slug !== "actual-assistant-llc" ||
    job.active_followup_workflow !==
      "demo_completed_follow_up"
  ) {
    return
  }

  const workflowStartedMs =
    new Date(workflowClockAt).getTime()

  if (
    !Number.isFinite(workflowStartedMs) ||
    Date.now() - workflowStartedMs <
      AA_DEMO_PROPOSAL_REMINDER_MS
  ) {
    return
  }

  const existing = await pool.query(
    `
    select id
    from timeline_events
    where tenant_id = $1
      and job_id = $2
      and kind = $3
    limit 1
    `,
    [
      job.tenant_id,
      job.id,
      AA_DEMO_PROPOSAL_REMINDER_KIND,
    ]
  )

  if (existing.rowCount) {
    return
  }

  const settings =
    await getDeveloperSettingsByTenantSlug(
      job.tenant_slug
    )

  const alertEmail =
    String(
      settings.alert_email_to || ""
    ).trim()

  if (!alertEmail) {
    console.warn(
      "AA Demo Completed proposal reminder skipped: alert_email_to is not configured",
      {
        tenant_slug: job.tenant_slug,
        job_id: job.id,
      }
    )
    return
  }

  const subject =
    `AA Proposal Follow-Up Needed — Job #${job.id}`

  const message =
    `This Actual Assistant prospect has remained in Demo Completed Follow-Up for 7 days.\n\n` +
    `Job ID: ${job.id}\n` +
    `Tenant: ${job.tenant_slug}\n\n` +
    `Review the conversation and what Actual Assistant has learned about the prospect. ` +
    `If appropriate, prepare and send a personalized proposal, examples, or recommended starting point. ` +
    `When you have sent it, move the prospect to Proposal Sent so the Proposal Sent follow-up sequence begins.\n\n` +
    `Navigator has not changed the prospect's stage automatically.`

  await sendAlertEmail(
    alertEmail,
    subject,
    message
  )

  await pool.query(
    `
    insert into timeline_events
      (
        tenant_id,
        job_id,
        kind,
        message,
        meta,
        created_at
      )
    values
      (
        $1,
        $2,
        $3,
        $4,
        $5::jsonb,
        now()
      )
    `,
    [
      job.tenant_id,
      job.id,
      AA_DEMO_PROPOSAL_REMINDER_KIND,
      "AA owner notified to review Demo Completed prospect for proposal follow-up",
      JSON.stringify({
        tenant_slug: job.tenant_slug,
        workflow:
          "demo_completed_follow_up",
        reminder_after_days: 7,
        alert_email_to: alertEmail,
        stage_changed: false,
      }),
    ]
  )

  console.log(
    "✅ AA Demo Completed Day-7 proposal reminder sent",
    {
      job_id: job.id,
      alert_email_to: alertEmail,
    }
  )
}

async function processJob(job: SchedJob) {
  if (isQuietHoursNow()) return
  if (job.bot_paused) return

  const automationKey = getAutomationKey(job)
  if (automationKey === "unknown") return

  const delays = await workflowDelaysForTenant(
    job.tenant_slug,
    job.active_followup_workflow,
    job.crm_flow_key
  )
  if (!delays.length) return

  const workflowClockAt = getWorkflowClockAt(job)

  await maybeSendAaDemoProposalReminder(
    job,
    workflowClockAt
  )

  const stats = await getStageStats(job.id, automationKey)

  const continuousOperationalWorkflow =
    automationKey === "wa_sent" ||
    automationKey === "tarp_active"

  if (
    !continuousOperationalWorkflow &&
    stats.count >= delays.length
  ) {
    return
  }

  let gapMs = nextGapMs(delays, stats.count)

  if (
    continuousOperationalWorkflow &&
    gapMs == null &&
    delays.length
  ) {
    gapMs =
      delays.length >= 2
        ? Math.max(
            delays[delays.length - 1] -
              delays[delays.length - 2],
            60 * 1000
          )
        : Math.max(
            delays[0],
            60 * 1000
          )
  }

  if (gapMs == null) return

  const nowMs = Date.now()

  if (stats.count === 0) {
    const workflowClockMs = new Date(workflowClockAt).getTime()
    if (nowMs - workflowClockMs < gapMs) return

    await queueAiFollowupByTenantSlug(job.tenant_slug, job.id)
    return
  }

  if (!stats.last_message_at) return

  const lastMessageMs = new Date(stats.last_message_at).getTime()
  if (nowMs - lastMessageMs < gapMs) return

  await queueAiFollowupByTenantSlug(job.tenant_slug, job.id)
}

async function runSchedulerPass() {
  const jobs = await getAutomatedJobs()

  for (const job of jobs) {
    try {
      await processJob(job)
    } catch (err) {
      console.error("followup scheduler job error", job.id, err)
    }
  }
}

export function startFollowupScheduler() {
  if (schedulerStarted) return
  schedulerStarted = true

  runSchedulerPass().catch((err) => {
    console.error("initial followup scheduler pass failed", err)
  })

  setInterval(() => {
    runSchedulerPass().catch((err) => {
      console.error("followup scheduler pass failed", err)
    })
  }, POLL_MS)
}
