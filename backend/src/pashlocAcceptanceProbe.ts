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
    const tenantColumns = await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='tenants' order by ordinal_position")
    const tenantColumnNames = tenantColumns.rows.map((r:{column_name:string})=>r.column_name)
    console.log("PASHLOC_DISPOSABLE_TENANT_COLUMNS",JSON.stringify(tenantColumnNames))
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
  if (process.env.PASHLOC_ACCEPTANCE_APPLY_CRM_SCHEMA === "yes") {
    await import("./pashlocAcceptanceCrmSchema")
  }
  if (process.env.PASHLOC_ACCEPTANCE_APPLY_TENANT_COMPAT === "yes") {
    await import("./pashlocAcceptanceTenantCompatibility")
  }
  if (process.env.PASHLOC_ACCEPTANCE_APPLY_SCHEMA === "yes") {
    await import("./pashlocAcceptanceMigration")
  }
  if (process.env.PASHLOC_ACCEPTANCE_VERIFY_SHARED_LIMITS === "yes") {
    await import("./pashlocAcceptanceRateLimitProof")
  }
  const res = await app.inject({ method: "GET", url: "/healthz" })
  console.log("PASHLOC_ACCEPTANCE_DB_INSPECTION", res.body)
  if (res.statusCode !== 200) throw Error("Private disposable database verification failed")
  if (process.env.PASHLOC_ACCEPTANCE_BOOTSTRAP_ACCOUNT === "yes") {
    await import("./pashlocAcceptanceAccountBootstrap")
  }
  if (process.env.PASHLOC_CHAIRMAN_PROVISION === "yes" || process.env.PASHLOC_CHAIRMAN_SETUP_ISSUE === "yes") {
    const {provisionChairmanAcceptanceIdentity}=await import("./pashlocAcceptanceChairmanIdentity")
    await provisionChairmanAcceptanceIdentity()
  }
  if (process.env.PASHLOC_CHAIRMAN_SETUP_ISSUE === "yes") {
    const {issueChairmanPasswordSetup}=await import("./pashlocAcceptanceChairmanSetup")
    await issueChairmanPasswordSetup()
    console.log("PASHLOC_CHAIRMAN_SETUP_INVITATION_DELIVERY_ACCEPTED")
  }
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
    if (process.env.PASHLOC_CHAIRMAN_PROVISION === "yes") {
      const chairman = await pool.query(`select u.id,u.is_active,u.pashloc_mfa_required,t.slug,
        (select count(*)::int from pashloc_mfa_enrollments e where e.app_user_id=u.id) as enrollments
        from app_users u join tenants t on t.id=u.tenant_id
        where t.slug=$1 and lower(u.email)=$2`,
        ["pashloc-genuine-acceptance-20261114","steve@g2groofing.com"])
      if(chairman.rowCount!==1||!chairman.rows[0].is_active||
         chairman.rows[0].pashloc_mfa_required!==true||
         chairman.rows[0].enrollments!==0) throw Error("Chairman isolated identity verification failed")
      console.log("PASHLOC_CHAIRMAN_IDENTITY_VERIFIED",JSON.stringify({isolated:true,tenant_bound:true,mfa_required:true,enrollment_conflicts:0}))
      const invalid = await genuine.inject({method:"POST",url:"/auth/acceptance/password-setup/validate",
        headers:{origin:process.env.APP_BASE_URL!,"content-type":"application/json"},
        payload:{token:"0".repeat(64)}})
      if(invalid.statusCode!==200||JSON.parse(invalid.body).ok!==false)throw Error("Invalid invitation accepted")
      const rejectedOrigin=await genuine.inject({method:"POST",url:"/auth/acceptance/password-setup",
        headers:{origin:"https://untrusted.invalid","content-type":"application/json"},
        payload:{token:"0".repeat(64),password:"NotARealPassword123!"}})
      if(rejectedOrigin.statusCode!==403)throw Error("Unauthorized invitation origin accepted")
      const unauth=await genuine.inject({method:"GET",url:"/auth/me"})
      if(unauth.statusCode!==401)throw Error("CRM session bypass")
      console.log("PASHLOC_CHAIRMAN_SETUP_NEGATIVE_TESTS",JSON.stringify({invalid_token:"PASS",origin_rejection:"PASS",unauthenticated_crm:"PASS"}))
    }
    // Test-only signed token is used solely inside Fastify.inject; never returned to a client.
    // This proves CRM read handlers, not a completed PashLoc device authentication.
    const acceptance = await pool.query(
      "select u.id,u.tenant_id,u.email,u.full_name,u.role,u.is_active,u.financials_authorized from app_users u join tenants t on t.id=u.tenant_id where t.slug=$1 and lower(u.email)=$2 limit 1",
      ["pashloc-genuine-acceptance-20261114","navigator-acceptance@example.invalid"]
    )
    if(acceptance.rowCount!==1||acceptance.rows[0].is_active!==true)
      throw Error("Disposable acceptance user unavailable")
    const { signToken } = await import("./services/authService")
    const token = signToken(acceptance.rows[0],true)
    const authorizedPaths=[
      "/auth/me",
      "/platform/company-dna-runtime/pashloc-genuine-acceptance-20261114",
      "/admin/jobs/pashloc-genuine-acceptance-20261114?limit=5000",
      "/calendar/pashloc-genuine-acceptance-20261114/events",
      "/admin/recent-activity/pashloc-genuine-acceptance-20261114?limit=10"
    ]
    for(const path of authorizedPaths){
      console.log("PASHLOC_CRM_READ_START",JSON.stringify({path}))
      const response=await Promise.race([genuine.inject({method:"GET",url:path,headers:{authorization:"Bearer "+token}}),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error("CRM read exceeded 12s: "+path)),12000))])
      console.log("PASHLOC_CRM_AUTHORIZED_READ",JSON.stringify({path,status:response.statusCode,passed:response.statusCode===200}))
      if(response.statusCode!==200) throw Error("Disposable authenticated CRM read failed: "+path)
    }
    if (process.env.PASHLOC_ACCEPTANCE_EXECUTE_PROTOCOL === "yes") {
      const diag=await pool.query(`select e.status, e.created_at,
        p.expires_at, p.credential_recovery_expires_at,
        (p.expires_at>now()) as pairing_active,
        (p.credential_recovery_expires_at>now()) as recovery_active
        from pashloc_mfa_enrollments e
        join app_users u on u.id=e.app_user_id and u.tenant_id=e.tenant_id
        join tenants t on t.id=u.tenant_id
        left join pashloc_mfa_pairings p on p.id=e.delivery_pairing_id
        where t.slug=$1 and lower(u.email)=$2`,
        ["pashloc-genuine-acceptance-20261114","navigator-acceptance@example.invalid"])
      console.log("PASHLOC_ACCEPTANCE_ENROLLMENT_LIFECYCLE",JSON.stringify({
        count:diag.rowCount,states:diag.rows.map((r:any)=>({
          status:r.status,pairing_active:r.pairing_active,recovery_active:r.recovery_active
        }))
      }))

      const { executeDisposableMfaAcceptance } = await import("./pashlocAcceptanceProtocolRunner")
      await executeDisposableMfaAcceptance(genuine)
    }
    await genuine.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 10000) })
    console.log("PASHLOC_GENUINE_ACCEPTANCE_LISTENING")
  } else {
    await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 10000) })
  }
})().catch(error => { console.error(error); process.exit(1) })
