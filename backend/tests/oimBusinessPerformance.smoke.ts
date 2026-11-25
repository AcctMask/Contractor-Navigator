import assert from "node:assert/strict"
import Fastify from "fastify"

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:1/test"
process.env.AA_ACTIVITY_GATEWAY_SECRET = "test-oim-gateway-secret"

async function main() {
  const { pool } = await import("../src/db/db")
  const { registerOpsIntelBridgeRoutes } = await import("../src/routes/opsIntelBridge")
  let tenantQueries = 0
  ;(pool as any).query = async (sql:string, params:unknown[] = []) => {
    if (sql.includes("from tenants") && sql.includes("where slug = $1")) {
      tenantQueries++
      assert.deepEqual(params, ["unregistered-tenant"])
      return { rows:[], rowCount:0 }
    }
    throw Error("Unexpected database query in isolated service boundary test")
  }
  const app=Fastify()
  await registerOpsIntelBridgeRoutes(app)
  const url="/integrations/ops-intel/unregistered-tenant/business-performance-v2.json?range=all"
  const unauth=await app.inject({method:"GET",url})
  assert.equal(unauth.statusCode,401)
  const bad=await app.inject({method:"GET",url,headers:{"x-aa-activity-secret":"invalid"}})
  assert.equal(bad.statusCode,401)
  const auth=await app.inject({method:"GET",url,headers:{"x-aa-activity-secret":process.env.AA_ACTIVITY_GATEWAY_SECRET}})
  assert.equal(auth.statusCode,404)
  assert.equal(tenantQueries,1)
  await app.close()
  console.log("PASS: new qualified-opportunity service route requires existing gateway credential")
  console.log("PASS: explicit tenant lookup and unknown-tenant rejection")
}
main().catch(err=>{console.error(err);process.exitCode=1})
