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
    return { ok: true, disposable_database_verified: true, schema_inspected: false }
  } catch {
    return reply.code(503).send({ ok: false })
  }
})
void app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 10000) })
  .catch(error => { console.error(error); process.exitCode = 1 })
