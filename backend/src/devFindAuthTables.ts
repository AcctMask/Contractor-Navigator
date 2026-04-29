import { pool } from "./db/db"

async function main() {
  const tables = await pool.query(`
    select table_schema, table_name
    from information_schema.tables
    where table_schema not in ('pg_catalog', 'information_schema')
    order by table_schema, table_name
  `)

  console.log("TABLES:")
  for (const row of tables.rows) {
    console.log(`${row.table_schema}.${row.table_name}`)
  }

  const columns = await pool.query(`
    select table_schema, table_name, column_name
    from information_schema.columns
    where lower(column_name) like '%email%'
       or lower(column_name) like '%password%'
       or lower(column_name) like '%user%'
    order by table_schema, table_name, ordinal_position
  `)

  console.log("\nLIKELY AUTH COLUMNS:")
  for (const row of columns.rows) {
    console.log(`${row.table_schema}.${row.table_name}.${row.column_name}`)
  }

  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  await pool.end()
  process.exit(1)
})
