import { timingSafeEqual } from "crypto"
import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function suppliedServiceSecret(request: any): string {
  return String(
    request.headers["x-aa-activity-secret"] ||
      request.headers.authorization?.replace(/^Bearer\s+/i, "") ||
      ""
  ).trim()
}

function requireFinancialOperationsService(request: any): boolean {
  const expected = String(
    process.env.AA_ACTIVITY_GATEWAY_SECRET || ""
  ).trim()

  const supplied = suppliedServiceSecret(request)

  return Boolean(
    expected &&
      supplied &&
      safeEqual(expected, supplied)
  )
}

async function getTenantBySlug(
  tenantSlug: string
): Promise<{ id: number; slug: string } | null> {
  const result = await pool.query(
    `
      select id, slug
      from tenants
      where slug = $1
      limit 1
    `,
    [tenantSlug]
  )

  if (!result.rowCount) return null

  return {
    id: Number(result.rows[0].id),
    slug: String(result.rows[0].slug),
  }
}

export async function registerFinancialOperationsBridgeRoutes(
  app: FastifyInstance
) {
  app.get(
    "/integrations/financial-operations/:tenantSlug/jobs/:jobId",
    async (request: any, reply) => {
      if (!requireFinancialOperationsService(request)) {
        return reply.code(401).send({
          ok: false,
          error: "Authentication required",
        })
      }

      const tenantSlug = String(
        request.params?.tenantSlug || ""
      ).trim()

      const jobId = Number(request.params?.jobId)

      if (!tenantSlug) {
        return reply.code(400).send({
          ok: false,
          error: "tenantSlug is required",
        })
      }

      if (!Number.isInteger(jobId) || jobId <= 0) {
        return reply.code(400).send({
          ok: false,
          error: "Valid jobId is required",
        })
      }

      const tenant = await getTenantBySlug(tenantSlug)

      if (!tenant) {
        return reply.code(404).send({
          ok: false,
          error: "Tenant not found",
        })
      }

      const result = await pool.query(
        `
          select
            j.id as job_id,
            j.customer_id,
            j.external_job_id,
            j.stage,
            j.job_type,
            j.address1,
            j.city,
            j.state,
            j.zip,
            j.created_at,
            j.updated_at,
            c.full_name as customer_name
          from jobs j
          left join customers c
            on c.id = j.customer_id
           and c.tenant_id = j.tenant_id
          where j.tenant_id = $1
            and j.id = $2
          limit 1
        `,
        [tenant.id, jobId]
      )

      if (!result.rowCount) {
        return reply.code(404).send({
          ok: false,
          error: "Job not found",
        })
      }

      const row = result.rows[0]

      return reply.send({
        ok: true,
        source: "contractor-navigator",
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
        },
        customer: {
          id:
            row.customer_id === null
              ? null
              : Number(row.customer_id),
          name: row.customer_name || null,
        },
        job: {
          id: Number(row.job_id),
          external_job_id: row.external_job_id || null,
          stage: row.stage || null,
          job_type: row.job_type || null,
          address1: row.address1 || null,
          city: row.city || null,
          state: row.state || null,
          zip: row.zip || null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
        },
      })
    }
  )
}
