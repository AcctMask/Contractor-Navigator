import { pool } from "./db/db"

async function main() {
  console.log("\nLATEST JOB 27:")
  const job = await pool.query(`
    select id, stage, crm_substatus, bot_paused, updated_at
    from jobs
    where id = 27
  `)
  console.table(job.rows)

  console.log("\nLATEST SCHEDULED ACTIONS FOR JOB 27:")
  const actions = await pool.query(`
    select id, job_id, action_key, status, run_at, payload, created_at
    from scheduled_actions
    where job_id = 27
    order by created_at desc
    limit 20
  `)
  console.table(actions.rows)

  console.log("\nLATEST TIMELINE EVENTS FOR JOB 27:")
  const timeline = await pool.query(`
    select id, kind, message, meta, created_at
    from timeline_events
    where job_id = 27
    order by created_at desc
    limit 20
  `)
  console.table(timeline.rows)

  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  await pool.end()
  process.exit(1)
})
