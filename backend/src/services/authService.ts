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
  financials_authorized: boolean
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
      financials_authorized boolean not null default false,
      deactivated_at timestamptz null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, email)
    )
  `)

  await pool.query(`
    alter table app_users
      add column if not exists deactivated_at timestamptz null
  `)

  await pool.query(`
    alter table app_users
      add column if not exists financials_authorized boolean not null default false
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
      created_at timestamptz not null default now(),
      invite_email_sent_at timestamptz null,
      tenant_send_notified_at timestamptz null,
      invitee_acceptance_notified_at timestamptz null,
      tenant_acceptance_notified_at timestamptz null
    )
  `)

  await pool.query(`
    alter table user_invitations
      add column if not exists invite_email_sent_at timestamptz null,
      add column if not exists tenant_send_notified_at timestamptz null,
      add column if not exists invitee_acceptance_notified_at timestamptz null,
      add column if not exists tenant_acceptance_notified_at timestamptz null
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
  if (["admin", "sales", "manager", "staff", "subcontractor"].includes(raw)) return raw
  return "staff"
}

async function logUserInvitationActivity(
  tenantId: number,
  kind: "user_invitation_sent" | "user_invitation_accepted",
  message: string,
  meta: Record<string, unknown>
) {
  try {
    await pool.query(
      `
      insert into timeline_events
        (tenant_id, job_id, kind, message, meta, created_at)
      values
        ($1, null, $2, $3, $4::jsonb, now())
      `,
      [
        tenantId,
        kind,
        message,
        JSON.stringify(meta),
      ]
    )
  } catch (error) {
    console.error(
      "User invitation activity logging failed",
      error
    )
  }
}

async function queueUserInvitationExpiration(
  invitation: {
    id: number
    expires_at: string
  },
  tenantId: number
) {
  await pool.query(
    `
    update scheduled_actions
    set
      status = 'cancelled',
      updated_at = now()
    where tenant_id = $1
      and action_key = 'user_invitation_expiration'
      and status = 'pending'
      and payload->>'invitation_id' = $2
    `,
    [
      tenantId,
      String(invitation.id),
    ]
  )

  await pool.query(
    `
    insert into scheduled_actions
      (
        tenant_id,
        job_id,
        action_key,
        run_at,
        status,
        payload,
        created_at,
        updated_at
      )
    values
      (
        $1,
        null,
        'user_invitation_expiration',
        $2::timestamptz,
        'pending',
        $3::jsonb,
        now(),
        now()
      )
    `,
    [
      tenantId,
      invitation.expires_at,
      JSON.stringify({
        invitation_id:
          invitation.id,
      }),
    ]
  )
}

async function cancelUserInvitationExpiration(
  invitationId: number,
  tenantId: number
) {
  await pool.query(
    `
    update scheduled_actions
    set
      status = 'cancelled',
      updated_at = now()
    where tenant_id = $1
      and action_key = 'user_invitation_expiration'
      and status = 'pending'
      and payload->>'invitation_id' = $2
    `,
    [
      tenantId,
      String(invitationId),
    ]
  )
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
        expires_at = now() + interval '30 days',
        invite_email_sent_at = null,
        tenant_send_notified_at = null,
        invitee_acceptance_notified_at = null,
        tenant_acceptance_notified_at = null
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

    const invite = result.rows[0]

    await queueUserInvitationExpiration(
      invite,
      Number(tenantId)
    )

    return invite
  }

  const result = await pool.query(
    `
    insert into user_invitations
      (tenant_id, email, full_name, role, invite_token, invited_by_user_id, expires_at)
    values
      ($1, $2, $3, $4, $5, $6, now() + interval '30 days')
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

  const invite = result.rows[0]

  await queueUserInvitationExpiration(
    invite,
    Number(tenantId)
  )

  return invite
}

export async function getAppUserById(
  userId: number | null | undefined
) {
  if (!userId) return null

  await ensureAuthTables()

  const result = await pool.query(
    `
    select
      id,
      tenant_id,
      email,
      full_name,
      role,
      is_active
    from app_users
    where id = $1
    limit 1
    `,
    [userId]
  )

  return result.rows[0] || null
}

export async function recordUserInvitationEmailSent(
  invitationId: number,
  tenantId: number
) {
  await ensureAuthTables()

  const result = await pool.query(
    `
    update user_invitations
    set invite_email_sent_at = now()
    where id = $1
      and tenant_id = $2
    returning
      id,
      email,
      full_name,
      role,
      invited_by_user_id,
      invite_email_sent_at
    `,
    [
      invitationId,
      tenantId,
    ]
  )

  const invitation =
    result.rows[0] || null

  if (invitation) {
    await logUserInvitationActivity(
      tenantId,
      "user_invitation_sent",
      `User invitation emailed to ${invitation.full_name}`,
      {
        invitation_id:
          invitation.id,
        full_name:
          invitation.full_name,
        email:
          invitation.email,
        role:
          invitation.role,
        invited_by_user_id:
          invitation.invited_by_user_id ||
          null,
        delivery:
          "resend_accepted",
      }
    )
  }

  return invitation
}

export async function markTenantSendNotified(
  invitationId: number,
  tenantId: number
) {
  await ensureAuthTables()

  await pool.query(
    `
    update user_invitations
    set tenant_send_notified_at = now()
    where id = $1
      and tenant_id = $2
    `,
    [
      invitationId,
      tenantId,
    ]
  )
}

export async function markInviteeAcceptanceNotified(
  invitationId: number,
  tenantId: number
) {
  await ensureAuthTables()

  await pool.query(
    `
    update user_invitations
    set invitee_acceptance_notified_at = now()
    where id = $1
      and tenant_id = $2
    `,
    [
      invitationId,
      tenantId,
    ]
  )
}

export async function markTenantAcceptanceNotified(
  invitationId: number,
  tenantId: number
) {
  await ensureAuthTables()

  await pool.query(
    `
    update user_invitations
    set tenant_acceptance_notified_at = now()
    where id = $1
      and tenant_id = $2
    `,
    [
      invitationId,
      tenantId,
    ]
  )
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
      i.invited_by_user_id,
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
      deactivated_at = null,
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

  await cancelUserInvitationExpiration(
    Number(invite.id),
    Number(invite.tenant_id)
  )

  const user = userResult.rows[0] as AppUser

  await logUserInvitationActivity(
    Number(invite.tenant_id),
    "user_invitation_accepted",
    `${invite.full_name} accepted user invitation`,
    {
      invitation_id: invite.id,
      app_user_id: user.id,
      full_name: invite.full_name,
      email: invite.email,
      role: invite.role,
    }
  )

  const token = signToken(user)

  return {
    user,
    token,
    tenant_slug: invite.tenant_slug,
    invitation: {
      id: invite.id,
      tenant_id: invite.tenant_id,
      email: invite.email,
      full_name: invite.full_name,
      role: invite.role,
      invited_by_user_id: invite.invited_by_user_id || null,
      accepted_at: invite.accepted_at,
      expires_at: invite.expires_at,
    },
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
    select
      id,
      email,
      full_name,
      role,
      is_active,
      financials_authorized,
      deactivated_at,
      created_at,
      updated_at
    from app_users
    where tenant_id = $1
    order by
      is_active desc,
      created_at desc,
      id desc
    `,
    [tenantId]
  )

  return result.rows
}

type ManagedUserActor = {
  id: number
  tenant_id: number
  email: string
  full_name?: string | null
  role: string
}

const MANAGED_ASSIGNABLE_ROLES = [
  "admin",
  "sales",
  "manager",
  "staff",
  "subcontractor",
]

function normalizeManagedRole(value: unknown) {
  const role =
    String(value || "")
      .trim()
      .toLowerCase()

  if (!MANAGED_ASSIGNABLE_ROLES.includes(role)) {
    throw new Error("Invalid user role")
  }

  return role
}

async function logUserManagementActivity(
  tenantId: number,
  kind:
    | "user_role_changed"
    | "user_password_reset"
    | "user_deactivated"
    | "user_financials_authorization_changed",
  message: string,
  meta: Record<string, unknown>
) {
  try {
    await pool.query(
      `
      insert into timeline_events
        (
          tenant_id,
          job_id,
          kind,
          message,
          meta,
          created_at
        )
      values
        (
          $1,
          null,
          $2,
          $3,
          $4::jsonb,
          now()
        )
      `,
      [
        tenantId,
        kind,
        message,
        JSON.stringify(meta),
      ]
    )
  } catch (error) {
    console.error(
      "User management activity logging failed",
      error
    )
  }
}

async function getManagedUser(
  tenantId: number,
  userId: number
) {
  const result =
    await pool.query(
      `
      select
        id,
        tenant_id,
        email,
        full_name,
        role,
        is_active,
        financials_authorized,
        deactivated_at,
        created_at,
        updated_at
      from app_users
      where tenant_id = $1
        and id = $2
      limit 1
      `,
      [
        tenantId,
        userId,
      ]
    )

  if (!result.rowCount) {
    throw new Error("User not found")
  }

  return result.rows[0]
}

function assertManagedUserIsMutable(
  target: any,
  actor: ManagedUserActor
) {
  if (
    Number(target.id) ===
    Number(actor.id)
  ) {
    throw new Error(
      "Use your own account settings to manage your account"
    )
  }

  if (
    String(target.role) ===
    "platform_owner"
  ) {
    throw new Error(
      "Platform owner is protected"
    )
  }
}

export async function updateManagedUserRoleByTenantSlug(
  tenantSlug: string,
  userId: number,
  roleInput: unknown,
  actor: ManagedUserActor
) {
  await ensureAuthTables()

  const tenantId =
    await getTenantIdBySlug(
      tenantSlug
    )

  const target =
    await getManagedUser(
      tenantId,
      userId
    )

  assertManagedUserIsMutable(
    target,
    actor
  )

  if (!target.is_active) {
    throw new Error(
      "Former users cannot have their role changed"
    )
  }

  const nextRole =
    normalizeManagedRole(
      roleInput
    )

  if (
    nextRole ===
    String(target.role)
  ) {
    return target
  }

  const result =
    await pool.query(
      `
      update app_users
      set
        role = $1,
        updated_at = now()
      where tenant_id = $2
        and id = $3
      returning
        id,
        tenant_id,
        email,
        full_name,
        role,
        is_active,
        deactivated_at,
        created_at,
        updated_at
      `,
      [
        nextRole,
        tenantId,
        userId,
      ]
    )

  const user =
    result.rows[0]

  await logUserManagementActivity(
    tenantId,
    "user_role_changed",
    `Navigator user role changed for ${user.full_name}`,
    {
      app_user_id:
        user.id,
      email:
        user.email,
      old_role:
        target.role,
      new_role:
        user.role,
      actor_user_id:
        actor.id,
      actor_email:
        actor.email,
      actor_name:
        actor.full_name || null,
    }
  )

  return user
}

export async function updateManagedUserFinancialsAuthorizationByTenantSlug(
  tenantSlug: string,
  userId: number,
  authorizedInput: unknown,
  actor: ManagedUserActor
) {
  await ensureAuthTables()

  const tenantId =
    await getTenantIdBySlug(
      tenantSlug
    )

  const target =
    await getManagedUser(
      tenantId,
      userId
    )

  if (!target.is_active) {
    throw new Error(
      "Former users cannot have Financial Operations access changed"
    )
  }

  if (typeof authorizedInput !== "boolean") {
    throw new Error(
      "financials_authorized must be true or false"
    )
  }

  const nextAuthorized =
    authorizedInput

  if (
    Boolean(target.financials_authorized) ===
    nextAuthorized
  ) {
    return target
  }

  const result =
    await pool.query(
      `
        update app_users
        set
          financials_authorized = $1,
          updated_at = now()
        where tenant_id = $2
          and id = $3
        returning
          id,
          tenant_id,
          email,
          full_name,
          role,
          is_active,
          financials_authorized,
          deactivated_at,
          created_at,
          updated_at
      `,
      [
        nextAuthorized,
        tenantId,
        userId,
      ]
    )

  const user =
    result.rows[0]

  await logUserManagementActivity(
    tenantId,
    "user_financials_authorization_changed",
    `Financial Operations access ${nextAuthorized ? "authorized" : "revoked"} for ${user.full_name}`,
    {
      app_user_id:
        user.id,
      email:
        user.email,
      old_financials_authorized:
        Boolean(
          target.financials_authorized
        ),
      new_financials_authorized:
        Boolean(
          user.financials_authorized
        ),
      actor_user_id:
        actor.id,
      actor_email:
        actor.email,
      actor_name:
        actor.full_name || null,
    }
  )

  return user
}

export async function resetManagedUserPasswordByTenantSlug(
  tenantSlug: string,
  userId: number,
  newPasswordInput: unknown,
  actor: ManagedUserActor
) {
  await ensureAuthTables()

  const tenantId =
    await getTenantIdBySlug(
      tenantSlug
    )

  const target =
    await getManagedUser(
      tenantId,
      userId
    )

  assertManagedUserIsMutable(
    target,
    actor
  )

  if (!target.is_active) {
    throw new Error(
      "Former users cannot have their password reset"
    )
  }

  const newPassword =
    String(
      newPasswordInput || ""
    )

  if (
    !newPassword ||
    newPassword.length < 6
  ) {
    throw new Error(
      "New password must be at least 6 characters"
    )
  }

  const passwordHash =
    await bcrypt.hash(
      newPassword,
      10
    )

  const result =
    await pool.query(
      `
      update app_users
      set
        password_hash = $1,
        updated_at = now()
      where tenant_id = $2
        and id = $3
      returning
        id,
        tenant_id,
        email,
        full_name,
        role,
        is_active,
        deactivated_at,
        created_at,
        updated_at
      `,
      [
        passwordHash,
        tenantId,
        userId,
      ]
    )

  const user =
    result.rows[0]

  await logUserManagementActivity(
    tenantId,
    "user_password_reset",
    `Navigator password reset for ${user.full_name}`,
    {
      app_user_id:
        user.id,
      email:
        user.email,
      actor_user_id:
        actor.id,
      actor_email:
        actor.email,
      actor_name:
        actor.full_name || null,
    }
  )

  return user
}

export async function deactivateManagedUserByTenantSlug(
  tenantSlug: string,
  userId: number,
  actor: ManagedUserActor
) {
  await ensureAuthTables()

  const tenantId =
    await getTenantIdBySlug(
      tenantSlug
    )

  const target =
    await getManagedUser(
      tenantId,
      userId
    )

  assertManagedUserIsMutable(
    target,
    actor
  )

  if (!target.is_active) {
    return target
  }

  const result =
    await pool.query(
      `
      update app_users
      set
        is_active = false,
        deactivated_at = now(),
        updated_at = now()
      where tenant_id = $1
        and id = $2
      returning
        id,
        tenant_id,
        email,
        full_name,
        role,
        is_active,
        deactivated_at,
        created_at,
        updated_at
      `,
      [
        tenantId,
        userId,
      ]
    )

  const user =
    result.rows[0]

  await logUserManagementActivity(
    tenantId,
    "user_deactivated",
    `Navigator access ended for ${user.full_name}`,
    {
      app_user_id:
        user.id,
      email:
        user.email,
      role:
        user.role,
      joined_at:
        user.created_at,
      deactivated_at:
        user.deactivated_at,
      actor_user_id:
        actor.id,
      actor_email:
        actor.email,
      actor_name:
        actor.full_name || null,
    }
  )

  return user
}

export async function listInvitationsByTenantSlug(tenantSlug: string) {
  await ensureAuthTables()
  const tenantId = await getTenantIdBySlug(tenantSlug)

  const result = await pool.query(
    `
    select
      id,
      email,
      full_name,
      role,
      invite_token,
      accepted_at,
      expires_at,
      created_at,
      invite_email_sent_at,
      tenant_send_notified_at,
      invitee_acceptance_notified_at,
      tenant_acceptance_notified_at
    from user_invitations
    where tenant_id = $1
    order by created_at desc, id desc
    `,
    [tenantId]
  )

  return result.rows
}


export async function changePasswordForUser(
  token: string,
  input: {
    currentPassword: string
    newPassword: string
  }
) {
  await ensureAuthTables()

  const decoded = verifyToken(token)

  const currentPassword = String(input.currentPassword || "")
  const newPassword = String(input.newPassword || "")

  if (!currentPassword) {
    throw new Error("Current password required")
  }

  if (!newPassword || newPassword.length < 6) {
    throw new Error("New password must be at least 6 characters")
  }

  const result = await pool.query(
    `
    select
      id,
      password_hash
    from app_users
    where id = $1
    limit 1
    `,
    [decoded.sub]
  )

  if (!result.rowCount) {
    throw new Error("User not found")
  }

  const user = result.rows[0]

  const valid = await bcrypt.compare(
    currentPassword,
    user.password_hash
  )

  if (!valid) {
    throw new Error("Current password incorrect")
  }

  const passwordHash = await bcrypt.hash(newPassword, 10)

  await pool.query(
    `
    update app_users
    set
      password_hash = $1,
      updated_at = now()
    where id = $2
    `,
    [passwordHash, user.id]
  )

  return { ok: true }
}
