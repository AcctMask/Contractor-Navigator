import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { clearPhoneDnc, isPhoneDnc, markPhoneAsDnc } from "../services/dncService"
import { getTenantIdBySlug } from "../services/followupEngine"

async function getJobRow(tenantId: number, jobId: number) {
  const result = await pool.query(
    `
    select
      j.id,
      j.tenant_id,
      j.customer_id,
      j.stage,
      j.crm_substatus,
      j.crm_flow_key,
      j.bot_paused,
      j.address1,
      j.city,
      j.state,
      j.zip,
      c.full_name as customer_name,
      c.phone as customer_phone
    from jobs j
    left join customers c
      on c.id = j.customer_id
     and c.tenant_id = j.tenant_id
    where j.tenant_id = $1
      and j.id = $2
    limit 1
    `,
    [tenantId, jobId]
  )

  if (!result.rowCount) {
    throw new Error("Job not found")
  }

  return result.rows[0]
}

async function addTimelineEvent(
  tenantId: number,
  jobId: number,
  kind: string,
  message: string,
  meta: Record<string, unknown> = {}
) {
  await pool.query(
    `
    insert into timeline_events
      (tenant_id, job_id, kind, message, meta, created_at)
    values
      ($1, $2, $3, $4, $5::jsonb, now())
    `,
    [tenantId, jobId, kind, message, JSON.stringify(meta)]
  )
}

export async function registerJobControlsRoutes(app: FastifyInstance) {
  app.get("/admin/:tenantSlug/jobs/:jobId/control", async (request: any, reply) => {
    try {
      const { tenantSlug, jobId } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const job = await getJobRow(tenantId, Number(jobId))
      const dnc = await isPhoneDnc(tenantId, job.customer_phone)

      return {
        ok: true,
        job: {
          ...job,
          is_dnc: dnc,
        },
      }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.post("/admin/:tenantSlug/jobs/:jobId/stage", async (request: any, reply) => {
    try {
      const { tenantSlug, jobId } = request.params
      const { stage, crm_substatus, bot_paused } = request.body || {}
      const tenantId = await getTenantIdBySlug(tenantSlug)

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
        [tenantId, Number(jobId), stage || null, crm_substatus || null, typeof bot_paused === "boolean" ? bot_paused : null]
      )

      await addTimelineEvent(
        tenantId,
        Number(jobId),
        "manual_stage_updated",
        `Job manually moved to stage ${stage || "unchanged"}`,
        {
          stage: stage || null,
          crm_substatus: crm_substatus || null,
          bot_paused: typeof bot_paused === "boolean" ? bot_paused : null,
          source: "staff_ui",
        }
      )

      return { ok: true }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.post("/admin/:tenantSlug/jobs/:jobId/dnc", async (request: any, reply) => {
    try {
      const { tenantSlug, jobId } = request.params
      const { is_dnc, note } = request.body || {}
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const job = await getJobRow(tenantId, Number(jobId))

      if (!job.customer_phone) {
        throw new Error("Customer phone missing on this job")
      }

      if (is_dnc) {
        await markPhoneAsDnc(tenantId, job.customer_phone, {
          customerId: job.customer_id ? Number(job.customer_id) : null,
          source: "staff_ui",
          note: note || "Marked DNC from staff UI",
        })

        await pool.query(
          `
          update jobs
          set
            crm_substatus = 'dnc',
            crm_flow_key = 'manual_or_auto_dnc',
            bot_paused = true,
            updated_at = now()
          where tenant_id = $1
            and id = $2
          `,
          [tenantId, Number(jobId)]
        )

        await addTimelineEvent(
          tenantId,
          Number(jobId),
          "dnc_marked",
          "Customer marked DNC by staff",
          {
            source: "staff_ui",
            note: note || null,
          }
        )
      } else {
        await clearPhoneDnc(tenantId, job.customer_phone, {
          customerId: job.customer_id ? Number(job.customer_id) : null,
          source: "staff_ui",
          note: note || "Removed DNC from staff UI",
        })

        await addTimelineEvent(
          tenantId,
          Number(jobId),
          "dnc_cleared",
          "Customer DNC cleared by staff",
          {
            source: "staff_ui",
            note: note || null,
          }
        )
      }

      return { ok: true }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })
}
