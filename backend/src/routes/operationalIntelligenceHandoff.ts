import type { FastifyInstance } from "fastify"
import { createHash, randomBytes, timingSafeEqual } from "crypto"
import { pool } from "../db/db"
import { getCurrentUserFromToken, isSignedOperationalToken } from "../services/authService"

// Reuses the FOM pattern: Navigator verifies a signed operational session,
// creates a short-lived single-use code, and the destination exchanges it
// server-to-server using the established AA activity gateway credential.
const ADMIN_ROLES = new Set(["platform_owner", "tenant_admin", "admin"])
const TTL_SECONDS = 120

function bearer(request: any): string {
  const value = String(request.headers.authorization || "")
  return value.startsWith("Bearer ") ? value.slice(7).trim() : ""
}

function sameSecret(a: string, b: string): boolean {
  if (!a || !b) return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function serviceAuthorized(request: any): boolean {
  const configured = String(process.env.AA_ACTIVITY_GATEWAY_SECRET || "").trim()
  const provided = String(request.headers["x-aa-activity-secret"] ||
    bearer(request) || "").trim()
  return sameSecret(provided, configured)
}

function hash(code: string) {
  return createHash("sha256").update(code).digest("hex")
}

async function ensureTables() {
  await pool.query(`
    create table if not exists operational_intelligence_access (
      navigator_user_id bigint primary key references app_users(id) on delete cascade,
      tenant_id bigint not null references tenants(id) on delete cascade,
      authorized boolean not null default false,
      changed_by bigint references app_users(id),
      updated_at timestamptz not null default now()
    )
  `)
  await pool.query(`
    create table if not exists operational_intelligence_handoffs (
      code_hash text primary key,
      navigator_user_id bigint not null,
      identity_tenant_id bigint not null,
      target_tenant_id bigint not null,
      target_tenant_slug text not null,
      expires_at timestamptz not null,
      consumed_at timestamptz
    )
  `)
}

async function activeAuthorizedUser(userId: number, identityTenantId: number) {
  const result = await pool.query(`
    select u.id, u.tenant_id, u.email, u.full_name, u.role,
           u.is_active, coalesce(a.authorized, false) as oim_authorized
    from app_users u
    left join operational_intelligence_access a
      on a.navigator_user_id = u.id and a.tenant_id = u.tenant_id
    where u.id = $1 and u.tenant_id = $2
    limit 1
  `, [userId, identityTenantId])
  const user = result.rows[0]
  return user && user.is_active && ADMIN_ROLES.has(String(user.role)) &&
    user.oim_authorized === true ? user : null
}

async function signedActor(request: any, reply: any) {
  const token = bearer(request)
  if (!token || !isSignedOperationalToken(token)) {
    reply.code(401).send({ ok: false, error: "Signed Navigator session required" })
    return null
  }
  const actor = await getCurrentUserFromToken(token).catch(() => null)
  if (!actor || !actor.is_active) {
    reply.code(401).send({ ok: false, error: "Navigator session not authorized" })
    return null
  }
  return actor
}

export async function registerOperationalIntelligenceHandoffRoutes(app: FastifyInstance) {
  await ensureTables()

  // Permission is independently granted; Financial Operations permission is NOT reused.
  app.get("/operational-intelligence/access", async (request: any, reply) => {
    const actor = await signedActor(request, reply)
    if (!actor) return
    const eligible = await activeAuthorizedUser(Number(actor.id), Number(actor.tenant_id))
    return { ok: true, authorized: Boolean(eligible), role: actor.role }
  })

  // Reuse Navigator's user-management authority and explicit target-tenant checks.
  app.get("/operational-intelligence/access/:tenantSlug/:userId", async (request: any, reply) => {
    const actor = await signedActor(request, reply)
    if (!actor) return
    if (!ADMIN_ROLES.has(String(actor.role))) return reply.code(403).send({ ok: false })
    const { tenantSlug, userId } = request.params as { tenantSlug: string; userId: string }
    const target = await pool.query(`
      select u.id, u.tenant_id, u.role, coalesce(a.authorized, false) as authorized
      from app_users u
      join tenants t on t.id = u.tenant_id
      left join operational_intelligence_access a on a.navigator_user_id = u.id
      where u.id = $1 and t.slug = $2
    `, [Number(userId), tenantSlug])
    if (!target.rowCount || (String(actor.role) !== "platform_owner" &&
        Number(actor.tenant_id) !== Number(target.rows[0].tenant_id))) {
      return reply.code(404).send({ ok: false })
    }
    return { ok: true, authorized: Boolean(target.rows[0].authorized), role: target.rows[0].role }
  })

  app.patch("/operational-intelligence/access/:tenantSlug/:userId", async (request: any, reply) => {
    const actor = await signedActor(request, reply)
    if (!actor) return
    if (!ADMIN_ROLES.has(String(actor.role))) return reply.code(403).send({ ok: false })
    const { tenantSlug, userId } = request.params as { tenantSlug: string; userId: string }
    const value = (request.body as any)?.authorized
    if (typeof value !== "boolean") return reply.code(400).send({ ok: false, error: "authorized must be boolean" })
    const target = await pool.query(`
      select u.id, u.tenant_id, u.role, u.is_active
      from app_users u join tenants t on t.id = u.tenant_id
      where u.id = $1 and t.slug = $2
    `, [Number(userId), tenantSlug])
    if (!target.rowCount) return reply.code(404).send({ ok: false })
    const user = target.rows[0]
    if ((String(actor.role) !== "platform_owner" && Number(actor.tenant_id) !== Number(user.tenant_id)) ||
        (user.role === "platform_owner" && actor.role !== "platform_owner")) {
      return reply.code(403).send({ ok: false })
    }
    // Only the corporate owner may self-authorize; tenant administrators
    // must receive their OIM grant from another authorized manager.
    if (Number(actor.id) === Number(user.id) && String(actor.role) !== "platform_owner") {
      return reply.code(403).send({ ok: false, error: "Self-authorization is not permitted" })
    }
    if (!user.is_active || !ADMIN_ROLES.has(String(user.role))) {
      return reply.code(403).send({ ok: false, error: "Only active administrators may access OIM" })
    }
    await pool.query(`
      insert into operational_intelligence_access
        (navigator_user_id, tenant_id, authorized, changed_by)
      values ($1, $2, $3, $4)
      on conflict (navigator_user_id) do update
      set authorized = excluded.authorized,
          changed_by = excluded.changed_by, updated_at = now()
    `, [Number(user.id), Number(user.tenant_id), value, Number(actor.id)])
    return { ok: true, authorized: value }
  })

  app.post("/operational-intelligence/handoff", async (request: any, reply) => {
    const actor = await signedActor(request, reply)
    if (!actor) return
    const eligible = await activeAuthorizedUser(Number(actor.id), Number(actor.tenant_id))
    if (!eligible) return reply.code(403).send({ ok: false, error: "Operational Intelligence access not authorized" })
    const requestedSlug = String((request.body as any)?.tenant_slug || "").trim()
    if (!requestedSlug) return reply.code(400).send({ ok: false, error: "Explicit tenant required" })
    const target = await pool.query("select id, slug from tenants where slug = $1 limit 1", [requestedSlug])
    if (!target.rowCount) return reply.code(404).send({ ok: false, error: "Tenant not found" })
    if (String(actor.role) !== "platform_owner" && Number(actor.tenant_id) !== Number(target.rows[0].id)) {
      return reply.code(403).send({ ok: false, error: "Tenant access denied" })
    }
    const code = randomBytes(32).toString("hex")
    await pool.query(`
      insert into operational_intelligence_handoffs
        (code_hash, navigator_user_id, identity_tenant_id,
         target_tenant_id, target_tenant_slug, expires_at)
      values ($1, $2, $3, $4, $5, now() + interval '120 seconds')
    `, [hash(code), Number(actor.id), Number(actor.tenant_id),
       Number(target.rows[0].id), requestedSlug])
    reply.header("Cache-Control", "no-store")
    return { ok: true, code, expires_in_seconds: TTL_SECONDS }
  })

  app.post("/integrations/ops-intel/handoff/exchange", async (request: any, reply) => {
    if (!serviceAuthorized(request)) return reply.code(401).send({ ok: false, error: "Authentication required" })
    const code = String((request.body as any)?.code || "").trim()
    if (!/^[a-f0-9]{64}$/.test(code)) return reply.code(400).send({ ok: false, error: "Invalid handoff code" })
    const result = await pool.query(`
      update operational_intelligence_handoffs set consumed_at = now()
      where code_hash = $1 and consumed_at is null and expires_at > now()
      returning navigator_user_id, identity_tenant_id, target_tenant_id, target_tenant_slug
    `, [hash(code)])
    if (!result.rowCount) return reply.code(401).send({ ok: false, error: "Handoff expired or used" })
    const handoff = result.rows[0]
    const user = await activeAuthorizedUser(Number(handoff.navigator_user_id), Number(handoff.identity_tenant_id))
    if (!user) return reply.code(403).send({ ok: false, error: "OIM access revoked" })
    if (String(user.role) !== "platform_owner" && Number(user.tenant_id) !== Number(handoff.target_tenant_id))
      return reply.code(403).send({ ok: false, error: "Tenant access denied" })
    reply.header("Cache-Control", "no-store")
    return { ok: true, identity: {
      navigator_user_id: Number(user.id),
      identity_tenant_id: Number(user.tenant_id),
      tenant_id: Number(handoff.target_tenant_id),
      tenant_slug: String(handoff.target_tenant_slug),
      email: String(user.email), full_name: String(user.full_name || ""),
      role: String(user.role), corporate: String(user.role) === "platform_owner"
    }}
  })

  // Revalidate authorization for OIM server requests, including after a grant is revoked.
  app.post("/integrations/ops-intel/handoff/authorize", async (request: any, reply) => {
    if (!serviceAuthorized(request)) return reply.code(401).send({ ok: false, error: "Authentication required" })
    const body = (request.body || {}) as any
    const userId = Number(body.navigator_user_id)
    const identityTenantId = Number(body.identity_tenant_id)
    const targetSlug = String(body.tenant_slug || "").trim()
    if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(identityTenantId) || !targetSlug)
      return reply.code(400).send({ ok: false, error: "Invalid identity or tenant" })
    const user = await activeAuthorizedUser(userId, identityTenantId)
    if (!user) return reply.code(403).send({ ok: false, authorized: false })
    const target = await pool.query("select id from tenants where slug = $1", [targetSlug])
    if (!target.rowCount || (String(user.role) !== "platform_owner" &&
      Number(user.tenant_id) !== Number(target.rows[0].id)))
      return reply.code(403).send({ ok: false, authorized: false })
    return { ok: true, authorized: true, role: user.role, tenant_slug: targetSlug }
  })
}
