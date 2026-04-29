import { pool } from "./db/db"

async function main() {
  const result = await pool.query(`
    select
      column_name,
      data_type,
      is_nullable,
      column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_assets'
    order by ordinal_position
  `)

  console.table(result.rows)

  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  await pool.end()
  process.exit(1)
})
