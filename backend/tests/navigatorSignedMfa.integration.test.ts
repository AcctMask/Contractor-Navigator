import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createHash, randomBytes, webcrypto } from "node:crypto"
import { readFile } from "node:fs/promises"
import Fastify from "fastify"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { canonicalSignedApproval, type SignedApprovalContext } from "../src/services/pashlocSignedApprovalV1"

// Fail before importing the real database module if this is not disposable loopback QA.
assert.equal(process.env.NAVIGATOR_SIGNED_MFA_QA, "ephemeral")
assert.equal(process.env.NODE_ENV, "test")
const db = new URL(process.env.DATABASE_URL ?? "")
assert.equal(db.hostname, "127.0.0.1")
assert.equal(db.pathname, "/pashloc_qa_ephemeral")
assert.equal(process.env.JWT_SECRET, "synthetic-navigator-ci-only")

const { pool } = await import("../src/db/db")
const { registerAuthRoutes } = await import("../src/routes/auth")
const { registerAdminRoutes } = await import("../src/routes/admin")
const { registerCustomerRoutes } = await import("../src/routes/customers")
const { registerCalendarRoutes } = await import("../src/routes/calendar")
const inspectClaims = (token: string) => jwt.decode(token) as { sub: number; mfa_signed?: boolean }
const app = Fastify({ logger: false })
const desktop = "https://navigator.example.invalid"
const phone = "https://pashloc.example.invalid"
const password = "synthetic-password-qa-only"
const signed = "signed@example.invalid"
const staff = "staff@example.invalid"
const owner = "owner@example.invalid"
const slug = "qa-alpha"
const secondSlug = "qa-bravo"
const opaque = () => randomBytes(32).toString("base64url")
const hash = (v: string) => createHash("sha256").update(v).digest("hex")
let tenant: number, userId: number, staffId: number
let preMfaToken: string
const customers = new Map<string, number>()
let keys: CryptoKeyPair, deviceId: string
let approvedToken: string
const post = (path: string, payload: Record<string, unknown>, origin = desktop) =>
  app.inject({ method: "POST", url: path, payload, headers: { origin } })
const get = (url: string, token?: string) =>
  app.inject({ method: "GET", url, headers: token ? { authorization: "Bearer " + token } : {} })
const login = (email: string, origin = desktop) => post("/auth/" + slug + "/login", { email, password }, origin)
const api = "/auth/mfa/signed/"
const finish = (challenge: any, browserProof = challenge.browserProof) =>
  post(api + "complete", { reference: challenge.reference, browserProof })
const sign = async (data: Buffer, key = keys.privateKey) =>
  Buffer.from(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new Uint8Array(data))).toString("base64url")
const doDecision = async (context: SignedApprovalContext, key = keys.privateKey) =>
  post(api + "decision", { context, signature: await sign(canonicalSignedApproval(context), key) }, phone)

before(async () => {
  process.env.NAVIGATOR_MFA_SIGNED_ENABLED = "true"
  process.env.NAVIGATOR_MFA_BROWSER_ORIGIN = desktop
  process.env.NAVIGATOR_MFA_PHONE_ORIGIN = phone
  const schema = [
    `create table tenants (
      id bigint generated always as identity primary key,
      slug text not null unique, name text not null,
      created_at timestamptz not null default now()
    )`,
    `create table app_users (
      id bigint generated always as identity primary key,
      tenant_id bigint not null references tenants(id),
      email text not null, full_name text not null, password_hash text,
      mobile_phone text, role text not null, is_active boolean not null default true,
      preferred_language text, financials_authorized boolean not null default false,
      unique (tenant_id,email)
    )`,
    `create table customers (
      id bigint generated always as identity primary key,
      tenant_id bigint not null references tenants(id),
      full_name text not null, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
    `create table jobs (
      id bigint generated always as identity primary key,
      tenant_id bigint not null references tenants(id),
      customer_id bigint references customers(id),
      external_job_id text, stage text, job_type text, crm_flow_key text, crm_substatus text,
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
      tenant_id bigint, job_id bigint, kind text, meta jsonb, message text,
      created_at timestamptz not null default now()
    )`,
  ]

  for (const sql of schema) await pool.query(sql)
  await pool.query(await readFile(new URL("../sql/navigator_signed_mfa.sql", import.meta.url), "utf8"))
  for (const name of [slug, secondSlug]) {
    const { rows: [workspace] } = await pool.query("insert into tenants(slug,name) values($1,$1) returning id", [name])
    if (name === slug) tenant = Number(workspace.id)
    const { rows: [customer] } = await pool.query("insert into customers(tenant_id,full_name) values($1,$2) returning id",
      [workspace.id, name + "-customer"])
    customers.set(name, Number(customer.id))
    await pool.query("insert into jobs(tenant_id,customer_id,stage,external_job_id) values($1,$2,'lead',$3)",
      [workspace.id, customer.id, name + "-job"])
  }
  const passwordHash = await bcrypt.hash(password, 4)
  for (const email of [signed, staff, owner]) {
    const { rows: [actor] } = await pool.query(
      "insert into app_users(tenant_id,email,full_name,password_hash,role) values($1,$2,$2,$3,$4) returning id",
      [tenant, email, passwordHash, email === owner ? "platform_owner" : "staff"])
    if (email === signed) userId = Number(actor.id)
    else if (email === staff) staffId = Number(actor.id)
  }
  await registerAuthRoutes(app)
  await registerAdminRoutes(app)
  await registerCustomerRoutes(app)
  await registerCalendarRoutes(app)
  await pool.query("insert into calendar_events(tenant_id,title,start_time) values($1,'QA Calendar',now())", [tenant])
  await app.ready()
})

after(async () => { await app.close(); await pool.end() })

test("optional MFA preserves existing password login and scoped CRM", async () => {
  const response = await login(staff)
  assert.equal(response.statusCode, 200)
  assert.equal(inspectClaims(response.json().token).sub, staffId)
  assert.equal((await get("/auth/me", response.json().token)).statusCode, 200)
  assert.equal((await get("/admin/jobs/" + slug, response.json().token)).statusCode, 200)
  // Existing operational job reads are not an MFA authorization boundary.
})

test("self-service enrollment only issues grants for the configured Navigator app", async () => {
  const token = (await login(staff)).json().token
  const issue = (origin: string) => app.inject({
    method: "POST", url: "/auth/me/mfa/signed/enrollment",
    headers: { origin, authorization: "Bearer " + token },
    // The caller may not select the account or tenant that receives the grant.
    payload: { userId, tenantId: tenant + 1 },
  })
  process.env.NAVIGATOR_MFA_SIGNED_ENABLED = "false"
  try {
    const unavailable = await issue(desktop)
    assert.equal(unavailable.statusCode, 503)
    assert.equal(unavailable.json().oneTimeGrant, undefined)
  } finally {
    process.env.NAVIGATOR_MFA_SIGNED_ENABLED = "true"
  }
  assert.equal((await issue(phone)).statusCode, 403)
  const issued = await issue(desktop)
  assert.equal(issued.statusCode, 200)
  const { enrollmentLink, oneTimeGrant } = issued.json()
  const link = new URL(enrollmentLink)
  assert.equal(link.origin, phone)
  assert.match(link.hash, /^#navigator-register=[A-Za-z0-9_-]{43}$/)
  assert.ok(!enrollmentLink.includes(oneTimeGrant))
  const reference = link.hash.slice("#navigator-register=".length)
  const info = await post(api + "registration-info", { reference }, phone)
  assert.equal(info.statusCode, 200)
  assert.equal(info.json().userId, staffId)
  assert.equal(info.json().tenantId, tenant)
})

test("approved device binding, signed approval and one-time Navigator session", async () => {
  preMfaToken = (await login(signed)).json().token
  await pool.query("update app_users set navigator_mfa_required=true,navigator_mfa_epoch=1 where id=$1", [userId])
  assert.equal((await get("/auth/me", preMfaToken)).statusCode, 401)
  // The revoked session must fail on /auth/me and authenticated account mutations.
  const staleChange = await app.inject({method: "POST", url: "/auth/change-password",
    headers: { authorization: "Bearer " + preMfaToken }, payload: { currentPassword: password, newPassword: password + "-changed" } })
  assert.equal(staleChange.statusCode, 401)
  assert.deepEqual((await login(signed)).json(), { ok:true, mfa_required:true, enrollment_required:true })
  assert.equal((await login(signed, phone)).json().token, undefined)

  const reference = opaque(), grant = opaque()
  await pool.query(`insert into navigator_signed_enrollment_grants
    (reference,grant_hash,tenant_id,app_user_id,policy_epoch,expires_at)
    values($1,$2,$3,$4,1,clock_timestamp()+interval '5 minutes')`, [reference,hash(grant),tenant,userId])
  const infoResponse = await post(api + "registration-info", { reference }, phone)
  assert.equal(infoResponse.statusCode, 200)
  const info = infoResponse.json()
  assert.equal(info.environment, "production")
  assert.equal(info.userId, userId)
  keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign","verify"])
  assert.equal(keys.privateKey.extractable, false)
  const { kty, crv, x, y } = await webcrypto.subtle.exportKey("jwk", keys.publicKey)
  const publicJwk = { kty, crv, x, y }
  deviceId = opaque()
  const registrationProof = (environment: string) => Buffer.from(
    ["AA-PASHLOC-LOGIN-V1/REGISTER",environment,tenant,userId,reference,deviceId,info.expiresAt,x,y].join("\n"))
  const enrollment = { reference, grant, deviceId, publicJwk, signature: await sign(registrationProof("production")) }
  assert.equal((await post(api + "register", { ...enrollment, grant: opaque() }, phone)).statusCode, 404)
  assert.equal((await post(api + "register", { ...enrollment, signature: await sign(registrationProof("acceptance")) }, phone)).statusCode, 404)
  assert.equal((await post(api + "register", enrollment, phone)).statusCode, 200)
  assert.equal((await post(api + "register", enrollment, phone)).statusCode, 404)
  const bindingAudit = await pool.query(`select tenant_id,app_user_id,device_id,binding_method,
    enrollment_reference_hash from navigator_signed_device_binding_audit
    where tenant_id=$1 and app_user_id=$2`, [tenant,userId])
  assert.equal(bindingAudit.rowCount, 1)
  assert.equal(Number(bindingAudit.rows[0].tenant_id), tenant)
  assert.equal(Number(bindingAudit.rows[0].app_user_id), userId)
  assert.equal(bindingAudit.rows[0].device_id, deviceId)
  assert.equal(bindingAudit.rows[0].binding_method, "fresh_device_registration")
  assert.equal(bindingAudit.rows[0].enrollment_reference_hash, hash(reference))

  const response = await login(signed)
  const challenge = response.json()
  assert.equal(challenge.mfa_required, true)
  assert.equal(challenge.token, undefined)
  assert.equal(challenge.phoneUrl, phone + "/#navigator-sign=" + challenge.reference)
  assert.equal((await finish(challenge)).statusCode, 202)
  assert.equal((await finish(challenge, opaque())).statusCode, 404)
  assert.equal((await post(api + "challenge", { reference: challenge.reference, deviceId })).statusCode, 403)
  assert.equal((await post(api + "challenge", { reference: challenge.reference, deviceId: opaque() }, phone)).statusCode, 404)
  const { context } = (await post(api + "challenge", { reference: challenge.reference, deviceId }, phone)).json()
  const decision = { ...context, decision: "approve" } as SignedApprovalContext
  const other = await webcrypto.subtle.generateKey({ name:"ECDSA", namedCurve:"P-256" }, false, ["sign","verify"])
  assert.equal((await doDecision(decision, other.privateKey)).statusCode, 404)
  assert.equal((await doDecision({ ...decision, userId: staffId })).statusCode, 404)
  assert.equal((await doDecision({ ...decision, environment: "acceptance" })).statusCode, 404)
  assert.equal((await doDecision(decision)).statusCode, 200)
  assert.equal((await doDecision(decision)).statusCode, 404)
  const consumed = await Promise.all([finish(challenge), finish(challenge)])
  assert.deepEqual(consumed.map((result) => result.statusCode).sort(), [200,410])
  const approved = consumed.find((result) => result.statusCode === 200)!.json()
  assert.equal(approved.tenantSlug, slug)
  approvedToken = approved.token
  assert.equal(inspectClaims(approvedToken).mfa_signed, true)
  const identity = (await get("/auth/me", approvedToken)).json().user
  assert.equal(Number(identity.id), userId)
  assert.equal(Number(identity.tenant_id), tenant)
  const records = (await get("/admin/jobs/" + slug, approvedToken)).json().jobs
  assert.deepEqual(records.map((job: any) => [job.external_job_id, job.customer_name]), [[slug+"-job",slug+"-customer"]])
  // Cross-tenant authorization of operational job reads is outside this MFA-only change.
  assert.equal((await get("/auth/me")).statusCode, 401)
  const events = (await get("/calendar/" + slug + "/events", approvedToken)).json().events
  assert.deepEqual(events.map((event: any) => event.title), ["QA Calendar"])
})

test("denied, expired and unavailable challenges fail closed", async () => {
  const deny = (await login(signed)).json()
  const { context } = (await post(api + "challenge", { reference: deny.reference, deviceId }, phone)).json()
  assert.equal((await doDecision({ ...context, decision: "deny" })).statusCode, 200)
  assert.deepEqual((await finish(deny)).json(), { ok: true, state: "denied" })
  assert.equal((await doDecision({ ...context, decision: "approve" })).statusCode, 404)
  const expired = (await login(signed)).json()
  const expires = (await post(api + "challenge", { reference: expired.reference, deviceId }, phone)).json().context
  await pool.query("update navigator_signed_challenges set expires_at=clock_timestamp() where reference=$1", [expired.reference])
  assert.equal((await doDecision({ ...expires, decision: "approve" })).statusCode, 404)
  assert.equal((await finish(expired)).statusCode, 410)
  process.env.PASHLOC_ACCEPTANCE_ONLY = "yes"
  try {
    assert.deepEqual((await login(signed)).json(), { ok:true, mfa_required:true, unavailable:true })
    assert.equal((await finish(deny)).statusCode, 403)
    assert.ok((await login(staff)).json().token)
  } finally { delete process.env.PASHLOC_ACCEPTANCE_ONLY }
})

test("account-level recovery restores only the selected password login and invalidates its old session", async () => {
  const pending = (await login(signed)).json()
  const staffToken = (await login(staff)).json().token
  const query = await readFile(new URL("../sql/navigator_signed_mfa_recovery.sql", import.meta.url), "utf8")
  assert.equal((await pool.query(query, [userId,tenant,0])).rowCount, 0)
  assert.equal((await pool.query(query, [userId,tenant,1])).rowCount, 1)
  assert.equal((await get("/auth/me", approvedToken)).statusCode, 401)
  assert.equal((await get("/auth/me", preMfaToken)).statusCode, 401)
  assert.equal((await finish(pending)).statusCode, 404)
  const recovered = (await login(signed)).json().token
  assert.equal(inspectClaims(recovered).mfa_signed, false)
  assert.equal((await get("/auth/me", recovered)).statusCode, 200)
  assert.equal((await get("/auth/me", staffToken)).statusCode, 200)
})

test("existing platform owner can switch workspaces and return without issuing another session", async () => {
  const { token } = (await login(owner)).json()
  assert.ok(token)
  for (const workspace of [slug, secondSlug, slug]) {
    const response = await get("/admin/jobs/" + workspace, token)
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json().jobs.map((job: { external_job_id: string }) => job.external_job_id),
      [workspace + "-job"])
  }
})
