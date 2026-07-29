import { pool } from "../src/db/db"

type BackfillCandidate = {
  id: number
  tenant_slug: string
  customer_name: string | null
  stage: string
  bot_paused: boolean
  crm_flow_key: string | null
  old_workflow: string | null
  proposed_workflow: string
  proposed_started_at: string
  qualification_reason: string
}

const execute = process.argv.includes("--execute")
const preview = process.argv.includes("--preview") || !execute

const candidateSql = `
  select
    j.id,
    t.slug as tenant_slug,
    c.full_name as customer_name,
    j.stage,
    j.bot_paused,
    j.crm_flow_key,
    j.active_followup_workflow as old_workflow,
    case
      when j.stage = 'lead' then 'lead'
      when j.stage = 'estimate_sent' then 'estimate_sent'
      when j.stage = 'contract_sent' then 'contract_sent'
      when j.stage = 'tarp_complete' then 'tarp'
    end as proposed_workflow,
    case
      when j.stage = 'lead'
        then j.created_at
      when j.stage = 'estimate_sent'
        then coalesce(j.estimate_sent_at, j.updated_at, j.created_at)
      when j.stage = 'contract_sent'
        then coalesce(j.contract_sent_at, j.updated_at, j.created_at)
      when j.stage = 'tarp_complete'
        then coalesce(j.tarp_conversion_started_at, j.updated_at, j.created_at)
    end as proposed_started_at,
    case
      when j.stage = 'lead'
        then 'active lead missing workflow initialization'
      when j.stage = 'estimate_sent'
        then 'active estimate follow-up missing workflow initialization'
      when j.stage = 'contract_sent'
        then 'active contract follow-up missing workflow initialization'
      when j.stage = 'tarp_complete'
        then 'active tarp conversion follow-up missing workflow initialization'
    end as qualification_reason
  from jobs j
  join tenants t
    on t.id = j.tenant_id
  left join customers c
    on c.id = j.customer_id
   and c.tenant_id = j.tenant_id
  where j.active_followup_workflow is null
    and j.stage in ('lead', 'estimate_sent', 'contract_sent', 'tarp_complete')
    and coalesce(j.crm_flow_key, '') <> 'weather_evidence_report'
  order by
    t.slug,
    j.stage,
    j.id
`

async function run() {
  const candidateResult = await pool.query(candidateSql)
  const candidates = candidateResult.rows as BackfillCandidate[]

  console.log(
    JSON.stringify(
      {
        mode: preview ? "preview" : "execute",
        candidate_count: candidates.length,
        candidates,
      },
      null,
      2
    )
  )

  if (preview) {
    console.log(
      `\nPREVIEW ONLY: ${candidates.length} job(s) qualify. No rows were changed.`
    )
    return
  }

  if (!candidates.length) {
    console.log("\nNo qualifying jobs were found. Nothing was changed.")
    return
  }

  const client = await pool.connect()

  try {
    await client.query("begin")

    const updateResult = await client.query(
      `
      update jobs j
      set
        active_followup_workflow = case
          when j.stage = 'lead' then 'lead'
          when j.stage = 'estimate_sent' then 'estimate_sent'
          when j.stage = 'contract_sent' then 'contract_sent'
          when j.stage = 'tarp_complete' then 'tarp'
        end,
        followup_workflow_started_at = case
          when j.stage = 'lead'
            then j.created_at
          when j.stage = 'estimate_sent'
            then coalesce(j.estimate_sent_at, j.updated_at, j.created_at)
          when j.stage = 'contract_sent'
            then coalesce(j.contract_sent_at, j.updated_at, j.created_at)
          when j.stage = 'tarp_complete'
            then coalesce(j.tarp_conversion_started_at, j.updated_at, j.created_at)
        end
      where j.active_followup_workflow is null
        and j.stage in ('lead', 'estimate_sent', 'contract_sent', 'tarp_complete')
        and coalesce(j.crm_flow_key, '') <> 'weather_evidence_report'
      returning
        j.id,
        j.tenant_id,
        j.stage,
        j.active_followup_workflow,
        j.followup_workflow_started_at,
        j.bot_paused
      `
    )

    await client.query("commit")

    console.log(
      JSON.stringify(
        {
          executed: true,
          updated_count: updateResult.rowCount,
          updated_jobs: updateResult.rows,
        },
        null,
        2
      )
    )
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

run()
  .catch((error) => {
    console.error("Follow-up workflow backfill failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
