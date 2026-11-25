import assert from "node:assert/strict"
import Fastify from "fastify"

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:1/test"
process.env.AA_ACTIVITY_GATEWAY_SECRET = "local-smoke-only-secret"

async function main() {
  const { pool } = await import("../src/db/db")
  const { registerOperationalIntelligenceHandoffRoutes } =
    await import("../src/routes/operationalIntelligenceHandoff")

  let consumed = false
  const queries: string[] = []
  ;(pool as any).query = async (sql: string, params: unknown[] = []) => {
    queries.push(sql)
    if (sql.includes("create table if not exists")) return { rows: [], rowCount: 0 }
    if (sql.includes("update operational_intelligence_handoffs")) {
      if (consumed) return { rows: [], rowCount: 0 }
      consumed = true
      return { rowCount: 1, rows: [{
        navigator_user_id: 3, identity_tenant_id: 1,
        target_tenant_id: 1, target_tenant_slug: "g2g-roofing",
      }] }
    }
    if (sql.includes("from app_users u") && sql.includes("operational_intelligence_access a")) {
      return { rowCount: 1, rows: [{
        id: 3, tenant_id: 1, email: "test@example.invalid",
        full_name: "Test Admin", role: "admin",
        is_active: true, oim_authorized: true,
      }] }
    }
    if (sql.includes("select id from tenants where slug")) {
      return { rowCount: 1, rows: [{ id: params[0] === "g2g-roofing" ? 1 : 2 }] }
    }
    throw new Error("Unexpected query in smoke test")
  }

  const app = Fastify()
  await registerOperationalIntelligenceHandoffRoutes(app)
  const path = "/integrations/ops-intel/handoff/exchange"
  const options = { method: "POST" as const, url: path, payload: {code:"a".repeat(64)} }
  const noCredential = await app.inject(options)
  assert.equal(noCredential.statusCode, 401)

  const wrongCredential = await app.inject({
    ...options, headers: {"x-aa-activity-secret":"wrong"},
  })
  assert.equal(wrongCredential.statusCode, 401)

  const credential = {"x-aa-activity-secret":process.env.AA_ACTIVITY_GATEWAY_SECRET}
  const authorized = await app.inject({...options, headers: credential})
  assert.equal(authorized.statusCode, 200)
  const identity = authorized.json().identity
  assert.equal(identity.tenant_slug, "g2g-roofing")
  assert.equal(identity.role, "admin")

  const replay = await app.inject({...options, headers: credential})
  assert.equal(replay.statusCode, 401)

  const revalidate = await app.inject({
    method:"POST",
    url:"/integrations/ops-intel/handoff/authorize",
    headers:credential,
    payload:{navigator_user_id:3,identity_tenant_id:1,tenant_slug:"g2g-roofing"},
  })
  assert.equal(revalidate.statusCode, 200)
  assert.equal(revalidate.json().authorized, true)

  const crossTenant = await app.inject({
    method:"POST",
    url:"/integrations/ops-intel/handoff/authorize",
    headers:credential,
    payload:{navigator_user_id:3,identity_tenant_id:1,tenant_slug:"actual-assistant-llc"},
  })
  assert.equal(crossTenant.statusCode, 403)

  const noBrowserSession = await app.inject({
    method:"POST", url:"/operational-intelligence/handoff",
    payload:{tenant_slug:"g2g-roofing"},
  })
  assert.equal(noBrowserSession.statusCode, 401)
  await app.close()

  console.log("PASS: service 401 without/invalid secret")
  console.log("PASS: single-use handoff exchanged once")
  console.log("PASS: server-side authorized identity and tenant")
  console.log("PASS: cross-tenant request denied")
  console.log("PASS: browser launch requires Navigator signed session")
  console.log("Queries mocked:",queries.length)
  console.log("=== NAVIGATOR OIM SECURITY SMOKE TEST PASSED ===")
}
main().catch(error=>{ console.error(error); process.exitCode = 1 })
