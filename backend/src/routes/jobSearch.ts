import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { getTenantIdBySlug } from "../services/followupEngine"
import {
  createDocumentPackageByTenantSlug,
  sendDocumentPackage,
  setEmergencyTarpNeededByTenantSlug,
} from "../services/documentPipelineService"
import { getCurrentUserFromToken } from "../services/authService"
import {
  getDeveloperSettingsByTenantSlug,
  getStageFollowupConfig,
} from "../services/devSettingsService"
import { sendAlertEmail } from "../services/emailService"

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

async function ensureProductionPlannerExplanationColumn() {
  await pool.query(`
    alter table jobs
    add column if not exists production_planner_explanation text
  `)
}

async function ensureCurrentStageEnteredAtColumn() {
  await pool.query(`
    alter table jobs
    add column if not exists current_stage_entered_at timestamptz
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


  // 🔎 STAGE SINCE — READ-ONLY HISTORICAL RECOVERY PREVIEW
  app.get(
    "/admin/:tenantSlug/production-planner/stage-since-preview",
    async (request: any, reply) => {
      try {
        const { tenantSlug } = request.params
        const tenantId = await getTenantIdBySlug(tenantSlug)
        const user = await requireJobReadUser(request, reply, tenantId)

        if (!user) {
          return { ok: false, error: "Not authorized" }
        }

        const result = await pool.query(
          `
            with planner_jobs as (
              select
                j.id,
                j.stage,
                j.current_stage_entered_at,
                c.full_name as customer_name
              from jobs j
              left join customers c
                on c.id = j.customer_id
               and c.tenant_id = j.tenant_id
              where j.tenant_id = $1
                and j.stage in (
                  'inspection',
                  'estimate_needed',
                  'contract_signed',
                  'pre_production',
                  'tarp',
                  'in_production'
                )
            ),

            manual_stage_evidence as (
              select distinct on (te.job_id)
                te.job_id,
                te.created_at as candidate_stage_since,
                'manual_stage_updated'::text as evidence_source
              from timeline_events te
              join planner_jobs pj
                on pj.id = te.job_id
              where te.tenant_id = $1
                and te.kind = 'manual_stage_updated'
                and te.meta->>'stage' = pj.stage
              order by te.job_id, te.created_at desc
            ),

            calendar_stage_evidence as (
              select distinct on (te.job_id)
                te.job_id,
                coalesce(
                  nullif(te.meta->>'start_time', '')::timestamptz,
                  te.created_at
                ) as candidate_stage_since,
                te.kind::text as evidence_source
              from timeline_events te
              join planner_jobs pj
                on pj.id = te.job_id
              where te.tenant_id = $1
                and te.kind in (
                  'calendar_stage_event_created',
                  'calendar_stage_event_rescheduled'
                )
                and te.meta->>'stage' = pj.stage
              order by te.job_id, te.created_at desc
            ),

            candidates as (
              select * from manual_stage_evidence
              union all
              select * from calendar_stage_evidence
            ),

            best_candidate as (
              select distinct on (job_id)
                job_id,
                candidate_stage_since,
                evidence_source
              from candidates
              order by
                job_id,
                candidate_stage_since desc
            )

            select
              pj.id as job_id,
              pj.customer_name,
              pj.stage as current_stage,
              pj.current_stage_entered_at as current_stage_since,
              bc.candidate_stage_since as recoverable_stage_since,
              bc.evidence_source,
              case
                when pj.current_stage_entered_at is not null
                  then 'ALREADY_PRESENT'
                when bc.candidate_stage_since is not null
                  then 'RECOVERABLE'
                else 'UNKNOWN'
              end as recovery_status
            from planner_jobs pj
            left join best_candidate bc
              on bc.job_id = pj.id
            order by
              case pj.stage
                when 'inspection' then 1
                when 'estimate_needed' then 2
                when 'contract_signed' then 3
                when 'pre_production' then 4
                when 'tarp' then 5
                when 'in_production' then 6
                else 99
              end,
              bc.candidate_stage_since nulls first,
              pj.id
          `,
          [tenantId]
        )

        const summary = result.rows.reduce(
          (acc: Record<string, number>, row: any) => {
            const key = String(row.recovery_status || "UNKNOWN")
            acc[key] = (acc[key] || 0) + 1
            return acc
          },
          {}
        )

        return {
          ok: true,
          tenant_slug: tenantSlug,
          read_only: true,
          total_jobs: result.rowCount || 0,
          summary,
          jobs: result.rows,
        }
      } catch (err: any) {
        reply.code(400)
        return {
          ok: false,
          error: err?.message || "Stage Since preview failed",
        }
      }
    }
  )

  // 🏗️ PRODUCTION PLANNER — READ-ONLY FIELD PRODUCTION PROJECTION
  app.get("/admin/:tenantSlug/production-planner", async (request: any, reply) => {
    try {
      const { tenantSlug } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const user = await requireJobReadUser(request, reply, tenantId)

      if (!user) {
        return { ok: false, error: "Not authorized" }
      }

      await ensureCrewAssignmentUserColumn()
      await ensureProductionPlannerExplanationColumn()
      await ensureCurrentStageEnteredAtColumn()

      const result = await pool.query(
        `
          select
            j.id,
            j.address1,
            j.city,
            j.state,
            j.zip,
            j.stage,
            j.production_planner_explanation,
            c.full_name as customer_name,
            c.phone as customer_phone,
            c.email as customer_email,

            j.current_stage_entered_at as stage_since,

            crew.crew_name,
            crew.app_user_id as crew_app_user_id,
            crew.assigned_at as crew_assigned_at

          from jobs j

          left join customers c
            on c.id = j.customer_id
           and c.tenant_id = j.tenant_id



          left join lateral (
            select
              ca.crew_name,
              ca.app_user_id,
              ca.assigned_at
            from crew_assignments ca
            where ca.tenant_id = j.tenant_id
              and ca.job_id = j.id
              and coalesce(ca.status, 'active') = 'active'
            order by ca.assigned_at desc nulls last, ca.id desc
            limit 1
          ) crew on true

          where j.tenant_id = $1
            and j.stage in (
              'inspection',
              'estimate_needed',
              'contract_signed',
              'pre_production',
              'tarp',
              'in_production'
            )
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

          order by
            j.current_stage_entered_at asc nulls first,
            j.id asc
        `,
        [
          tenantId,
          String(user.role),
          Number(user.id),
        ]
      )

      return { ok: true, jobs: result.rows }
    } catch (err: any) {
      reply.code(400)
      return {
        ok: false,
        error: err?.message || "Load production planner failed",
      }
    }
  })

  app.post(
    "/admin/:tenantSlug/jobs/:jobId/production-planner-explanation",
    async (request: any, reply) => {
      const client = await pool.connect()

      try {
        const { tenantSlug, jobId } = request.params
        const tenantId = await getTenantIdBySlug(tenantSlug)
        const actor = await requireJobReadUser(request, reply, tenantId)

        if (!actor) {
          client.release()
          return { ok: false, error: "Not authorized" }
        }

        const numericJobId = Number(jobId)

        if (!Number.isFinite(numericJobId)) {
          client.release()
          reply.code(400)
          return { ok: false, error: "Invalid job id" }
        }

        const rawExplanation =
          typeof request.body?.explanation === "string"
            ? request.body.explanation.trim()
            : ""

        const nextExplanation = rawExplanation || null

        await ensureProductionPlannerExplanationColumn()
        await client.query("begin")

        const current = await client.query(
          `
            select
              id,
              stage,
              production_planner_explanation
            from jobs
            where tenant_id = $1
              and id = $2
            for update
          `,
          [tenantId, numericJobId]
        )

        if (!current.rows.length) {
          await client.query("rollback")
          client.release()
          reply.code(404)
          return { ok: false, error: "Job not found" }
        }

        const currentStage = String(current.rows[0].stage || "")

        const plannerStages = new Set([
          "inspection",
          "estimate_needed",
          "contract_signed",
          "pre_production",
          "tarp",
          "in_production",
        ])

        if (!plannerStages.has(currentStage)) {
          await client.query("rollback")
          client.release()
          reply.code(400)
          return {
            ok: false,
            error: "Job is not in a Production Planner stage",
          }
        }

        const previousExplanation =
          typeof current.rows[0].production_planner_explanation === "string"
            ? current.rows[0].production_planner_explanation.trim() || null
            : null

        if (previousExplanation === nextExplanation) {
          await client.query("commit")
          client.release()

          return {
            ok: true,
            changed: false,
            production_planner_explanation: nextExplanation,
          }
        }

        await client.query(
          `
            update jobs
            set production_planner_explanation = $3
            where tenant_id = $1
              and id = $2
          `,
          [tenantId, numericJobId, nextExplanation]
        )

        const previousDisplay =
          previousExplanation || "No production explanation"

        const nextDisplay =
          nextExplanation || "No production explanation"

        await client.query(
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
                $2,
                'production_planner_explanation_updated',
                $3,
                $4::jsonb,
                now()
              )
          `,
          [
            tenantId,
            numericJobId,
            `Production update: ${previousDisplay} → ${nextDisplay}`,
            JSON.stringify({
              previous_explanation: previousExplanation,
              explanation: nextExplanation,
              stage: currentStage,
              actor_user_id: actor.id,
              actor_email: actor.email || null,
              actor_name: actor.full_name || actor.email || null,
              source: "staff_ui",
            }),
          ]
        )

        await client.query("commit")
        client.release()

        return {
          ok: true,
          changed: true,
          production_planner_explanation: nextExplanation,
        }
      } catch (err: any) {
        try {
          await client.query("rollback")
        } catch {}

        client.release()

        reply.code(400)
        return {
          ok: false,
          error:
            err?.message || "Update production planner explanation failed",
        }
      }
    }
  )

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

      const actor = await requireJobReadUser(
        request,
        reply,
        tenantId
      )

      if (!actor) {
        return { ok: false, error: "Not authorized" }
      }

      const {
        stage,
        crm_substatus,
        bot_paused,
        bot_pause_reason,
      } = request.body || {}

      const requestedPauseReason =
        String(bot_pause_reason || "").trim()
      const previousStageResult = await pool.query(
        `
        select
          stage,
          bot_paused
        from jobs
        where tenant_id = $1
          and id = $2
        limit 1
        `,
        [tenantId, Number(jobId)]
      )

      if (!previousStageResult.rowCount) {
        throw new Error("Job not found")
      }

      const previousStage =
        String(previousStageResult.rows[0]?.stage || "").trim()

      const previousBotPaused =
        Boolean(previousStageResult.rows[0]?.bot_paused)

      const nextStage =
        String(stage || previousStage || "").trim()

      const realStageTransition =
        Boolean(stage) && nextStage !== previousStage

      const intentionalPause =
        previousBotPaused === false &&
        bot_paused === true

      const intentionalUnpause =
        previousBotPaused === true &&
        bot_paused === false

      if (intentionalPause && !requestedPauseReason) {
        reply.code(400)

        return {
          ok: false,
          error: "Pause reason is required when pausing AI Follow-Up",
        }
      }

      if (stage === "wa_sent" && previousStage !== "wa_sent") {
        await setEmergencyTarpNeededByTenantSlug(
          tenantSlug,
          Number(jobId),
          true
        )

        const documentPackage =
          await createDocumentPackageByTenantSlug(
            tenantSlug,
            Number(jobId),
            "ems_tarp"
          )

        await sendDocumentPackage(
          tenantSlug,
          Number(jobId),
          Number(documentPackage.id)
        )
      }

      await pool.query(
        `
        update jobs
        set
          stage = coalesce($3, stage),
          crm_substatus =
            case
              when $3 = 'wa_sent'
               and nullif(btrim(coalesce($4::text, '')), '') is null
                then coalesce(crm_substatus, 'ems_authorization_sent')
              else $4
            end,
          bot_paused = coalesce($5, bot_paused),

          bot_pause_reason =
            case
              when $3 = 'disqualified'
                then 'disqualified'
              when $5 = true
                then coalesce(
                  nullif(btrim($6::text), ''),
                  bot_pause_reason
                )
              when $5 = false
                then null
              else bot_pause_reason
            end,


          tarp_conversion_active =
            case
              when $3 = 'tarp_complete'
                then true
              when $3 in (
                'estimate_sent',
                'contract_sent',
                'archived',
                'disqualified'
              )
                then false
              else tarp_conversion_active
            end,

          tarp_conversion_started_at =
            case
              when $3 = 'tarp_complete'
               and coalesce(tarp_conversion_active, false) = false
                then now()
              else tarp_conversion_started_at
            end,

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
          requestedPauseReason || null,
        ]
      )

      if (intentionalPause) {
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
              $2,
              'ai_followup_paused',
              $3,
              $4::jsonb,
              now()
            )
          `,
          [
            tenantId,
            Number(jobId),
            `AI Follow-Up paused — ${requestedPauseReason}`,
            JSON.stringify({
              reason: requestedPauseReason,
              actor_user_id: actor.id,
              actor_email: actor.email || null,
              actor_name: actor.full_name || actor.email || null,
              source: "staff_ui",
            }),
          ]
        )
      }

      if (intentionalUnpause) {
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
              $2,
              'ai_followup_unpaused',
              'AI Follow-Up unpaused',
              $3::jsonb,
              now()
            )
          `,
          [
            tenantId,
            Number(jobId),
            JSON.stringify({
              actor_user_id: actor.id,
              actor_email: actor.email || null,
              actor_name: actor.full_name || actor.email || null,
              source: "staff_ui",
            }),
          ]
        )
      }

      let restartedFollowupWorkflow = ""
      let restartedFollowupMessage1 = ""

      if (intentionalUnpause && !realStageTransition) {
        const workflowState = await pool.query(
          `
          select active_followup_workflow
          from jobs
          where tenant_id = $1
            and id = $2
          limit 1
          `,
          [tenantId, Number(jobId)]
        )

        const activeWorkflow =
          String(
            workflowState.rows[0]?.active_followup_workflow || ""
          ).trim()

        if (activeWorkflow) {
          const settings =
            await getDeveloperSettingsByTenantSlug(tenantSlug)

          const configuration =
            getStageFollowupConfig(settings, activeWorkflow)

          const messages =
            (configuration?.messages || [])
              .map((value: any) =>
                String(value || "").trim()
              )
              .filter(Boolean)

          const timings =
            configuration?.timings_minutes || []

          if (messages.length > 0 && timings.length > 0) {
            await pool.query(
              `
              update jobs
              set
                followup_workflow_started_at = now(),
                updated_at = now()
              where tenant_id = $1
                and id = $2
              `,
              [tenantId, Number(jobId)]
            )

            restartedFollowupWorkflow = activeWorkflow
            restartedFollowupMessage1 = messages[0]
          }
        }
      }

      if (
        realStageTransition &&
        tenantSlug === "g2g-roofing"
      ) {
        await pool.query(
          `
          update scheduled_actions
          set
            status = 'cancelled',
            updated_at = now()
          where tenant_id = $1
            and job_id = $2
            and action_key = 'g2g_estimate_needed_reminder'
            and status = 'pending'
          `,
          [tenantId, Number(jobId)]
        )

        if (nextStage === "estimate_needed") {
          const notificationContext = await pool.query(
            `
            select
              j.id,
              j.external_job_id,
              j.zip,
              c.full_name as customer_name
            from jobs j
            left join customers c
              on c.id = j.customer_id
             and c.tenant_id = j.tenant_id
            where j.tenant_id = $1
              and j.id = $2
            limit 1
            `,
            [tenantId, Number(jobId)]
          )

          const notificationJob =
            notificationContext.rows[0] || {}

          const recipient =
            String(
              process.env.G2G_GMAIL_TO ||
              process.env.ALERT_EMAIL_TO ||
              ""
            ).trim()

          const customerName =
            String(
              notificationJob.customer_name ||
              `Job #${jobId}`
            ).trim()

          const jobReference =
            String(
              notificationJob.external_job_id ||
              jobId
            ).trim()

          if (recipient) {
            const emailResult = await sendAlertEmail(
              recipient,
              `Estimate Needed: ${customerName}`,
              [
                "Good2Go has a job that needs an estimate.",
                "",
                `Customer: ${customerName}`,
                `Job: ${jobReference}`,
                `ZIP: ${notificationJob.zip || "Not supplied"}`,
                "",
                "This is the initial Estimate Needed request.",
              ].join("\n")
            )

            const notificationSent =
              Boolean(emailResult?.ok)

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
                  $2,
                  $3,
                  $4,
                  $5::jsonb,
                  now()
                )
              `,
              [
                tenantId,
                Number(jobId),
                notificationSent
                  ? "estimate_needed_notification_sent"
                  : "estimate_needed_notification_failed",
                notificationSent
                  ? "Estimate Needed notification #1 sent to Good2Go."
                  : "Estimate Needed notification #1 failed; reminder cycle remains scheduled.",
                JSON.stringify({
                  request_number: 1,
                  recipient,
                  source: "navigator_system",
                  email_result: emailResult,
                }),
              ]
            )
          } else {
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
                  $2,
                  'estimate_needed_notification_skipped',
                  $3,
                  $4::jsonb,
                  now()
                )
              `,
              [
                tenantId,
                Number(jobId),
                "Estimate Needed notification skipped because no Good2Go notification recipient is configured.",
                JSON.stringify({
                  request_number: 1,
                  source: "navigator_system",
                }),
              ]
            )
          }

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
                $2,
                'g2g_estimate_needed_reminder',
                now() + interval '48 hours',
                'pending',
                $3::jsonb,
                now(),
                now()
              )
            `,
            [
              tenantId,
              Number(jobId),
              JSON.stringify({
                request_number: 2,
                tenant_slug: tenantSlug,
              }),
            ]
          )
        }
      }

      if (realStageTransition) {
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
              $2,
              'manual_stage_updated',
              $3,
              $4::jsonb,
              now()
            )
          `,
          [
            tenantId,
            Number(jobId),
            `Stage changed: ${previousStage || "none"} → ${nextStage}`,
            JSON.stringify({
              previous_stage: previousStage || null,
              stage: nextStage,
              actor_user_id: actor.id,
              actor_email: actor.email || null,
              actor_name: actor.full_name || actor.email || null,
              source: "staff_ui",
            }),
          ]
        )

        const workflowState = await pool.query(
          `
          select
            active_followup_workflow,
            followup_workflow_started_at
          from jobs
          where tenant_id = $1
            and id = $2
          limit 1
          `,
          [tenantId, Number(jobId)]
        )

        const activeWorkflow =
          String(
            workflowState.rows[0]?.active_followup_workflow || ""
          ).trim()

        if (activeWorkflow === nextStage) {
          const settings =
            await getDeveloperSettingsByTenantSlug(tenantSlug)

          const configuration =
            getStageFollowupConfig(settings, activeWorkflow)

          const messages =
            (configuration?.messages || [])
              .map((value: any) =>
                String(value || "").trim()
              )
              .filter(Boolean)

          const message1 = messages[0] || ""

          const currentPauseState = await pool.query(
            `
            select bot_paused
            from jobs
            where tenant_id = $1
              and id = $2
            limit 1
            `,
            [tenantId, Number(jobId)]
          )

          const workflowPaused =
            Boolean(currentPauseState.rows[0]?.bot_paused)

          const activityKind =
            workflowPaused
              ? "ai_followup_workflow_ready_paused"
              : "ai_followup_workflow_started"

          const activityMessage =
            workflowPaused
              ? `AI Follow-Up ready for ${nextStage} — currently paused${message1 ? ` — Message 1: ${message1}` : ""}`
              : `AI Follow-Up started: ${nextStage}${message1 ? ` — Message 1: ${message1}` : " — beginning at Message 1"}`

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
                $2,
                $3,
                $4,
                $5::jsonb,
                now()
              )
            `,
            [
              tenantId,
              Number(jobId),
              activityKind,
              activityMessage,
              JSON.stringify({
                stage: nextStage,
                previous_stage: previousStage || null,
                source: "stage_transition",
                restart_from_message: 1,
                message_1: message1 || null,
                paused: workflowPaused,
              }),
            ]
          )

          if (!workflowPaused) {
            const alertEmail =
              String(settings.alert_email_to || "").trim()

            if (alertEmail) {
              await sendAlertEmail(
                alertEmail,
                `AI Follow-Up Started — Job #${jobId} — ${nextStage}`,
                [
                  "Navigator started an AI Follow-Up workflow.",
                  "",
                  `Job ID: ${jobId}`,
                  `Previous Stage: ${previousStage || "none"}`,
                  `New Stage: ${nextStage}`,
                  `Staff Action By: ${actor.full_name || actor.email || "Authenticated Staff"}`,
                  "",
                  "AI Follow-Up has started from Message 1.",
                  "Customer Message 1 remains scheduled according to this workflow's configured timing sequence.",
                ].join("\n")
              )
            }
          }
        }
      }

      if (
        intentionalUnpause &&
        !realStageTransition &&
        restartedFollowupWorkflow
      ) {
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
              $2,
              'ai_followup_workflow_restarted',
              $3,
              $4::jsonb,
              now()
            )
          `,
          [
            tenantId,
            Number(jobId),
            `AI Follow-Up restarted after pause: ${restartedFollowupWorkflow} — Message 1: ${restartedFollowupMessage1}`,
            JSON.stringify({
              workflow: restartedFollowupWorkflow,
              current_stage: nextStage || null,
              source: "bot_unpause",
              restart_from_message: 1,
              message_1: restartedFollowupMessage1,
            }),
          ]
        )

        const restartSettings =
          await getDeveloperSettingsByTenantSlug(tenantSlug)

        const restartAlertEmail =
          String(restartSettings.alert_email_to || "").trim()

        if (restartAlertEmail) {
          await sendAlertEmail(
            restartAlertEmail,
            `AI Follow-Up Restarted — Job #${jobId} — ${restartedFollowupWorkflow}`,
            [
              "Navigator restarted an AI Follow-Up workflow.",
              "",
              `Job ID: ${jobId}`,
              `Workflow: ${restartedFollowupWorkflow}`,
              `Staff Action By: ${actor.full_name || actor.email || "Authenticated Staff"}`,
              "",
              "Bot was unpaused.",
              "AI Follow-Up restarted from Message 1.",
              "Customer Message 1 remains scheduled according to this workflow's configured timing sequence.",
            ].join("\n")
          )
        }
      }

      if (stage && ["archived", "disqualified"].includes(stage)) {
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


      return { ok: true }

    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Save failed" }
    }
  })
}
