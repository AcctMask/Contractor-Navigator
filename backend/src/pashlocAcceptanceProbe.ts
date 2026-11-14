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
    const identities = await pool.query(
      "select (select count(*)::int from tenants) as tenant_count, (select count(*)::int from app_users) as user_count, exists(select 1 from tenants where slug = 'pashloc-genuine-acceptance-20261114') as expected_tenant"
    )
    return { tenant_and_user_readiness: identities.rows[0], ok: true, disposable_database_verified: true, schema_inspected: true,
      table_count: tables.length, required_table_presence: Object.fromEntries(
        ["tenants", "app_users", "pashloc_mfa_enrollments", "pashloc_mfa_challenges",
         "pashloc_mfa_pairings", "pashloc_mfa_device_claim_nonces",
         "pashloc_mfa_restricted_browser_sessions", "pashloc_mfa_request_limits"].map(name => [name, tables.includes(name)])
      ) }
  } catch {
    return reply.code(503).send({ ok: false })
  }
})
void (async () => {
  if (process.env.PASHLOC_ACCEPTANCE_APPLY_SCHEMA === "yes") {
    await import("./pashlocAcceptanceMigration")
  }
  if (process.env.PASHLOC_ACCEPTANCE_VERIFY_SHARED_LIMITS === "yes") {
    await import("./pashlocAcceptanceRateLimitProof")
  }
  const res = await app.inject({ method: "GET", url: "/healthz" })
  console.log("PASHLOC_ACCEPTANCE_DB_INSPECTION", res.body)
  if (res.statusCode !== 200) throw Error("Private disposable database verification failed")
  if (process.env.PASHLOC_ACCEPTANCE_RUN_GENUINE === "yes") {
    const { buildMfaAcceptanceServer } = await import("./pashlocAcceptanceServer")
    const genuine = await buildMfaAcceptanceServer()
    const checks = [
      {method:"GET" as const,url:"/healthz",expected:200},
      {method:"GET" as const,url:"/auth/me",expected:401},
      {method:"GET" as const,url:"/admin/jobs/pashloc-genuine-acceptance-20261114",expected:401},
      {method:"GET" as const,url:"/calendar/pashloc-genuine-acceptance-20261114/events",expected:401},
      {method:"POST" as const,url:"/admin/jobs/pashloc-genuine-acceptance-20261114",expected:404},
      {method:"GET" as const,url:"/admin/unknown-route",expected:404},
      {method:"POST" as const,url:"/auth/mfa/enrollment/start",payload:{},headers:{origin:"https://untrusted.invalid","content-type":"application/json"},expected:403}
    ]
    for (const check of checks) {
      const {expected,...request} = check
      const response = await genuine.inject(request)
      console.log("PASHLOC_GENUINE_ENDPOINT_CHECK",JSON.stringify({method:request.method,path:request.url,expected,actual:response.statusCode,passed:response.statusCode===expected}))
      if (response.statusCode!==expected) throw Error("Genuine acceptance endpoint rejection check failed")
    }
    await genuine.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 10000) })
    console.log("PASHLOC_GENUINE_ACCEPTANCE_LISTENING")
  } else {
    await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 10000) })
  }
})().catch(error => { console.error(error); process.exit(1) })
