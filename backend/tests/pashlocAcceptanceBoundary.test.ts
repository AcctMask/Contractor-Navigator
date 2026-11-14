import "./pashlocAcceptanceRateLimit.test"
import test from "node:test"
import assert from "node:assert/strict"
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/pashloc_acceptance_disposable"
const { assertMfaAcceptanceEnvironment } = await import("../src/pashlocAcceptanceServer")

const valid = {
 PASHLOC_ACCEPTANCE_ONLY:"yes",
 PASHLOC_ACCEPTANCE_DATABASE_CONFIRMED:"yes",
 NODE_ENV:"development",
 DATABASE_URL:"postgresql://acceptance@disposable.internal/pashloc_acceptance_disposable",
 PASHLOC_ACCEPTANCE_DATABASE_NAME:"pashloc_acceptance_disposable",
 PASHLOC_NAVIGATOR_ENROLLMENT_ENABLED:"yes",
 PASHLOC_PHONE_CLAIM_ENABLED:"yes",
 PASHLOC_SHARED_RATE_LIMITS_VERIFIED:"yes",
 APP_BASE_URL:"https://navigator-acceptance.example.test",
 PASHLOC_PHONE_ORIGIN:"https://phone-acceptance.example.test"
} satisfies NodeJS.ProcessEnv

test("acceptance server rejects missing security controls and production databases",()=>{
 assert.doesNotThrow(()=>assertMfaAcceptanceEnvironment(valid))
 for(const key of ["PASHLOC_ACCEPTANCE_ONLY","PASHLOC_ACCEPTANCE_DATABASE_CONFIRMED",
  "PASHLOC_ACCEPTANCE_DATABASE_NAME","PASHLOC_NAVIGATOR_ENROLLMENT_ENABLED",
  "PASHLOC_PHONE_CLAIM_ENABLED","PASHLOC_SHARED_RATE_LIMITS_VERIFIED",
  "APP_BASE_URL","PASHLOC_PHONE_ORIGIN"] as const) {
   assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,[key]:""}),key)
 }
 for (const badOrigin of [
  "http://navigator-acceptance.example.test",
  "https://navigator-acceptance.example.test/path",
  "https://navigator-acceptance.example.test?mode=unsafe",
  "https://user:password@navigator-acceptance.example.test",
  "https://navigator-acceptance.example.test/#fragment"
 ]) {
  assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,APP_BASE_URL:badOrigin}),badOrigin)
 }
 // Exact origin comparison rejects prefix tricks at request time; a configured
 // syntactically valid hostname is not inherently invalid without a fixed allowlist.
 assert.doesNotThrow(()=>assertMfaAcceptanceEnvironment({...valid,APP_BASE_URL:"https://navigator-acceptance.example.test.evil.invalid"}))
 assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,PASHLOC_PHONE_ORIGIN:valid.APP_BASE_URL}))
 assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,NODE_ENV:"production"}))
 assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,DATABASE_URL:"postgresql://acceptance@prod.internal/navigator"}))
 assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,DATABASE_URL:"postgresql://acceptance@prod.internal/pashloc_acceptance_disposable_backup"}))
 assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,DATABASE_URL:"postgresql://acceptance@prod.internal/pashloc_acceptance_disposable",PASHLOC_ACCEPTANCE_DATABASE_NAME:"navigator"}))
})


test("CRM jobs and recent activity enforce JWT and tenant isolation with disposable fixtures", async () => {
 const { default: Fastify } = await import("fastify")
 const { pool } = await import("../src/db/db")
 const { registerAdminRoutes } = await import("../src/routes/admin")
 const { signToken } = await import("../src/services/authService")
 const jwt = (await import("jsonwebtoken")).default
 const originalQuery = pool.query
 const tenants: Record<string, number> = { "acceptance-a": 101, "acceptance-b": 202 }
 const users = [
  {id:11,tenant_id:101,email:"a@example.invalid",full_name:"A",role:"admin",is_active:true,financials_authorized:false},
  {id:22,tenant_id:202,email:"b@example.invalid",full_name:"B",role:"admin",is_active:true,financials_authorized:false},
  {id:33,tenant_id:101,email:"owner@example.invalid",full_name:"Owner",role:"platform_owner",is_active:true,financials_authorized:false},
 ]
 const queries: Array<{sql:string;params:any[]}> = []
 ;(pool as any).query = async (sql: string, params: any[] = []) => {
  const normalized = String(sql).replace(/\s+/g," ").toLowerCase()
  queries.push({sql:normalized,params})
  if (normalized.includes("select id from tenants where slug")) {
   const id = tenants[String(params[0])]
   return {rows:id?[{id}]:[],rowCount:id?1:0}
  }
  if (normalized.includes("from app_users") && normalized.includes("select id, tenant_id")) {
   const user = users.find(u=>u.id===Number(params[0])&&u.tenant_id===Number(params[1]))
   return {rows:user?[user]:[],rowCount:user?1:0}
  }
  if (normalized.includes("select pashloc_mfa_required")) return {rows:[{pashloc_mfa_required:false}],rowCount:1}
  if (normalized.includes("has_directory")) return {rows:[{has_directory:false}],rowCount:1}
  if (normalized.includes("from jobs j") && normalized.includes("has_active_subcontractor_assignment")) {
   const tenantId=Number(params[0])
   return {rows:[{id:tenantId*10,tenant_id:tenantId,customer_name:"Tenant "+tenantId}],rowCount:1}
  }
  if (normalized.includes("from timeline_events te") && normalized.includes("order by te.created_at")) {
   const tenantId=Number(params[0])
   return {rows:[{id:tenantId*10,kind:"manual_note",customer_name:"Tenant "+tenantId}],rowCount:1}
  }
  if (/^\s*(create|alter) table|^\s*create index|^\s*alter table/.test(normalized)) return {rows:[],rowCount:0}
  throw new Error("Unexpected test SQL: "+normalized.slice(0,140))
 }
 const app = Fastify()
 try {
  await registerAdminRoutes(app)
  await app.ready()
  const paths=["/admin/jobs/","/admin/recent-activity/"]
  const token=(user:typeof users[number])=>signToken(user,true)
  for (const pathPrefix of paths) {
   const call=(tenant:string,authorization?:string)=>app.inject({method:"GET",url:pathPrefix+tenant,headers:authorization?{authorization}:{} })
   assert.equal((await call("acceptance-a")).statusCode,401,"missing JWT")
   assert.equal((await call("acceptance-a","Bearer invalid")).statusCode,401,"invalid JWT")
   const expired=jwt.sign({sub:11,tenant_id:101,role:"admin",exp:1},process.env.JWT_SECRET||"contractor-autopilot-local-secret")
   assert.equal((await call("acceptance-a","Bearer "+expired)).statusCode,401,"expired JWT")
   const own=await call("acceptance-a","Bearer "+token(users[0]))
   assert.equal(own.statusCode,200,"own tenant: "+own.body+" SQL: "+JSON.stringify(queries.slice(-5)))
   assert.equal(own.json()[pathPrefix.includes("recent")?"rows":"jobs"][0].id,1010)
   assert.equal((await call("acceptance-b","Bearer "+token(users[0]))).statusCode,403,"cross tenant")
   const other=await call("acceptance-b","Bearer "+token(users[1]))
   assert.equal(other.statusCode,200,"other tenant own records")
   assert.equal(other.json()[pathPrefix.includes("recent")?"rows":"jobs"][0].id,2020)
   const owner=await call("acceptance-b","Bearer "+token(users[2]))
   assert.equal(owner.statusCode,200,"platform owner")
   assert.equal(owner.json()[pathPrefix.includes("recent")?"rows":"jobs"][0].id,2020)
  }
  const reads=queries.filter(q=>q.sql.includes("from jobs j")&&q.sql.includes("has_active_subcontractor_assignment")||q.sql.includes("from timeline_events te")&&q.sql.includes("order by te.created_at"))
  assert.equal(reads.length,6,"only authorized reads execute")
  assert.ok(reads.every(q=>[101,202].includes(Number(q.params[0]))),"every CRM read is tenant scoped")
 } finally {
  ;(pool as any).query=originalQuery
  await app.close()
 }
})


test("acceptance startup is read-only; calendar GET authenticates and isolates tenants; writes and unrelated routes denied", async () => {
 const { pool } = await import("../src/db/db")
 const { buildMfaAcceptanceServer } = await import("../src/pashlocAcceptanceServer")
 const { signToken } = await import("../src/services/authService")
 const jwt = (await import("jsonwebtoken")).default
 const originalQuery=pool.query
 const oldEnv={...process.env}
 Object.assign(process.env,valid)
 const users=[
  {id:11,tenant_id:101,email:"a@example.invalid",full_name:"A",role:"admin",is_active:true,financials_authorized:false},
  {id:22,tenant_id:202,email:"b@example.invalid",full_name:"B",role:"admin",is_active:true,financials_authorized:false},
  {id:33,tenant_id:101,email:"owner@example.invalid",full_name:"Owner",role:"platform_owner",is_active:true,financials_authorized:false}
 ]
 const sqlSeen:Array<{sql:string,params:any[]}>=[]
 ;(pool as any).query=async (sql:string,params:any[]=[]) => {
  const normalized=String(sql).replace(/\s+/g," ").trim().toLowerCase()
  sqlSeen.push({sql:normalized,params})
  if(normalized.includes("to_regclass")) return {rows:[{
   tenants:true,users:true,enrollments:true,challenges:true,pairings:true,
   claim_nonces:true,restricted_sessions:true,request_limits:true,
   default_off_column:true,genuine_envelope_column:true
  }],rowCount:1}
  if(normalized.includes("select id from tenants where slug")) {
   const id=({"acceptance-a":101,"acceptance-b":202} as Record<string,number>)[String(params[0])]
   return {rows:id?[{id}]:[],rowCount:id?1:0}
  }
  if(normalized.includes("from app_users") && normalized.includes("select id, tenant_id")) {
   const u=users.find(u=>u.id===Number(params[0])&&u.tenant_id===Number(params[1]))
   return {rows:u?[u]:[],rowCount:u?1:0}
  }
  if(normalized.includes("select pashloc_mfa_required")) return {rows:[{pashloc_mfa_required:false}],rowCount:1}
  if(normalized.includes("from calendar_events ce") && normalized.includes("where ce.tenant_id = $1")) {
   const id=Number(params[0])
   return {rows:[{id:id*10,tenant_id:id,title:"Tenant "+id}],rowCount:1}
  }
  throw Error("Unexpected acceptance SQL: "+normalized.slice(0,140))
 }
 let app:any
 try {
  app=await buildMfaAcceptanceServer()
  assert.ok(sqlSeen.length>0,"startup checks schema")
  assert.ok(sqlSeen.every(q=>q.sql.startsWith("select")),"startup must execute SELECT only")
  const call=(tenant:string,authorization?:string)=>app.inject({method:"GET",url:"/calendar/"+tenant+"/events",headers:authorization?{authorization}:{}})
  const token=(u:typeof users[number])=>"Bearer "+signToken(u,true)
  assert.equal((await call("acceptance-a")).statusCode,401)
  assert.equal((await call("acceptance-a","Bearer invalid")).statusCode,401)
  const expired=jwt.sign({sub:11,tenant_id:101,role:"admin",exp:1},process.env.JWT_SECRET||"contractor-autopilot-local-secret")
  assert.equal((await call("acceptance-a","Bearer "+expired)).statusCode,401)
  const own=await call("acceptance-a",token(users[0]))
  assert.equal(own.statusCode,200,"own calendar: "+own.body)
  assert.equal(own.json().events[0].id,1010)
  assert.equal((await call("acceptance-b",token(users[0]))).statusCode,403)
  const other=await call("acceptance-b",token(users[1]))
  assert.equal(other.statusCode,200,"second tenant: "+other.body)
  assert.equal(other.json().events[0].id,2020)
  const owner=await call("acceptance-b",token(users[2]))
  assert.equal(owner.statusCode,200,"platform owner: "+owner.body)
  assert.equal(owner.json().events[0].id,2020)
  const forbidden=[
   ["POST","/admin/jobs/acceptance-a"],
   ["DELETE","/admin/jobs/acceptance-a"],
   ["POST","/calendar/acceptance-a/events"],
   ["PUT","/calendar/acceptance-a/events/1"],
   ["DELETE","/calendar/acceptance-a/events/1"],
   ["GET","/admin/unknown/acceptance-a"],
   ["GET","/platform/tenants"],
   ["GET","/admin/jobs/acceptance-a/123"],
   ["GET","/auth/acceptance-a/login"]
  ] as const
  for(const [method,url] of forbidden){
   const response=await app.inject({method,url})
   assert.equal(response.statusCode,404,method+" "+url)
  }
  assert.equal((await app.inject({method:"GET",url:"/healthz"})).statusCode,200)
  assert.ok(sqlSeen.every(q=>q.sql.startsWith("select")),"acceptance startup and calendar requests never write schema or records")
  const reads=sqlSeen.filter(q=>q.sql.includes("from calendar_events ce"))
  assert.equal(reads.length,3,"only three authorized calendar reads")
  assert.deepEqual(reads.map(q=>Number(q.params[0])),[101,202,202],"tenant-bound calendar queries")
 } finally {
  if(app) await app.close()
  ;(pool as any).query=originalQuery
  for(const key of Object.keys(process.env)) if(!(key in oldEnv)) delete process.env[key]
  Object.assign(process.env,oldEnv)
 }
})
