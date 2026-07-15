import type { FastifyInstance } from "fastify"
import { randomBytes, timingSafeEqual } from "crypto"
import { pool } from "../db/db"
import { getCurrentUserFromToken } from "../services/authService"

const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  "https://contractor-navigator.vercel.app"

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function getBearerToken(request: any) {
  const authorization = String(
    request.headers.authorization || "",
  )

  return authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : ""
}

function requireProvisioningSecret(request: any) {
  const expected =
    process.env.AA_ACTIVITY_GATEWAY_SECRET || ""

  const supplied = String(
    request.headers["x-aa-activity-secret"] ||
      request.headers.authorization?.replace(
        /^Bearer\s+/i,
        "",
      ) ||
      "",
  )

  return Boolean(
    expected &&
      supplied &&
      safeEqual(expected, supplied),
  )
}

function cleanRequired(
  value: unknown,
  fieldName: string,
) {
  const cleaned = String(value || "").trim()

  if (!cleaned) {
    throw new Error(`${fieldName} is required`)
  }

  return cleaned
}

function cleanOptional(value: unknown) {
  const cleaned = String(value || "").trim()
  return cleaned || null
}

async function ensureProvisioningTables(
  client: any,
) {
  await client.query(`
    create table if not exists tenant_company_dna (
      tenant_id bigint primary key
        references tenants(id)
        on delete cascade,

      owner_controls_tenant_id uuid not null unique,
      source_review_id uuid null,

      status text not null default 'approved',
      version integer not null default 1,

      identity jsonb not null default '{}'::jsonb,
      responses jsonb not null default '{}'::jsonb,
      not_applicable jsonb not null default '{}'::jsonb,

      branding jsonb not null default '{}'::jsonb,
      workflow_defaults jsonb not null default '{}'::jsonb,

      approved_at timestamptz null,
      provisioned_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)

  await client.query(`
    create table if not exists tenant_provisioning_state (
      tenant_id bigint primary key
        references tenants(id)
        on delete cascade,

      owner_controls_tenant_id uuid not null unique,

      navigator_status text not null default 'ready',
      company_dna_status text not null default 'approved',
      crm_status text not null default 'ready',
      owner_access_status text not null default 'invited',

      metadata jsonb not null default '{}'::jsonb,

      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)

  await client.query(`
    create table if not exists app_users (
      id bigserial primary key,
      tenant_id bigint not null
        references tenants(id)
        on delete cascade,
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

  await client.query(`
    create table if not exists user_invitations (
      id bigserial primary key,
      tenant_id bigint not null
        references tenants(id)
        on delete cascade,
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

  await client.query(`
    create index if not exists
      idx_user_invitations_tenant_email
    on user_invitations (
      tenant_id,
      lower(email)
    )
  `)
}

async function ensureOwnerInvitation({
  client,
  tenantId,
  email,
  fullName,
}: {
  client: any
  tenantId: number
  email: string
  fullName: string
}) {
  const existingUser = await client.query(
    `
      select
        id,
        email,
        full_name,
        role,
        is_active
      from app_users
      where tenant_id = $1
        and lower(email) = lower($2)
      limit 1
    `,
    [tenantId, email],
  )

  if (existingUser.rowCount) {
    return {
      status: "active",
      user: existingUser.rows[0],
      invitation: null,
      invite_url: null,
    }
  }

  const existingInvitation =
    await client.query(
      `
        select
          id,
          email,
          full_name,
          role,
          invite_token,
          accepted_at,
          expires_at,
          created_at
        from user_invitations
        where tenant_id = $1
          and lower(email) = lower($2)
          and accepted_at is null
          and expires_at > now()
        order by created_at desc
        limit 1
      `,
      [tenantId, email],
    )

  if (existingInvitation.rowCount) {
    const invitation =
      existingInvitation.rows[0]

    return {
      status: "invited",
      user: null,
      invitation,
      invite_url:
        `${APP_BASE_URL}/accept-invite/` +
        invitation.invite_token,
    }
  }

  const inviteToken =
    randomBytes(32).toString("hex")

  const inserted = await client.query(
    `
      insert into user_invitations (
        tenant_id,
        email,
        full_name,
        role,
        invite_token,
        invited_by_user_id,
        expires_at
      )
      values (
        $1,
        lower($2),
        $3,
        'tenant_admin',
        $4,
        null,
        now() + interval '30 days'
      )
      returning
        id,
        email,
        full_name,
        role,
        invite_token,
        accepted_at,
        expires_at,
        created_at
    `,
    [
      tenantId,
      email,
      fullName,
      inviteToken,
    ],
  )

  const invitation = inserted.rows[0]

  return {
    status: "invited",
    user: null,
    invitation,
    invite_url:
      `${APP_BASE_URL}/accept-invite/` +
      invitation.invite_token,
  }
}

export async function registerPlatformProvisioningRoutes(
  app: FastifyInstance,
) {
  app.get(
    "/platform/company-dna-runtime/:tenantSlug",
    async (request: any, reply) => {
      const token = getBearerToken(request)

      if (!token) {
        return reply.code(401).send({
          ok: false,
          error: "Authentication required.",
        })
      }

      const tenantSlug = String(
        request.params?.tenantSlug || "",
      ).trim()

      if (!tenantSlug) {
        return reply.code(400).send({
          ok: false,
          error: "tenantSlug is required.",
        })
      }

      const client = await pool.connect()

      try {
        const currentUser =
          await getCurrentUserFromToken(token)

        if (!currentUser?.is_active) {
          return reply.code(401).send({
            ok: false,
            error: "User account is inactive.",
          })
        }

        const tenantResult = await client.query(
          `
            select
              id,
              slug,
              name,
              created_at
            from tenants
            where slug = $1
            limit 1
          `,
          [tenantSlug],
        )

        const tenant = tenantResult.rows[0]

        if (!tenant) {
          return reply.code(404).send({
            ok: false,
            error: "Navigator tenant was not found.",
          })
        }

        if (
          Number(currentUser.tenant_id) !==
          Number(tenant.id)
        ) {
          return reply.code(403).send({
            ok: false,
            error:
              "The authenticated user does not belong to this tenant.",
          })
        }

        let companyDna = null

        try {
          const companyDnaResult =
            await client.query(
              `
                select
                  status,
                  version,
                  branding,
                  workflow_defaults,
                  approved_at,
                  provisioned_at,
                  updated_at
                from tenant_company_dna
                where tenant_id = $1
                limit 1
              `,
              [tenant.id],
            )

          companyDna =
            companyDnaResult.rows[0] || null
        } catch (error: any) {
          if (error?.code !== "42P01") {
            throw error
          }
        }

        const branding = {
          business_display_name:
            companyDna?.branding
              ?.business_display_name ||
            tenant.name,

          dba_name:
            companyDna?.branding?.dba_name ||
            null,

          primary_color:
            companyDna?.branding
              ?.primary_color ||
            null,

          accent_color:
            companyDna?.branding
              ?.accent_color ||
            null,

          website:
            companyDna?.branding?.website ||
            null,

          email:
            companyDna?.branding?.email ||
            null,

          phone:
            companyDna?.branding?.phone ||
            null,
        }

        const workflowDefaults = {
          customer_term:
            companyDna?.workflow_defaults
              ?.customer_term ||
            "Customer",

          job_term:
            companyDna?.workflow_defaults
              ?.job_term ||
            "Job",

          crew_term:
            companyDna?.workflow_defaults
              ?.crew_term ||
            "Crew",

          estimate_term:
            companyDna?.workflow_defaults
              ?.estimate_term ||
            "Estimate",

          agreement_term:
            companyDna?.workflow_defaults
              ?.agreement_term ||
            "Agreement",

          inspection_term:
            companyDna?.workflow_defaults
              ?.inspection_term ||
            "Inspection",

          call_to_action:
            companyDna?.workflow_defaults
              ?.call_to_action ||
            "Contact Us",

          office_hours:
            companyDna?.workflow_defaults
              ?.office_hours ||
            null,

          after_hours_behavior:
            companyDna?.workflow_defaults
              ?.after_hours_behavior ||
            null,

          ring_owner_first:
            companyDna?.workflow_defaults
              ?.ring_owner_first ||
            null,

          rejected_call_behavior:
            companyDna?.workflow_defaults
              ?.rejected_call_behavior ||
            null,

          scheduling_rules:
            companyDna?.workflow_defaults
              ?.scheduling_rules ||
            null,

          escalation_rules:
            companyDna?.workflow_defaults
              ?.escalation_rules ||
            null,

          territory:
            companyDna?.workflow_defaults
              ?.territory ||
            null,
        }

        return reply.send({
          ok: true,

          tenant: {
            id: Number(tenant.id),
            slug: tenant.slug,
            name: tenant.name,
          },

          company_dna: {
            status:
              companyDna?.status ||
              "defaults",

            version:
              Number(
                companyDna?.version || 1,
              ),

            approved_at:
              companyDna?.approved_at ||
              null,

            updated_at:
              companyDna?.updated_at ||
              null,
          },

          branding,
          workflow_defaults:
            workflowDefaults,
        })
      } catch (error: any) {
        request.log.error(error)

        return reply.code(500).send({
          ok: false,
          error:
            "Company DNA runtime could not be loaded.",
          details:
            error?.message || String(error),
        })
      } finally {
        client.release()
      }
    },
  )

  app.get(
    "/platform/provisioning-status/:tenantSlug",
    async (request: any, reply) => {
      if (!requireProvisioningSecret(request)) {
        return reply.code(401).send({
          ok: false,
          error:
            "Platform provisioning authorization required.",
        })
      }

      const tenantSlug = String(
        request.params?.tenantSlug || "",
      ).trim()

      if (!tenantSlug) {
        return reply.code(400).send({
          ok: false,
          error: "tenantSlug is required.",
        })
      }

      const client = await pool.connect()

      try {
        const tenantResult = await client.query(
          `
            select
              id,
              slug,
              name,
              created_at
            from tenants
            where slug = $1
            limit 1
          `,
          [tenantSlug],
        )

        const tenant = tenantResult.rows[0]

        if (!tenant) {
          return reply.code(404).send({
            ok: false,
            error: "Navigator tenant was not found.",
          })
        }

        const companyDnaResult =
          await client.query(
            `
              select
                tenant_id,
                owner_controls_tenant_id,
                source_review_id,
                status,
                version,
                branding,
                workflow_defaults,
                approved_at,
                provisioned_at,
                updated_at
              from tenant_company_dna
              where tenant_id = $1
              limit 1
            `,
            [tenant.id],
          )

        const provisioningResult =
          await client.query(
            `
              select
                tenant_id,
                owner_controls_tenant_id,
                navigator_status,
                company_dna_status,
                crm_status,
                owner_access_status,
                metadata,
                created_at,
                updated_at
              from tenant_provisioning_state
              where tenant_id = $1
              limit 1
            `,
            [tenant.id],
          )

        const invitationResult =
          await client.query(
            `
              select
                id,
                email,
                full_name,
                role,
                accepted_at,
                expires_at,
                created_at
              from user_invitations
              where tenant_id = $1
              order by created_at desc
              limit 1
            `,
            [tenant.id],
          )

        return reply.send({
          ok: true,
          tenant,
          company_dna:
            companyDnaResult.rows[0] || null,
          provisioning:
            provisioningResult.rows[0] || null,
          owner_invitation:
            invitationResult.rows[0] || null,
        })
      } catch (error: any) {
        request.log.error(error)

        return reply.code(500).send({
          ok: false,
          error:
            "Navigator provisioning status could not be loaded.",
          details:
            error?.message || String(error),
        })
      } finally {
        client.release()
      }
    },
  )

  app.post(
    "/platform/provision-tenant",
    async (request: any, reply) => {
      if (!requireProvisioningSecret(request)) {
        return reply.code(401).send({
          ok: false,
          error:
            "Platform provisioning authorization required.",
        })
      }

      const body = request.body || {}

      let tenantSlug = ""
      let companyName = ""
      let ownerControlsTenantId = ""
      let ownerName = ""
      let ownerEmail = ""

      try {
        tenantSlug = cleanRequired(
          body.tenant_slug,
          "tenant_slug",
        )

        companyName = cleanRequired(
          body.company_name,
          "company_name",
        )

        ownerControlsTenantId = cleanRequired(
          body.owner_controls_tenant_id,
          "owner_controls_tenant_id",
        )

        ownerName = cleanRequired(
          body.owner_name,
          "owner_name",
        )

        ownerEmail = cleanRequired(
          body.owner_email,
          "owner_email",
        ).toLowerCase()
      } catch (error: any) {
        return reply.code(400).send({
          ok: false,
          error:
            error?.message ||
            "Required provisioning information is missing.",
        })
      }

      const client = await pool.connect()

      try {
        await client.query("begin")

        await ensureProvisioningTables(client)

        const tenantResult =
          await client.query(
            `
              insert into tenants (
                slug,
                name
              )
              values ($1, $2)
              on conflict (slug)
              do update set
                name = excluded.name
              returning
                id,
                slug,
                name,
                created_at
            `,
            [tenantSlug, companyName],
          )

        const tenant = tenantResult.rows[0]
        const tenantId = Number(tenant.id)

        const identity =
          body.identity &&
          typeof body.identity === "object"
            ? body.identity
            : {}

        const responses =
          body.responses &&
          typeof body.responses === "object"
            ? body.responses
            : {}

        const notApplicable =
          body.not_applicable &&
          typeof body.not_applicable === "object"
            ? body.not_applicable
            : {}

        const branding = {
          business_display_name:
            responses.business_display_name ||
            companyName,
          dba_name:
            identity.dba_name ||
            responses.dba_name ||
            null,
          primary_color:
            responses.primary_color || null,
          accent_color:
            responses.accent_color || null,
          website:
            cleanOptional(body.website),
          email: ownerEmail,
          phone:
            cleanOptional(body.phone),
        }

        const workflowDefaults = {
          customer_term:
            responses.customer_term || null,
          job_term:
            responses.job_term || null,
          crew_term:
            responses.crew_term || null,
          estimate_term:
            responses.estimate_term || null,
          agreement_term:
            responses.agreement_term || null,
          inspection_term:
            responses.inspection_term || null,
          call_to_action:
            responses.call_to_action || null,
          office_hours:
            responses.office_hours || null,
          after_hours_behavior:
            responses.after_hours_behavior ||
            null,
          ring_owner_first:
            responses.ring_owner_first || null,
          rejected_call_behavior:
            responses.rejected_call_behavior ||
            null,
          scheduling_rules:
            responses.scheduling_rules || null,
          escalation_rules:
            responses.escalation_rules || null,
          territory:
            cleanOptional(body.territory),
        }

        await client.query(
          `
            insert into tenant_company_dna (
              tenant_id,
              owner_controls_tenant_id,
              source_review_id,
              status,
              version,
              identity,
              responses,
              not_applicable,
              branding,
              workflow_defaults,
              approved_at,
              provisioned_at,
              updated_at
            )
            values (
              $1,
              $2::uuid,
              nullif($3, '')::uuid,
              'approved',
              $4,
              $5::jsonb,
              $6::jsonb,
              $7::jsonb,
              $8::jsonb,
              $9::jsonb,
              $10::timestamptz,
              now(),
              now()
            )
            on conflict (tenant_id)
            do update set
              owner_controls_tenant_id =
                excluded.owner_controls_tenant_id,
              source_review_id =
                excluded.source_review_id,
              status = excluded.status,
              version = excluded.version,
              identity = excluded.identity,
              responses = excluded.responses,
              not_applicable =
                excluded.not_applicable,
              branding = excluded.branding,
              workflow_defaults =
                excluded.workflow_defaults,
              approved_at =
                excluded.approved_at,
              provisioned_at = now(),
              updated_at = now()
          `,
          [
            tenantId,
            ownerControlsTenantId,
            cleanOptional(
              body.source_review_id,
            ),
            Number(body.version || 1),
            JSON.stringify(identity),
            JSON.stringify(responses),
            JSON.stringify(notApplicable),
            JSON.stringify(branding),
            JSON.stringify(workflowDefaults),
            cleanOptional(body.approved_at),
          ],
        )

        const ownerAccess =
          await ensureOwnerInvitation({
            client,
            tenantId,
            email: ownerEmail,
            fullName: ownerName,
          })

        await client.query(
          `
            insert into tenant_provisioning_state (
              tenant_id,
              owner_controls_tenant_id,
              navigator_status,
              company_dna_status,
              crm_status,
              owner_access_status,
              metadata,
              updated_at
            )
            values (
              $1,
              $2::uuid,
              'ready',
              'approved',
              'ready',
              $3,
              $4::jsonb,
              now()
            )
            on conflict (tenant_id)
            do update set
              owner_controls_tenant_id =
                excluded.owner_controls_tenant_id,
              navigator_status = 'ready',
              company_dna_status = 'approved',
              crm_status = 'ready',
              owner_access_status =
                excluded.owner_access_status,
              metadata = excluded.metadata,
              updated_at = now()
          `,
          [
            tenantId,
            ownerControlsTenantId,
            ownerAccess.status,
            JSON.stringify({
              source:
                "actual-assistant-eco",
              source_review_id:
                cleanOptional(
                  body.source_review_id,
                ),
              package_name:
                cleanOptional(
                  body.package_name,
                ),
              territory:
                cleanOptional(body.territory),
            }),
          ],
        )

        await client.query(
          `
            insert into timeline_events (
              tenant_id,
              job_id,
              kind,
              message,
              meta,
              created_at
            )
            values (
              $1,
              null,
              'platform_tenant_provisioned',
              $2,
              $3::jsonb,
              now()
            )
          `,
          [
            tenantId,
            `Navigator tenant provisioned for ${companyName}`,
            JSON.stringify({
              owner_controls_tenant_id:
                ownerControlsTenantId,
              source_review_id:
                cleanOptional(
                  body.source_review_id,
                ),
              owner_access_status:
                ownerAccess.status,
            }),
          ],
        )

        await client.query("commit")

        return reply.send({
          ok: true,
          tenant: {
            id: tenantId,
            slug: tenant.slug,
            name: tenant.name,
          },
          company_dna: {
            status: "approved",
            stored: true,
            version: Number(
              body.version || 1,
            ),
          },
          crm: {
            status: "ready",
            tenant_scoped: true,
          },
          owner_access: ownerAccess,
        })
      } catch (error: any) {
        await client.query("rollback")

        request.log.error(error)

        return reply.code(500).send({
          ok: false,
          error:
            "Navigator tenant provisioning failed.",
          details:
            error?.message || String(error),
        })
      } finally {
        client.release()
      }
    },
  )
}
