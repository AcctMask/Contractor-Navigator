import type { FastifyInstance } from "fastify"
import { timingSafeEqual } from "crypto"
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

function requireOpsIntelService(request: any): boolean {
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

export async function registerOpsIntelBridgeRoutes(
  app: FastifyInstance
) {
  app.get(
    "/integrations/ops-intel/:tenantSlug/jobs",
    async (request: any, reply) => {
      if (!requireOpsIntelService(request)) {
        return reply.code(401).send({
          ok: false,
          error: "Authentication required",
        })
      }

      const tenantSlug = String(
        request.params?.tenantSlug || ""
      ).trim()

      if (!tenantSlug) {
        return reply.code(400).send({
          ok: false,
          error: "tenantSlug is required",
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
            j.id as navigator_job_id,
            j.lead_source,
            j.lead_source_detail,
            j.marketing_campaign,
            j.job_type,
            j.carrier,
            j.city,
            j.state,
            j.zip,
            j.stage,
            j.created_at
          from jobs j
          where j.tenant_id = $1
          order by j.id asc
        `,
        [tenant.id]
      )

      return reply.send({
        ok: true,
        source: "contractor-navigator",
        mode: "read-only-operational-attribution",
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
        },
        jobs: result.rows.map((row: any) => ({
          navigator_job_id: Number(row.navigator_job_id),
          lead_source: row.lead_source ?? null,
          lead_source_detail: row.lead_source_detail ?? null,
          marketing_campaign: row.marketing_campaign ?? null,
          job_type: row.job_type ?? null,
          carrier: row.carrier ?? null,
          city: row.city ?? null,
          state: row.state ?? null,
          zip: row.zip ?? null,
          stage: row.stage ?? null,
          created_at: row.created_at ?? null,
        })),
      })
    }
  )
}
