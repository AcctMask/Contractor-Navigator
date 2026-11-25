import assert from "node:assert/strict"
import Fastify from "fastify"

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:1/test"
process.env.AA_ACTIVITY_GATEWAY_SECRET = "sms-service-test-secret"

async function main() {
  const { pool } = await import("../src/db/db")
  const { registerOpsIntelBridgeRoutes } = await import("../src/routes/opsIntelBridge")
  const queries: Array<{ sql: string; params: unknown[] }> = []
  ;(pool as any).query = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params })
    if (sql.includes("from tenants") && sql.includes("where slug = $1")) {
      if (params[0] === "unknown") return { rowCount: 0, rows: [] }
      assert.deepEqual(params, ["g2g-roofing"])
      return { rowCount: 1, rows: [{ id: 17, slug: "g2g-roofing" }] }
    }
    if (sql.includes("from timeline_events")) {
      assert.equal(params[0], 17, "must scope all aggregates to authorized tenant")
      assert.ok(sql.includes("count(distinct nullif(meta->>'twilio_sid', '')"))
      return { rows: [{
        followup_submissions: 993, inbound_response_submissions: 326,
        total_unique_twilio_sids: 1319, submissions_without_sid: 0,
        queued_at_submission: 1319, failed_send_events: 66803,
        delivery_halts: 19, dnc_halts: 0,
      }] }
    }
    throw new Error("Unexpected SQL query")
  }
  const app = Fastify()
  await registerOpsIntelBridgeRoutes(app)
  const path = "/integrations/ops-intel/g2g-roofing/sms-metrics.json?range=all"
  const unauth = await app.inject({ method: "GET", url: path })
  assert.equal(unauth.statusCode, 401)
  assert.equal(queries.length, 0)
  const bad = await app.inject({ method: "GET", url: path, headers: { "x-aa-activity-secret": "wrong" } })
  assert.equal(bad.statusCode, 401)
  assert.equal(queries.length, 0)
  const headers = { "x-aa-activity-secret": process.env.AA_ACTIVITY_GATEWAY_SECRET }
  const invalidRange = await app.inject({ method: "GET", url: path.replace("all","week"), headers })
  assert.equal(invalidRange.statusCode, 400)
  const unknown = await app.inject({ method: "GET", url: "/integrations/ops-intel/unknown/sms-metrics.json", headers })
  assert.equal(unknown.statusCode, 404)
  const ok = await app.inject({ method: "GET", url: path, headers })
  assert.equal(ok.statusCode, 200, ok.body)
  const body = ok.json()
  assert.equal(body.metrics.total_unique_twilio_sids, 1319)
  assert.equal(body.metrics.followup_submissions, 993)
  assert.equal(body.metrics.inbound_response_submissions, 326)
  assert.equal(body.delivery.confirmed, false)
  assert.ok(!ok.body.includes("phone"))
  assert.ok(!ok.body.includes("customer"))
  assert.ok(!ok.body.includes("job_id"))
  assert.ok(queries.some(q => q.sql.includes("from timeline_events") && q.params[0] === 17))
  await app.close()
  console.log("PASS OIM SMS metrics auth, tenant scoping, aggregation and delivery disclosure")
}
main().catch(err => { console.error(err); process.exitCode = 1 })
