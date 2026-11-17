/**
 * Additive tenant-directory and CRM read authorization integration check.
 * Creates exactly two synthetic tenants in an ephemeral GitHub Actions DB.
 * NEVER runs on production, the Chairman's acceptance DB, or a live service.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import Fastify from "fastify"
import { pool } from "../src/db/db"
import { registerPlatformProvisioningRoutes } from "../src/routes/platformProvisioning"
import { registerAdminRoutes } from "../src/routes/admin"
import { signToken } from "../src/services/authService"

test("an Owner sees two isolated test tenants; tenant staff cannot read the other tenant", async () => {
  assert.equal(process.env.PASHLOC_TENANT_QA_EPHEMERAL, "yes")
  assert.equal(process.env.NODE_ENV, "test")
  assert.equal(process.env.PASHLOC_DISPOSABLE_DB_TEST, "yes")
  assert.equal(new URL(process.env.DATABASE_URL ?? "").pathname, "/pashloc_qa_ephemeral")
  assert.equal(process.env.JWT_SECRET, "pashloc-isolated-qa-nonproduction-secret")

  const schema = [
    `create table tenants (
      id bigint generated always as identity primary key,
      slug text not null unique, name text not null,
      created_at timestamptz not null default now()
    )`,
    `create table app_users (
      id bigint generated always as identity primary key,
      tenant_id bigint not null references tenants(id),
      email text not null, full_name text not null,
      mobile_phone text, role text not null, is_active boolean not null default true,
      preferred_language text, financials_authorized boolean not null default false,
      pashloc_mfa_required boolean not null default false,
      pashloc_mfa_activated_at timestamptz
    )`,
    `create table tenant_company_dna (
      tenant_id bigint primary key references tenants(id),
      branding jsonb not null default '{}'::jsonb,
      workflow_defaults jsonb not null default '{}'::jsonb,
      status text not null default 'approved'
    )`,
    `create table tenant_provisioning_state (
      tenant_id bigint primary key references tenants(id),
      navigator_status text not null default 'ready',
      crm_status text not null default 'ready'
    )`,
    `create table customers (
      id bigint generated always as identity primary key,
      tenant_id bigint not null references tenants(id),
      full_name text not null
    )`,
    `create table jobs (
      id bigint generated always as identity primary key,
      tenant_id bigint not null references tenants(id),
      customer_id bigint references customers(id),
      external_job_id text, stage text, crm_flow_key text, crm_substatus text,
      bot_paused boolean, manual_owner text, address1 text, city text,
      state text, zip text, carrier text, claim_number text,
      wa_status text, estimate_status text, contract_status text,
      lead_source text, lead_source_detail text, marketing_campaign text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
    `create table crew_assignments (
      id bigint generated always as identity primary key,
      tenant_id bigint, job_id bigint, app_user_id bigint,
      status text, assigned_at timestamptz, crew_name text
    )`,
    `create table job_assets (
      id bigint generated always as identity primary key,
      tenant_id bigint, job_id bigint, asset_type text
    )`,
    `create table timeline_events (
      id bigint generated always as identity primary key,
      tenant_id bigint, job_id bigint, kind text, meta jsonb
    )`,
  ]
  for (const sql of schema) await pool.query(sql)

  const ids:number[] = []
  for (const [slug,name] of [
    ["pashloc-qa-alpha","QA Alpha Roofing"],
    ["pashloc-qa-bravo","QA Bravo Roofing"]
  ]) {
    const result=await pool.query("insert into tenants(slug,name) values($1,$2) returning id",[slug,name])
    const id=Number(result.rows[0].id)
    ids.push(id)
    await pool.query("insert into tenant_company_dna(tenant_id,branding) values($1,$2)",[id,JSON.stringify({business_display_name:name})])
    await pool.query("insert into tenant_provisioning_state(tenant_id) values($1)",[id])
    const customer=await pool.query("insert into customers(tenant_id,full_name) values($1,$2) returning id",[id,slug+" ONLY CUSTOMER"])
    await pool.query("insert into jobs(tenant_id,customer_id,stage,external_job_id) values($1,$2,'lead',$3)",
      [id,customer.rows[0].id,slug+"-EXCLUSIVE-RECORD"])
  }

  async function actor(tenantId:number, role:string, email:string) {
    const result=await pool.query(
      "insert into app_users(tenant_id,email,full_name,role) values($1,$2,$3,$4) returning *",
      [tenantId,email,"Isolated QA "+role,role])
    return signToken(result.rows[0],false)
  }
  const owner=await actor(ids[0],"platform_owner","qa-owner@example.invalid")
  const alphaStaff=await actor(ids[0],"staff","qa-staff-alpha@example.invalid")
  const bravoStaff=await actor(ids[1],"staff","qa-staff-bravo@example.invalid")
  const app=Fastify({logger:false})
  try {
    await registerPlatformProvisioningRoutes(app)
    await registerAdminRoutes(app)
    await app.ready()
    const get=(path:string,token:string)=>app.inject({method:"GET",url:path,
      headers:{authorization:"Bearer "+token}})

    const directory=await get("/platform/tenants",owner)
    assert.equal(directory.statusCode,200,directory.body)
    const listed=directory.json().tenants
    assert.deepEqual(listed.map((item:any)=>item.slug),["pashloc-qa-alpha","pashloc-qa-bravo"])
    assert.deepEqual(listed.map((item:any)=>item.display_name),["QA Alpha Roofing","QA Bravo Roofing"])

    const nonOwnerDirectory=await get("/platform/tenants",alphaStaff)
    assert.equal(nonOwnerDirectory.statusCode,403,nonOwnerDirectory.body)

    for(const slug of ["pashloc-qa-alpha","pashloc-qa-bravo"]){
      const response=await get("/admin/jobs/"+slug,owner)
      assert.equal(response.statusCode,200,response.body)
      const jobs=response.json().jobs
      assert.equal(jobs.length,1)
      assert.equal(jobs[0].external_job_id,slug+"-EXCLUSIVE-RECORD")
      assert.equal(response.json().tenant_id,ids[slug.endsWith("alpha")?0:1])
    }
    const denied=await get("/admin/jobs/pashloc-qa-bravo",alphaStaff)
    assert.equal(denied.statusCode,403,denied.body)
    assert.equal((await get("/admin/jobs/pashloc-qa-alpha",alphaStaff)).statusCode,200)
    assert.equal((await get("/admin/jobs/pashloc-qa-bravo",bravoStaff)).statusCode,200)
    assert.equal((await get("/admin/jobs/pashloc-qa-alpha",bravoStaff)).statusCode,403)
    assert.equal((await get("/platform/tenants","invalid.jwt.token")).statusCode,401)
  } finally {
    await app.close()
    await pool.end()
  }
})
