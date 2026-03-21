import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { randomBytes } from "crypto"
import { pool } from "../db/db"

type AppUser = {
  id: number
  tenant_id: number
  email: string
  full_name: string
  role: string
  is_active: boolean
}

const JWT_SECRET = process.env.JWT_SECRET || "contractor-autopilot-local-secret"

async function ensureAuthTables() {
  await pool.query(`
    create table if not exists app_users (
      id bigserial primary key,
      tenant_id bigint not null references tenants(id) on delete cascade,
      email text not null,
      full_name text not null,
      password_hash text not null,
      role text not null default 'staff',
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, email)
    )
  `)

  await pool.query(`
    create table if not exists user_invitations (
      id bigserial primary key,
      tenant_id bigint not null references tenants(id) on delete cascade,
      email text not null,
      full_name text not null,
      role text not null default 'staff',
      invite_token text not null unique,
      invited_by_user_id bigint null,
      accepted_at timestamptz null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    )
  `)

  await pool.query(`
    create index if not exists idx_user_invitations_tenant_email
    on user_invitations (tenant_id, lower(email))
  `)
}

export async function getTenantIdBySlug(slug: string): Promise<number> {
  const result = await pool.query(
    `select id from tenants where slug = $1 limit 1`,
    [slug]
  )

  if (!result.rowCount) {
    throw new Error(`Tenant not found: ${slug}`)
  }

  return Number(result.rows[0].id)
}

function signToken(user: AppUser) {
  return jwt.sign(
    {
      sub: user.id,
      tenant_id: user.tenant_id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  )
}

export function verifyToken(token: string) {
  return jwt.verify(token, JWT_SECRET) as {
    sub: number
    tenant_id: number
    email: string
    full_name: string
    role: string
    iat: number
    exp: number
  }
}

function cleanEmail(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

function cleanName(value: unknown) {
  return String(value || "").trim()
}

function cleanRole(value: unknown) {
  const raw = String(value || "staff").trim().toLowerCase()
  if (["admin", "sales", "manager", "staff"].includes(raw)) return raw
  return "staff"
}

export async function inviteUserByTenantSlug(
  tenantSlug: string,
  input: {
    email: string
    full_name: string
    role?: string
    invited_by_user_id?: number | null
  }
) {
  await ensureAuthTables()
  const tenantId = await getTenantIdBySlug(tenantSlug)

  const email = cleanEmail(input.email)
  const fullName = cleanName(input.full_name)
  const role = cleanRole(input.role)
  const invitedByUserId = input.invited_by_user_id || null

  if (!email) {
    throw new Error("Email is required")
  }

  if (!email.includes("@")) {
    throw new Error("Valid email is required")
  }

  if (!fullName) {
    throw new Error("Full name is required")
  }

  const existingUser = await pool.query(
    `
    select id, email, full_name, role
    from app_users
    where tenant_id = $1
      and lower(email) = $2
    limit 1
    `,
    [tenantId, email]
  )

  if (existingUser.rowCount) {
    throw new Error("A user with that email already exists")
  }

  const existingPendingInvite = await pool.query(
    `
    select id
    from user_invitations
    where tenant_id = $1
      and lower(email) = $2
      and accepted_at is null
      and expires_at > now()
    order by created_at desc
    limit 1
    `,
    [tenantId, email]
  )

  const inviteToken = randomBytes(24).toString("hex")

  if (existingPendingInvite.rowCount) {
    const result = await pool.query(
      `
      update user_invitations
      set
        full_name = $3,
        role = $4,
        invite_token = $5,
        invited_by_user_id = $6,
        expires_at = now() + interval '7 days'
      where id = $1
        and tenant_id = $2
      returning id, email, full_name, role, invite_token, accepted_at, expires_at, created_at
      `,
      [
        Number(existingPendingInvite.rows[0].id),
        tenantId,
        fullName,
        role,
        inviteToken,
        invitedByUserId,
      ]
    )

    return result.rows[0]
  }

  const result = await pool.query(
    `
    insert into user_invitations
      (tenant_id, email, full_name, role, invite_token, invited_by_user_id, expires_at)
    values
      ($1, $2, $3, $4, $5, $6, now() + interval '7 days')
    returning id, email, full_name, role, invite_token, accepted_at, expires_at, created_at
    `,
    [
      tenantId,
      email,
      fullName,
      role,
      inviteToken,
      invitedByUserId,
    ]
  )

  return result.rows[0]
}

export async function getInvitationByToken(inviteToken: string) {
  await ensureAuthTables()

  const result = await pool.query(
    `
    select
      i.id,
      i.tenant_id,
      t.slug as tenant_slug,
      i.email,
      i.full_name,
      i.role,
      i.invite_token,
      i.accepted_at,
      i.expires_at,
      i.created_at
    from user_invitations i
    join tenants t on t.id = i.tenant_id
    where i.invite_token = $1
    limit 1
    `,
    [inviteToken]
  )

  if (!result.rowCount) {
    return null
  }

  return result.rows[0]
}

export async function acceptInvitation(
  inviteToken: string,
  input: {
    password: string
  }
) {
  await ensureAuthTables()

  const invite = await getInvitationByToken(inviteToken)

  if (!invite) {
    throw new Error("Invitation not found")
  }

  if (invite.accepted_at) {
    throw new Error("Invitation already accepted")
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    throw new Error("Invitation expired")
  }

  const password = String(input.password || "").trim()
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters")
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const userResult = await pool.query(
    `
    insert into app_users
      (tenant_id, email, full_name, password_hash, role, is_active, created_at, updated_at)
    values
      ($1, lower($2), $3, $4, $5, true, now(), now())
    on conflict (tenant_id, email)
    do update set
      full_name = excluded.full_name,
      password_hash = excluded.password_hash,
      role = excluded.role,
      is_active = true,
      updated_at = now()
    returning id, tenant_id, email, full_name, role, is_active
    `,
    [
      invite.tenant_id,
      invite.email,
      invite.full_name,
      passwordHash,
      invite.role,
    ]
  )

  await pool.query(
    `
    update user_invitations
    set accepted_at = now()
    where id = $1
    `,
    [invite.id]
  )

  const user = userResult.rows[0] as AppUser
  const token = signToken(user)

  return {
    user,
    token,
    tenant_slug: invite.tenant_slug,
  }
}

export async function loginUserByTenantSlug(
  tenantSlug: string,
  input: {
    email: string
    password: string
  }
) {
  await ensureAuthTables()
  const tenantId = await getTenantIdBySlug(tenantSlug)

  const email = cleanEmail(input.email)
  const password = String(input.password || "")

  if (!email || !password) {
    throw new Error("Email and password are required")
  }

  const result = await pool.query(
    `
    select id, tenant_id, email, full_name, role, is_active, password_hash
    from app_users
    where tenant_id = $1
      and lower(email) = $2
    limit 1
    `,
    [tenantId, email]
  )

  if (!result.rowCount) {
    throw new Error("Invalid email or password")
  }

  const row = result.rows[0]

  if (!row.is_active) {
    throw new Error("User account is inactive")
  }

  const ok = await bcrypt.compare(password, row.password_hash)
  if (!ok) {
    throw new Error("Invalid email or password")
  }

  const user: AppUser = {
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    is_active: row.is_active,
  }

  const token = signToken(user)

  return {
    user,
    token,
  }
}

export async function getCurrentUserFromToken(token: string) {
  const decoded = verifyToken(token)

  const result = await pool.query(
    `
    select id, tenant_id, email, full_name, role, is_active
    from app_users
    where id = $1
    limit 1
    `,
    [decoded.sub]
  )

  if (!result.rowCount) {
    throw new Error("User not found")
  }

  return result.rows[0]
}

export async function listUsersByTenantSlug(tenantSlug: string) {
  await ensureAuthTables()
  const tenantId = await getTenantIdBySlug(tenantSlug)

  const result = await pool.query(
    `
    select id, email, full_name, role, is_active, created_at, updated_at
    from app_users
    where tenant_id = $1
    order by created_at desc, id desc
    `,
    [tenantId]
  )

  return result.rows
}

export async function listInvitationsByTenantSlug(tenantSlug: string) {
  await ensureAuthTables()
  const tenantId = await getTenantIdBySlug(tenantSlug)

  const result = await pool.query(
    `
    select id, email, full_name, role, invite_token, accepted_at, expires_at, created_at
    from user_invitations
    where tenant_id = $1
    order by created_at desc, id desc
    `,
    [tenantId]
  )

  return result.rows
}
