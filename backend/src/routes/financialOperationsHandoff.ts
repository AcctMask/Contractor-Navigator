import type { FastifyInstance } from "fastify"
import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "crypto"
import { pool } from "../db/db"
import { getCurrentUserFromToken } from "../services/authService"

const HANDOFF_TTL_MINUTES = 2

function bearerToken(request: any): string {
  const authorization = String(
    request.headers.authorization || ""
  )

  return authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : ""
}

function safeEqual(
  supplied: string,
  expected: string
): boolean {
  if (!supplied || !expected) return false

  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)

  if (left.length !== right.length) return false

  return timingSafeEqual(left, right)
}

function requireFinancialOperationsService(
  request: any
): boolean {
  const expected = String(
    process.env.AA_ACTIVITY_GATEWAY_SECRET || ""
  )

  const supplied = String(
    request.headers["x-aa-activity-secret"] ||
      (
        String(request.headers.authorization || "")
          .startsWith("Bearer ")
          ? String(request.headers.authorization)
              .slice(7)
              .trim()
          : ""
      )
  )

  return safeEqual(supplied, expected)
}

async function ensureHandoffTable() {
  await pool.query(`
    create table if not exists financial_operations_handoffs (
      id bigserial primary key,
      code_hash text not null unique,
      tenant_id bigint not null,
      tenant_slug text not null,
      navigator_user_id bigint not null,
      email text not null,
      full_name text,
      role text not null,
      job_id bigint,
      return_path text not null,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null,
      consumed_at timestamptz
    )
  `)

  await pool.query(`
    create index if not exists
      idx_financial_operations_handoffs_expiry
    on financial_operations_handoffs (
      expires_at,
      consumed_at
    )
  `)
}

function hashCode(code: string): string {
  return createHash("sha256")
    .update(code)
    .digest("hex")
}

export async function registerFinancialOperationsHandoffRoutes(
  app: FastifyInstance
) {
  await ensureHandoffTable()

  app.post(
    "/financial-operations/handoff",
    async (request: any, reply) => {
      try {
        const token = bearerToken(request)

        if (!token) {
          return reply.code(401).send({
            ok: false,
            error: "Authentication required",
          })
        }

        const user =
          await getCurrentUserFromToken(token)

        if (!user || !user.is_active) {
          return reply.code(401).send({
            ok: false,
            error: "Authentication required",
          })
        }

        const requestedJobId =
          request.body?.job_id == null
            ? null
            : Number(request.body.job_id)

        if (
          requestedJobId !== null &&
          (
            !Number.isInteger(requestedJobId) ||
            requestedJobId <= 0
          )
        ) {
          return reply.code(400).send({
            ok: false,
            error: "Invalid job",
          })
        }

        const tenantResult = await pool.query(
          `
            select id, slug
            from tenants
            where id = $1
            limit 1
          `,
          [Number(user.tenant_id)]
        )

        if (!tenantResult.rowCount) {
          return reply.code(404).send({
            ok: false,
            error: "Tenant not found",
          })
        }

        const tenant = tenantResult.rows[0]

        if (requestedJobId !== null) {
          const jobResult = await pool.query(
            `
              select j.id
              from jobs j
              where j.tenant_id = $1
                and j.id = $2
                and (
                  $3::text <> 'subcontractor'
                  or exists (
                    select 1
                    from crew_assignments ca
                    where ca.tenant_id = j.tenant_id
                      and ca.job_id = j.id
                      and ca.app_user_id = $4
                  )
                )
              limit 1
            `,
            [
              Number(user.tenant_id),
              requestedJobId,
              String(user.role),
              Number(user.id),
            ]
          )

          if (!jobResult.rowCount) {
            return reply.code(404).send({
              ok: false,
              error: "Job not found",
            })
          }
        }

        const code = randomBytes(32).toString("hex")
        const codeHash = hashCode(code)

        const returnPath =
          requestedJobId === null
            ? "/"
            : `/job/${requestedJobId}`

        await pool.query(
          `
            insert into financial_operations_handoffs (
              code_hash,
              tenant_id,
              tenant_slug,
              navigator_user_id,
              email,
              full_name,
              role,
              job_id,
              return_path,
              expires_at
            )
            values (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              now() + ($10 * interval '1 minute')
            )
          `,
          [
            codeHash,
            Number(user.tenant_id),
            String(tenant.slug),
            Number(user.id),
            String(user.email || "")
              .trim()
              .toLowerCase(),
            user.full_name || null,
            String(user.role || ""),
            requestedJobId,
            returnPath,
            HANDOFF_TTL_MINUTES,
          ]
        )

        return {
          ok: true,
          code,
          tenant_slug: String(tenant.slug),
          job_id: requestedJobId,
          return_path: returnPath,
          expires_in_seconds:
            HANDOFF_TTL_MINUTES * 60,
        }
      } catch (error: any) {
        request.log.error(error)

        return reply.code(400).send({
          ok: false,
          error:
            error?.message ||
            "Financial Operations handoff failed",
        })
      }
    }
  )

  app.post(
    "/integrations/financial-operations/handoff/exchange",
    async (request: any, reply) => {
      try {
        if (!requireFinancialOperationsService(request)) {
          return reply.code(401).send({
            ok: false,
            error: "Authentication required",
          })
        }

        const code = String(
          request.body?.code || ""
        ).trim()

        if (!code) {
          return reply.code(400).send({
            ok: false,
            error: "Handoff code required",
          })
        }

        const codeHash = hashCode(code)

        const result = await pool.query(
          `
            update financial_operations_handoffs
            set consumed_at = now()
            where code_hash = $1
              and consumed_at is null
              and expires_at > now()
            returning
              tenant_id,
              tenant_slug,
              navigator_user_id,
              email,
              full_name,
              role,
              job_id,
              return_path,
              expires_at,
              consumed_at
          `,
          [codeHash]
        )

        if (!result.rowCount) {
          return reply.code(401).send({
            ok: false,
            error:
              "Handoff is invalid, expired, or already used",
          })
        }

        return {
          ok: true,
          handoff: result.rows[0],
        }
      } catch (error: any) {
        request.log.error(error)

        return reply.code(400).send({
          ok: false,
          error:
            error?.message ||
            "Financial Operations handoff exchange failed",
        })
      }
    }
  )
}
