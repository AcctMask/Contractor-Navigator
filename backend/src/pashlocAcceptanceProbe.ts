/** Disposable acceptance connectivity probe. No migrations or writes.
 * Intended only for a dedicated Render private-network acceptance database. */
import Fastify from "fastify"
import { Pool } from "pg"
const app = Fastify({ logger: true })
const databaseUrl = process.env.DATABASE_URL || ""
const expected = process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME || ""
const url = new URL(databaseUrl)
if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw Error("PostgreSQL required")
if (!expected.startsWith("pashloc_") || !expected.includes("disposable") ||
    decodeURIComponent(url.pathname.slice(1)) !== expected ||
    process.env.NODE_ENV !== "test") throw Error("Disposable database boundary rejected")
const pool = new Pool({ connectionString: databaseUrl })
app.get("/healthz", async (_req, reply) => {
  try {
    const result = await pool.query(
      "select current_database() = $1 as correct_database, current_user is not null as authenticated, current_setting('server_version_num')::int >= 140000 as supported_postgres",
      [expected]
    )
    if (Object.values(result.rows[0] || {}).some(value => value !== true))
      return reply.code(503).send({ ok: false })
    const schema = await pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"
    )
    const tables = schema.rows.map((r: { table_name: string }) => r.table_name)
    return { ok: true, disposable_database_verified: true, schema_inspected: true,
      table_count: tables.length, required_table_presence: Object.fromEntries(
        ["tenants", "app_users", "pashloc_enrollments", "pashloc_challenges",
         "pashloc_pairings", "pashloc_nonces", "pashloc_sessions",
         "pashloc_request_limits"].map(name => [name, tables.includes(name)])
      ) }
  } catch {
    return reply.code(503).send({ ok: false })
  }
})
void (async () => {
  const res = await app.inject({ method: "GET", url: "/healthz" })
  console.log("PASHLOC_ACCEPTANCE_DB_INSPECTION", res.body)
  if (res.statusCode !== 200) throw Error("Private disposable database verification failed")
  await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 10000) })
})().catch(error => { console.error(error); process.exit(1) })
