import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { getTenantIdBySlug } from "../services/followupEngine"

function digitsOnly(value: string) {
  return value.replace(/\D/g, "")
}

export async function registerJobSearchRoutes(app: FastifyInstance) {

  // 🔍 SEARCH JOBS (FIXED + TENANT FILTERED)
  app.get("/admin/:tenantSlug/job-search", async (request: any, reply) => {
    try {
      const { tenantSlug } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)

      const q = String(request.query.q || "").trim()
      const digitQ = digitsOnly(q)
      const numericId = /^\d+$/.test(q) ? Number(q) : null

      if (!q) {
        return { ok: true, results: [] }
      }

      const result = await pool.query(
        `
        select
          j.id,
          j.address1,
          j.city,
          j.state,
          j.zip,
          j.stage,
          c.full_name as customer_name,
          c.phone as customer_phone,
          c.email as customer_email
        from jobs j
        left join customers c
          on c.id = j.customer_id
         and c.tenant_id = j.tenant_id
        where j.tenant_id = $1
          and (
            coalesce(c.full_name, '') ilike '%' || $2 || '%'
            or coalesce(c.email, '') ilike '%' || $2 || '%'
            or coalesce(c.phone, '') ilike '%' || $2 || '%'
            or ($3 <> '' and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || $3 || '%')
            or coalesce(j.address1, '') ilike '%' || $2 || '%'
            or coalesce(j.city, '') ilike '%' || $2 || '%'
            or coalesce(j.state, '') ilike '%' || $2 || '%'
            or coalesce(j.zip, '') ilike '%' || $2 || '%'
            or ($4::bigint is not null and j.id = $4::bigint)
          )
        order by j.id desc
        limit 50
        `,
        [tenantId, q, digitQ, numericId]
      )

      return { ok: true, results: result.rows }

    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Search failed" }
    }
  })


  // 📋 LOAD ALL JOBS
  app.get("/admin/:tenantSlug/jobs-all", async (request: any, reply) => {
    try {
      const { tenantSlug } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)

      const result = await pool.query(
        `
        select
          j.id,
          j.address1,
          j.city,
          j.state,
          j.zip,
          j.stage,
          c.full_name as customer_name,
          c.phone as customer_phone,
          c.email as customer_email
        from jobs j
        left join customers c
          on c.id = j.customer_id
         and c.tenant_id = j.tenant_id
        where j.tenant_id = $1
        order by j.id desc
        limit 200
        `,
        [tenantId]
      )

      return { ok: true, jobs: result.rows }

    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Load all failed" }
    }
  })


  // 📄 LOAD SINGLE JOB
  app.get("/admin/:tenantSlug/jobs/:jobId", async (request: any, reply) => {
    try {
      const { tenantSlug, jobId } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)

      const result = await pool.query(
        `
select
  j.id,
  j.stage,
  j.crm_substatus,
  j.address1,
  j.city,
  j.state,
  j.zip,
  j.bot_paused,
  false as dnc,
  c.full_name as customer_name,
  c.email as customer_email
from jobs j
left join customers c
  on c.id = j.customer_id
 and c.tenant_id = j.tenant_id
where j.tenant_id = $1
  and j.id = $2
limit 1        `,
        [tenantId, Number(jobId)]
      )

      if (!result.rowCount) {
        throw new Error("Job not found")
      }

      return { ok: true, job: result.rows[0] }

    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Load failed" }
    }
  })


  // ➕ CREATE JOB
  app.post("/admin/:tenantSlug/jobs", async (request: any, reply) => {
    try {
      const { tenantSlug } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)

      const body = request.body || {}

      const customerName = body.customer_name || "Unknown"
      const customerPhone = body.customer_phone || null
      const customerEmail = body.customer_email || null

      if (!customerName && !customerPhone) {
        throw new Error("Customer name or phone required")
      }

      // Create customer
      const customerResult = await pool.query(
        `
        insert into customers
          (tenant_id, full_name, phone, email, created_at, updated_at)
        values
          ($1, $2, $3, $4, now(), now())
        returning id
        `,
        [tenantId, customerName, customerPhone, customerEmail]
      )

      const customerId = customerResult.rows[0].id

      // Create job
      const jobResult = await pool.query(
        `
        insert into jobs
          (tenant_id, customer_id, stage, address1, city, state, zip, created_at, updated_at)
        values
          ($1, $2, $3, $4, $5, $6, $7, now(), now())
        returning id
        `,
        [
          tenantId,
          customerId,
          body.stage || "lead",
          body.address1 || null,
          body.city || null,
          body.state || null,
          body.zip || null
        ]
      )

      return { ok: true, job_id: jobResult.rows[0].id }

    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Create job failed" }
    }
  })
}
