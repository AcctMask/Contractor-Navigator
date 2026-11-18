import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createHash, randomBytes, webcrypto } from "node:crypto"
import { readFile } from "node:fs/promises"
import Fastify from "fastify"
import bcrypt from "bcryptjs"
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
const { verifyToken } = await import("../src/services/authService")
const app = Fastify({ logger: false })
const desktop = "https://navigator.example.invalid"
const phone = "https://pashloc.example.invalid"
const password = "synthetic-password-qa-only"
const signed = "signed@example.invalid"
const staff = "staff@example.invalid"
const slug = "qa-alpha"
const secondSlug = "qa-bravo"
const opaque = () => randomBytes(32).toString("base64url")
const hash = (v: string) => createHash("sha256").update(v).digest("hex")
let tenant: number, userId: number, staffId: number
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
  for (const email of [signed, staff]) {
    const { rows: [actor] } = await pool.query(
      "insert into app_users(tenant_id,email,full_name,password_hash,role) values($1,$2,$2,$3,'staff') returning id",
      [tenant, email, passwordHash])
    if (email === signed) userId = Number(actor.id)
    else staffId = Number(actor.id)
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
  assert.equal(verifyToken(response.json().token).sub, staffId)
  assert.equal((await get("/auth/me", response.json().token)).statusCode, 200)
  assert.equal((await get("/admin/jobs/" + slug, response.json().token)).statusCode, 200)
  assert.equal((await get("/admin/jobs/" + secondSlug, response.json().token)).statusCode, 403)
})

test("approved device binding, signed approval and one-time Navigator session", async () => {
  const oldToken = (await login(signed)).json().token
  await pool.query("update app_users set navigator_mfa_required=true,navigator_mfa_epoch=1 where id=$1", [userId])
  assert.equal((await get("/auth/me", oldToken)).statusCode, 401)
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
  approvedToken = consumed.find((result) => result.statusCode === 200)!.json().token
  assert.equal(verifyToken(approvedToken).mfa_signed, true)
  const identity = (await get("/auth/me", approvedToken)).json().user
  assert.equal(Number(identity.id), userId)
  assert.equal(Number(identity.tenant_id), tenant)
  const records = (await get("/admin/jobs/" + slug, approvedToken)).json().jobs
  assert.deepEqual(records.map((job: any) => [job.external_job_id, job.customer_name]), [[slug+"-job",slug+"-customer"]])
  assert.equal((await get("/admin/jobs/" + secondSlug, approvedToken)).statusCode, 403)
  assert.equal((await get("/admin/jobs/" + slug)).statusCode, 401)
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
  assert.equal((await finish(pending)).statusCode, 404)
  const recovered = (await login(signed)).json().token
  assert.equal(verifyToken(recovered).mfa_signed, false)
  assert.equal((await get("/auth/me", recovered)).statusCode, 200)
  assert.equal((await get("/auth/me", staffToken)).statusCode, 200)
})

test("customer-facing reports, timeline and scheduled reads reject unauthenticated and foreign tenants", async () => {
  const staffToken = (await login(staff)).json().token
  for (const route of ["/admin/timeline/", "/admin/scheduled/", "/admin/reports/"]) {
    assert.equal((await get(route + slug)).statusCode, 401, route + " requires login")
    assert.equal((await get(route + secondSlug, staffToken)).statusCode, 403, route + " denies other tenant")
  }
})

test("customer lists and individual histories stay within the authorized workspace", async () => {
  const token = (await login(staff)).json().token
  const list = "/admin/customers/"
  const history = (name: string, record: string) =>
    "/admin/customer/" + name + "/" + customers.get(record) + "/history"
  assert.equal((await get(list + slug)).statusCode, 401)
  assert.equal((await get(history(slug, slug))).statusCode, 401)
  assert.equal((await get(list + secondSlug, token)).statusCode, 403)
  assert.equal((await get(history(secondSlug, secondSlug), token)).statusCode, 403)
  assert.equal((await get(history(slug, secondSlug), token)).statusCode, 404)
  const visible = await get(list + slug, token)
  assert.equal(visible.statusCode, 200)
  assert.deepEqual(visible.json().items.map((record: { full_name: string }) => record.full_name), [slug+"-customer"])
  const record = await get(history(slug, slug), token)
  assert.equal(record.statusCode, 200)
  assert.equal(record.json().customer.full_name, slug+"-customer")
  assert.deepEqual(record.json().jobs.map((job: { external_job_id: string }) => job.external_job_id), [slug+"-job"])
})
