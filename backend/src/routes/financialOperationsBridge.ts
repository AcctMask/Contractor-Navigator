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
            c.full_name as customer_name,
            jed.contract_amount
          from jobs j
          left join customers c
            on c.id = j.customer_id
           and c.tenant_id = j.tenant_id
          left join job_estimate_details jed
            on jed.job_id = j.id
           and jed.tenant_id = j.tenant_id
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
          contract_amount: row.contract_amount ?? null,
        },
      })
    }
  )

  app.get(
    "/integrations/financial-operations/:tenantSlug/jobs",
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

      const view =
        String(request.query?.view || "active")
          .trim()
          .toLowerCase() === "archived"
          ? "archived"
          : "active"

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
            j.id,
            j.external_job_id,
            j.stage,
            j.job_type,
            j.address1,
            j.city,
            j.state,
            j.zip,
            j.created_at,
            j.updated_at,
            c.id as customer_id,
            c.full_name as customer_name
          from jobs j
          left join customers c
            on c.id = j.customer_id
           and c.tenant_id = j.tenant_id
          where j.tenant_id = $1
            and (
              ($2 = 'archived' and j.stage = 'archived')
              or
              (
                $2 = 'active'
                and coalesce(j.stage, '') <> 'archived'
              )
            )
          order by j.id desc
          limit 500
        `,
        [tenant.id, view]
      )

      return reply.send({
        ok: true,
        source: "contractor-navigator",
        view,
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
        },
        jobs: result.rows.map((row) => ({
          id: Number(row.id),
          external_job_id: row.external_job_id || null,
          stage: row.stage || null,
          job_type: row.job_type || null,
          address1: row.address1 || null,
          city: row.city || null,
          state: row.state || null,
          zip: row.zip || null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
          customer: {
            id:
              row.customer_id == null
                ? null
                : Number(row.customer_id),
            name: row.customer_name || null,
          },
        })),
      })
    }
  )

  app.get(
    "/integrations/financial-operations/:tenantSlug/customers",
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

      const view =
        String(request.query?.view || "active")
          .trim()
          .toLowerCase() === "archived"
          ? "archived"
          : "active"

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
            c.id,
            c.full_name,
            c.created_at,
            c.updated_at,
            count(j.id)::int as jobs_count
          from customers c
          join jobs j
            on j.customer_id = c.id
           and j.tenant_id = c.tenant_id
          where c.tenant_id = $1
            and (
              ($2 = 'archived' and j.stage = 'archived')
              or
              (
                $2 = 'active'
                and coalesce(j.stage, '') <> 'archived'
              )
            )
          group by
            c.id,
            c.full_name,
            c.created_at,
            c.updated_at
          having count(j.id) > 0
          order by
            c.full_name asc nulls last,
            c.id desc
          limit 500
        `,
        [tenant.id, view]
      )

      return reply.send({
        ok: true,
        source: "contractor-navigator",
        view,
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
        },
        customers: result.rows.map((row) => ({
          id: Number(row.id),
          name: row.full_name || null,
          jobs_count: Number(row.jobs_count || 0),
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
        })),
      })
    }
  )

  app.get(
    "/integrations/financial-operations/:tenantSlug/customers/:customerId",
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

      const customerId = Number(
        request.params?.customerId
      )

      const view =
        String(request.query?.view || "active")
          .trim()
          .toLowerCase() === "archived"
          ? "archived"
          : "active"

      if (
        !Number.isInteger(customerId) ||
        customerId <= 0
      ) {
        return reply.code(400).send({
          ok: false,
          error: "Valid customerId is required",
        })
      }

      const tenant = await getTenantBySlug(tenantSlug)

      if (!tenant) {
        return reply.code(404).send({
          ok: false,
          error: "Tenant not found",
        })
      }

      const customerResult = await pool.query(
        `
          select
            id,
            full_name,
            created_at,
            updated_at
          from customers
          where tenant_id = $1
            and id = $2
          limit 1
        `,
        [tenant.id, customerId]
      )

      if (!customerResult.rowCount) {
        return reply.code(404).send({
          ok: false,
          error: "Customer not found",
        })
      }

      const jobsResult = await pool.query(
        `
          select
            id,
            external_job_id,
            stage,
            job_type,
            address1,
            city,
            state,
            zip,
            created_at,
            updated_at
          from jobs
          where tenant_id = $1
            and customer_id = $2
            and (
              ($3 = 'archived' and stage = 'archived')
              or
              (
                $3 = 'active'
                and coalesce(stage, '') <> 'archived'
              )
            )
          order by id desc
          limit 200
        `,
        [tenant.id, customerId, view]
      )

      const customer = customerResult.rows[0]

      return reply.send({
        ok: true,
        source: "contractor-navigator",
        view,
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
        },
        customer: {
          id: Number(customer.id),
          name: customer.full_name || null,
          created_at: customer.created_at || null,
          updated_at: customer.updated_at || null,
        },
        jobs: jobsResult.rows.map((job) => ({
          id: Number(job.id),
          external_job_id: job.external_job_id || null,
          stage: job.stage || null,
          job_type: job.job_type || null,
          address1: job.address1 || null,
          city: job.city || null,
          state: job.state || null,
          zip: job.zip || null,
          created_at: job.created_at || null,
          updated_at: job.updated_at || null,
        })),
      })
    }
  )

}
