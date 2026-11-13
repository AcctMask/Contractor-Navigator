async function provisionHostedFixture() {
 const service = "srv-dbrftcl6e07s73bisj4g"
 const dbHost = "dpg-dbrfo7ec6qcc73dp7g00-a"
 const dbName = "pashloc_iv_disposable_mfa_isolated"
 const dbUser = "pashloc_iv_disposable_mfa_isolated_user"
 const url = new URL(process.env.DATABASE_URL || "")
 const tenant = process.env.PASHLOC_HOSTED_FIXTURE_TENANT || ""
 const hash = process.env.PASHLOC_HOSTED_FIXTURE_HASH || ""
 if (process.env.RENDER_SERVICE_ID !== service || process.env.NODE_ENV !== "development" ||
     process.env.PASHLOC_ISOLATED_SCHEMA_INIT !== "disabled" ||
     process.env.PASHLOC_ISOLATED_CLAIM_API !== "enabled" ||
     !["postgres:", "postgresql:"].includes(url.protocol) ||
     ![dbHost, dbHost + ".internal"].includes(url.hostname) ||
     url.pathname !== "/" + dbName || decodeURIComponent(url.username) !== dbUser ||
     !/^pashloc-hosted-[0-9a-f]{12}$/.test(tenant) || !/^\$2b\$12\$[./A-Za-z0-9]{53}$/.test(hash)) {
  throw new Error("Disposable fixture target or configuration rejected")
 }
 const {pool}=await import("./db/db")
 const client=await pool.connect()
 try {
  await client.query("BEGIN")
  await client.query("SET LOCAL search_path TO public, pg_catalog")
  await client.query("SELECT pg_advisory_xact_lock(20261113,45)")
  const identity=await client.query("SELECT current_database() AS db, session_user AS role, EXISTS(SELECT 1 FROM pashloc_isolated_migration_control WHERE id=1) AS initialized")
  const row=identity.rows[0]
  if(row.db!==dbName || row.role!==dbUser || !row.initialized)throw new Error("Database identity rejected")
  const email=tenant+"@example.invalid"
  const t=await client.query("INSERT INTO tenants(slug) VALUES($1) ON CONFLICT(slug) DO NOTHING RETURNING id",[tenant])
  const id=t.rows[0]?.id??(await client.query("SELECT id FROM tenants WHERE slug=$1",[tenant])).rows[0]?.id
  if(!id)throw new Error("Fixture tenant missing")
  const existing=await client.query("SELECT id,email,password_hash,is_active FROM app_users WHERE tenant_id=$1",[id])
  let uid
  if(t.rowCount===1 && existing.rowCount===0) {
   uid=(await client.query("INSERT INTO app_users(tenant_id,email,password_hash,is_active) VALUES($1,$2,$3,true) RETURNING id",[id,email,hash])).rows[0]?.id
  } else if(existing.rowCount===1 && existing.rows[0].email===email && existing.rows[0].password_hash===hash && existing.rows[0].is_active) {
   uid=existing.rows[0].id
  }
  if(!uid)throw new Error("Refusing to modify an existing account")
  await client.query("COMMIT")
  console.log(JSON.stringify({event:"pashloc_hosted_fixture_verified",application:"Navigator",tenant_id:id,user_id:uid}))
 } catch {
  await client.query("ROLLBACK").catch(()=>{})
  throw new Error("Disposable fixture transaction failed")
 } finally {
  client.release()
 }
}

/** Dedicated disposable PashLoc integration service.
 * Intentionally contains NO production Navigator API routes, schedulers or JWT login.
 * Never deploy this entrypoint against a production database.
 */
import Fastify from "fastify"
import {registerPashLocIsolatedBrowserUi} from "./routes/pashlocIsolatedBrowserUi"
import {registerPashLocIsolatedRateLimits} from "./services/pashlocIsolatedRateLimit"
import {registerPashLocIsolatedFirstCode} from "./routes/pashlocIsolatedFirstCode"
import {registerPashLocIsolatedReturningLoginRoutes} from "./routes/pashlocIsolatedReturningLogin"
import {registerPashLocIsolatedClaimRoutes} from "./routes/pashlocIsolatedClaim"
import {registerPashLocIsolatedBrowserApprovalRoutes} from "./routes/pashlocIsolatedBrowserApproval"
import {registerPashLocIsolatedEnrollmentStartRoutes} from "./routes/pashlocIsolatedEnrollmentStart"
import {registerPashLocIsolatedSyntheticRedeemRoutes} from "./routes/pashlocIsolatedSyntheticRedeem"

export async function buildPashLocIsolatedServer() {
 if(!["development","test"].includes(process.env.NODE_ENV||"") ||
    process.env.PASHLOC_ISOLATED_CLAIM_API!=="enabled" ||
    process.env.PASHLOC_ISOLATED_SHARED_RATE_LIMITS_VERIFIED!=="yes")
  throw new Error("Isolated MFA prerequisites not met")
 const validOrigin=/^https:\/\/[a-z0-9.-]+(?::443)?$/i
 if(!validOrigin.test(process.env.PASHLOC_ISOLATED_PHONE_ORIGIN||"")||
    !validOrigin.test(process.env.PASHLOC_ISOLATED_NAVIGATOR_ORIGIN||"")||
    process.env.PASHLOC_ISOLATED_PHONE_ORIGIN===process.env.PASHLOC_ISOLATED_NAVIGATOR_ORIGIN)
  throw new Error("Approved isolated origin configuration is required")
 const app=Fastify({logger:true,bodyLimit:16*1024,disableRequestLogging:true})
 app.setErrorHandler((error,req,reply)=>{
  const code=(error as {statusCode?:number})?.statusCode
  const status=code && code>=400 && code<500 ? code : 500
  if(status===500) req.log.error({requestId:req.id},"Isolated MFA request failed")
  return reply.code(status).send({ok:false})
 })
 // No global wildcard CORS. Phone routes each enforce exact origin.
 registerPashLocIsolatedRateLimits(app)
 registerPashLocIsolatedBrowserUi(app)
 app.get("/healthz",async()=>({ok:true,service:"pashloc-isolated"}))
 await registerPashLocIsolatedEnrollmentStartRoutes(app)
 await registerPashLocIsolatedReturningLoginRoutes(app)
 await registerPashLocIsolatedFirstCode(app)
 await registerPashLocIsolatedClaimRoutes(app)
 await registerPashLocIsolatedBrowserApprovalRoutes(app)
 await registerPashLocIsolatedSyntheticRedeemRoutes(app)
 return app
}
if(process.argv[1]&&/pashlocIsolatedServer\.(?:ts|js)$/.test(process.argv[1])){
 if(process.env.PASHLOC_HOSTED_FIXTURE_PROVISION==="one-time") await provisionHostedFixture()
 if(process.env.PASHLOC_ISOLATED_SCHEMA_INIT==="explicit-one-time") {
  await import("../scripts/initializePashlocRenderIsolated")
 }
 const app=await buildPashLocIsolatedServer()
 await app.listen({host:"0.0.0.0",port:Number(process.env.PORT||8788)})
}
