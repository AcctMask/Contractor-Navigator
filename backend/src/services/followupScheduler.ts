import { pool } from "../db/db"
import { queueAiFollowupByTenantSlug } from "./followupEngine"
import { getDeveloperSettingsByTenantSlug } from "./devSettingsService"

type SchedJob = {
  id: number
  tenant_slug: string
  stage: string | null
  bot_paused: boolean
  created_at: string
}

type StageStats = {
  count: number
  last_message_at: string | null
}

let schedulerStarted = false

const POLL_MS = 60 * 1000
const MAX_AUTOMATION_JOB_AGE_MS = 24 * 60 * 60 * 1000

function timingsToMs(values: number[]) {
  return values.map((n) => Number(n) * 60 * 1000)
}

async function stageDelaysForTenant(tenantSlug: string, stage: string | null) {
  const settings = await getDeveloperSettingsByTenantSlug(tenantSlug)

  if (stage === "lead") {
    return timingsToMs(settings.lead_timings_minutes)
  }

  if (stage === "estimate_sent") {
    return timingsToMs(settings.estimate_timings_minutes)
  }

  if (stage === "contract_sent") {
    return timingsToMs(settings.contract_timings_minutes)
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
      t.slug as tenant_slug,
      j.stage,
      j.bot_paused,
      j.created_at
    from jobs j
    join tenants t
      on t.id = j.tenant_id
    where j.stage in ('lead', 'estimate_sent', 'contract_sent')
    order by j.created_at desc
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
      and lower(kind) in ('ai_message_generated', 'ai_message_sent', 'ai_message_send_failed')
      and coalesce(meta->>'stage', '') = $2
    `,
    [jobId, stage]
  )

  return {
    count: Number(result.rows[0]?.count || 0),
    last_message_at: result.rows[0]?.last_message_at || null,
  }
}

function isRecentEnough(createdAt: string) {
  const createdMs = new Date(createdAt).getTime()
  const nowMs = Date.now()
  return nowMs - createdMs <= MAX_AUTOMATION_JOB_AGE_MS
}

async function processJob(job: SchedJob) {
  if (job.bot_paused || !job.stage) return

  const delays = await stageDelaysForTenant(job.tenant_slug, job.stage)
  if (!delays.length) return

  if (!isRecentEnough(job.created_at)) return

  const stats = await getStageStats(job.id, job.stage)
  if (stats.count >= delays.length) return

  const gapMs = nextGapMs(delays, stats.count)
  if (gapMs == null) return

  const nowMs = Date.now()

  if (stats.count === 0) {
    const createdMs = new Date(job.created_at).getTime()
    if (nowMs - createdMs < gapMs) return

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
