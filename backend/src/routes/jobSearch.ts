import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { getTenantIdBySlug } from "../services/followupEngine"
import { planFollowUps } from "../services/conversationEngine"
import { getCurrentUserFromToken } from "../services/authService"

// helper
function digitsOnly(value: string) {
  return value.replace(/\D/g, "")
}

function getBearerToken(request: any) {
  const auth = String(request.headers.authorization || "")
  return auth.startsWith("Bearer ") ? auth.slice(7) : ""
}

async function requireJobReadUser(
  request: any,
  reply: any,
  tenantId: number
) {
  const token = getBearerToken(request)

  if (!token) {
    reply.code(401)
    return null
  }

  try {
    const user = await getCurrentUserFromToken(token)

    if (!user?.is_active) {
      reply.code(401)
      return null
    }

    if (
      String(user.role) !== "platform_owner" &&
      Number(user.tenant_id) !== tenantId
    ) {
      reply.code(403)
      return null
    }

    return user
  } catch {
    reply.code(401)
    return null
  }
}

async function ensureCrewAssignmentUserColumn() {
  await pool.query(`
    alter table crew_assignments
    add column if not exists app_user_id bigint null
  `)

  await pool.query(`
    create index if not exists idx_crew_assignments_tenant_user
    on crew_assignments (tenant_id, app_user_id)
  `)
}

export async function registerJobSearchRoutes(app: FastifyInstance) {

  // 🔍 SEARCH
  app.get("/admin/:tenantSlug/job-search", async (request: any, reply) => {
    try {
      const { tenantSlug } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const user = await requireJobReadUser(request, reply, tenantId)

      if (!user) {
        return { ok: false, error: "Not authorized" }
      }

      await ensureCrewAssignmentUserColumn()

      const q = String(request.query.q || "").trim()
      const digitQ = digitsOnly(q)
      const numericId = /^\d+$/.test(q) ? Number(q) : null

      if (!q) return { ok: true, results: [] }

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
            $5::text <> 'subcontractor'
            or exists (
              select 1
              from crew_assignments ca
              where ca.tenant_id = j.tenant_id
                and ca.job_id = j.id
                and ca.app_user_id = $6
            )
          )
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
        [
          tenantId,
          q,
          digitQ,
          numericId,
          String(user.role),
          Number(user.id)
        ]
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
      const user = await requireJobReadUser(request, reply, tenantId)

      if (!user) {
        return { ok: false, error: "Not authorized" }
      }

      await ensureCrewAssignmentUserColumn()

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
            $2::text <> 'subcontractor'
            or exists (
              select 1
              from crew_assignments ca
              where ca.tenant_id = j.tenant_id
                and ca.job_id = j.id
                and ca.app_user_id = $3
            )
          )
        order by j.id desc
        limit 200
        `,
        [
          tenantId,
          String(user.role),
          Number(user.id)
        ]
      )

      return { ok: true, jobs: result.rows }

    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Load all failed" }
    }
  })


  // 📄 GET SINGLE JOB
  app.get("/admin/:tenantSlug/jobs/:jobId", async (request: any, reply) => {
    try {
      const { tenantSlug, jobId } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const user = await requireJobReadUser(request, reply, tenantId)

      if (!user) {
        return { ok: false, error: "Not authorized" }
      }

      await ensureCrewAssignmentUserColumn()

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
          j.carrier,
          j.claim_number,
          j.policy_holder,
          j.adjuster_name,
          j.adjuster_phone,
          j.adjuster_email,
          j.assignment_subject,
          j.assignment_notes,
          j.damage_location,
          j.damage_summary,
          j.wa_status,
          j.estimate_status,
          j.contract_status,
          j.lead_source,
          j.lead_source_detail,
          j.marketing_campaign,
          false as dnc,
          c.full_name as customer_name,
          c.phone as customer_phone,
          c.email as customer_email
        from jobs j
        left join customers c
          on c.id = j.customer_id
         and c.tenant_id = j.tenant_id
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
          tenantId,
          Number(jobId),
          String(user.role),
          Number(user.id)
        ]
      )

      if (!result.rowCount) {
        if (String(user.role) === "subcontractor") {
          reply.code(403)
          return { ok: false, error: "Job access denied" }
        }

        reply.code(404)
        return { ok: false, error: "Job not found" }
      }

      return { ok: true, job: result.rows[0] }

    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Load failed" }
    }
  })


  // 💾 SAVE STAGE (THIS FIXES YOUR STAGE ISSUE)
  app.post("/admin/:tenantSlug/jobs/:jobId/stage", async (request: any, reply) => {
    try {
      const { tenantSlug, jobId } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)

      const { stage, crm_substatus, bot_paused } = request.body || {}

      await pool.query(
        `
        update jobs
        set
          stage = coalesce($3, stage),
          crm_substatus = $4,
          bot_paused = coalesce($5, bot_paused),
          updated_at = now()
        where tenant_id = $1
          and id = $2
        `,
        [
          tenantId,
          Number(jobId),
          stage || null,
          crm_substatus || null,
          typeof bot_paused === "boolean" ? bot_paused : null,
        ]
      )

      if (stage && stage !== "tarp_complete") {
        await pool.query(
          `
          update scheduled_actions
          set
            status = 'cancelled',
            updated_at = now()
          where tenant_id = $1
            and job_id = $2
            and status = 'pending'
            and action_key = 'workflow_step'
            and coalesce(payload->>'workflow_key', '') = 'tarp_complete_roof_conversion'
          `,
          [
            tenantId,
            Number(jobId),
          ]
        )
      }

      if (stage) {
        await planFollowUps({
          tenant_id: tenantId,
          job_id: Number(jobId),
          stage,
          occurred_at: new Date().toISOString(),
        })

        await pool.query(
          `
          insert into timeline_events
            (tenant_id, job_id, kind, message, meta, created_at)
          values
            ($1, $2, 'workflow_planned', $3, $4::jsonb, now())
          `,
          [
            tenantId,
            Number(jobId),
            `follow-ups scheduled for stage=${stage}`,
            JSON.stringify({ stage, source: "manual_stage_save" }),
          ]
        )
      }

      return { ok: true }

    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Save failed" }
    }
  })
}
