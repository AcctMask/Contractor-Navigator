import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"

function digitsOnly(value: string) {
  return value.replace(/\D/g, "")
}

export async function registerJobSearchRoutes(app: FastifyInstance) {
  // SEARCH (name, phone, address, city, state, zip, OR job id)
  app.get("/jobs/search", async (request: any, reply) => {
    try {
      const q = (request.query.q || "").toString().trim()

      if (!q) {
        return { ok: true, results: [] }
      }

      const digitQ = digitsOnly(q)
      const numericQ = /^\d+$/.test(q) ? Number(q) : null
      const isJobIdSearch = numericQ !== null

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
          c.phone as customer_phone
        from jobs j
        left join customers c
          on c.id = j.customer_id
         and c.tenant_id = j.tenant_id
        where
          (
            $1::text <> '' and (
              coalesce(c.full_name, '') ilike '%' || $1 || '%'
              or coalesce(c.phone, '') ilike '%' || $1 || '%'
              or regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || $2 || '%'
              or coalesce(j.address1, '') ilike '%' || $1 || '%'
              or coalesce(j.city, '') ilike '%' || $1 || '%'
              or coalesce(j.state, '') ilike '%' || $1 || '%'
              or coalesce(j.zip, '') ilike '%' || $1 || '%'
              or (
                coalesce(j.address1, '') || ' ' ||
                coalesce(j.city, '') || ' ' ||
                coalesce(j.state, '') || ' ' ||
                coalesce(j.zip, '')
              ) ilike '%' || $1 || '%'
            )
          )
          or ($3::boolean = true and j.id = $4::bigint)
        order by j.id desc
        limit 25
        `,
        [q, digitQ, isJobIdSearch, numericQ]
      )

      return {
        ok: true,
        results: result.rows,
      }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Search failed" }
    }
  })

  // LOAD JOB BY ID
  app.get("/jobs/:jobId", async (request: any, reply) => {
    try {
      const jobId = Number(request.params.jobId)

      if (!jobId) {
        throw new Error("Job ID required")
      }

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
          j.dnc,
          c.full_name as customer_name,
          c.phone as customer_phone,
          c.email as customer_email
        from jobs j
        left join customers c
          on c.id = j.customer_id
         and c.tenant_id = j.tenant_id
        where j.id = $1
        limit 1
        `,
        [jobId]
      )

      if (!result.rowCount) {
        throw new Error("Job not found")
      }

      return {
        ok: true,
        job: result.rows[0],
      }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Load failed" }
    }
  })
}
