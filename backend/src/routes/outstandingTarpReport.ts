import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { getTenantIdBySlug } from "../services/followupEngine"
import { getCurrentUserFromToken } from "../services/authService"
import { sendOfficeTarpTest } from "../services/outstandingTarpEmail"

const MANAGEMENT = [
  "platform_owner", "tenant_admin", "admin", "manager",
]

function easternDay(value: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value)

  const get = (name: string) =>
    Number(parts.find((part) => part.type === name)?.value)

  return Date.UTC(get("year"), get("month") - 1, get("day"))
}

function ageDays(value: unknown): number | null {
  if (!value) return null
  const date = new Date(String(value))
  if (!Number.isFinite(date.getTime())) return null

  return Math.max(
    0,
    Math.floor(
      (easternDay(new Date()) - easternDay(date)) / 86400000
    )
  )
}

export async function registerOutstandingTarpReportRoutes(
  app: FastifyInstance
) {

  // Office-only manual email test.
  // No recurring schedule or subcontractor sends.
  app.post(
    "/admin/:tenantSlug/reports/outstanding-tarps-test-email",
    async (request: any, reply) => {
      try {
        const auth = String(request.headers.authorization || "")
        const token = auth.startsWith("Bearer ")
          ? auth.slice(7) : ""

        if (!token) {
          return reply.code(401).send({
            ok: false, error: "Authentication required",
          })
        }

        const actor = await getCurrentUserFromToken(token)

        if (!actor?.is_active ||
            !MANAGEMENT.includes(String(actor.role))) {
          return reply.code(403).send({
            ok: false, error: "Management access required",
          })
        }

        if (String(request.params.tenantSlug) !== "g2g-roofing") {
          return reply.code(403).send({
            ok: false, error: "Good2Go only",
          })
        }

        const tenantId = await getTenantIdBySlug("g2g-roofing")

        if (actor.role !== "platform_owner" &&
            Number(actor.tenant_id) !== tenantId) {
          return reply.code(403).send({
            ok: false, error: "Tenant access denied",
          })
        }

        const result = await sendOfficeTarpTest()

        if (!result.ok) {
          return reply.code(502).send({
            ok: false,
            error: result.error,
          })
        }

        return reply.send({
          ok: true,
          recipient: result.recipient,
          total: result.total,
          not_complete: result.not_complete,
          pending_photos: result.pending_photos,
          subcontractor_emails_sent: 0,
          daily_sending_enabled: false,
        })
      } catch (error) {
        request.log.error(error)
        return reply.code(500).send({
          ok: false,
          error: "Office tarp email test failed",
        })
      }
    }
  )

  // Preview only. No email, scheduler, mutations, or public access.
  app.get(
    "/admin/:tenantSlug/reports/outstanding-tarps-preview",
    async (request: any, reply) => {
      try {
        const token = String(
          request.headers.authorization || ""
        ).replace(/^Bearer /, "")

        if (!token) {
          return reply.code(401).send({
            ok: false, error: "Authentication required",
          })
        }

        const actor = await getCurrentUserFromToken(token)
        if (!actor?.is_active) {
          return reply.code(401).send({
            ok: false, error: "Authentication required",
          })
        }

        const tenantSlug = String(
          request.params.tenantSlug || ""
        )

        if (tenantSlug !== "g2g-roofing") {
          return reply.code(403).send({
            ok: false, error: "Good2Go report only",
          })
        }

        const tenantId = await getTenantIdBySlug(tenantSlug)

        if (actor.role !== "platform_owner" &&
            Number(actor.tenant_id) !== tenantId) {
          return reply.code(403).send({
            ok: false, error: "Tenant access denied",
          })
        }

        const management = MANAGEMENT.includes(String(actor.role))
        const subcontractor = actor.role === "subcontractor"

        if (!management && !subcontractor) {
          return reply.code(403).send({
            ok: false, error: "Role not authorized",
          })
        }

        const result = await pool.query(
          `
          select
            j.id as job_id,
            j.stage,
            j.address1,
            j.city,
            j.state,
            j.zip,
            c.full_name as customer_name,
            ca.app_user_id as subcontractor_user_id,
            sub.full_name as subcontractor_name,
            sub.email as subcontractor_email,
            ca.assigned_at,
            completion.completed_at,
            coalesce(photos.photo_count, 0) as sub_photo_count,
            coalesce(crew.assigned_crew, '') as assigned_crew,
            coalesce(exception.has_exception, false)
              as administrative_exception
          from jobs j
          left join customers c
            on c.id = j.customer_id
           and c.tenant_id = j.tenant_id
          left join crew_assignments ca
            on ca.tenant_id = j.tenant_id
           and ca.job_id = j.id
           and ca.status in ('PENDING', 'active')
          left join app_users sub
            on sub.id = ca.app_user_id
           and sub.tenant_id = j.tenant_id
           and sub.role = 'subcontractor'
           and sub.is_active = true
          left join lateral (
            select max(te.created_at) as completed_at
            from timeline_events te
            where te.tenant_id = j.tenant_id
              and te.job_id = j.id
              and te.kind = 'manual_stage_updated'
              and te.meta->>'action' in (
                'tarp_completed', 'tarp_administratively_closed'
              )
          ) completion on true
          left join lateral (
            select count(*)::int as photo_count
            from job_assets ja
            where ja.tenant_id = j.tenant_id
              and ja.job_id = j.id
              and ja.asset_type = 'photo'
          ) photos on true
          left join lateral (
            select string_agg(distinct m.full_name, ', ')
              as assigned_crew
            from workforce_crew_job_assignments a
            join workforce_crew_members m
              on m.id = a.crew_member_id
             and m.tenant_id = a.tenant_id
             and m.subcontractor_company_id =
                 a.subcontractor_company_id
             and m.is_active = true
            join subcontractor_company_users scu
              on scu.subcontractor_company_id =
                 a.subcontractor_company_id
             and scu.app_user_id = ca.app_user_id
            where a.tenant_id = j.tenant_id
              and a.job_id = j.id
              and a.status = 'active'
          ) crew on true
          left join lateral (
            select exists (
              select 1 from timeline_events te
              where te.tenant_id = j.tenant_id
                and te.job_id = j.id
                and te.kind = 'manual_stage_updated'
                and te.meta->>'action' =
                    'tarp_administratively_closed'
            ) as has_exception
          ) exception on true
          where j.tenant_id = $1
            and j.stage in ('tarp', 'tarp_complete')
            and ($2::boolean or ca.app_user_id = $3)
          order by j.id
          `,
          [tenantId, management, Number(actor.id)]
        )

        const rows = result.rows.map((row: any) => {
          const submitted = Number(row.sub_photo_count) > 0
          const age = ageDays(
            row.stage === "tarp"
              ? row.assigned_at
              : row.completed_at
          )

          const section = row.stage === "tarp"
            ? "tarps_assigned_not_complete"
            : submitted
              ? "sub_package_submitted"
              : "tarps_complete_photos_needed"

          return {
            job_id: Number(row.job_id),
            stage: row.stage,
            customer_name: row.customer_name,
            location: [
              row.address1, row.city, row.state, row.zip,
            ].filter(Boolean).join(", "),
            subcontractor_user_id: row.subcontractor_user_id,
            subcontractor_name: row.subcontractor_name,
            subcontractor_email: management
              ? row.subcontractor_email : undefined,
            assigned_crew: row.assigned_crew || null,
            assigned_at: row.assigned_at,
            completed_at: row.completed_at,
            days_outstanding: age,
            subcontractor_photos: Number(row.sub_photo_count),
            administrative_exception: row.administrative_exception,
            section,
            job_url: `/job/${row.job_id}`,
          }
        })

        const group = (name: string) =>
          rows.filter((row: any) => row.section === name)
            .sort((a: any, b: any) =>
              (b.days_outstanding ?? -1) -
              (a.days_outstanding ?? -1) ||
              a.job_id - b.job_id
            )

        return reply.send({
          ok: true,
          preview_only: true,
          emails_enabled: false,
          tenant_slug: tenantSlug,
          report_scope: management ? "office_master" : "my_assignments",
          as_of: new Date().toISOString(),
          definitions: {
            sub_package_submitted:
              "PROVISIONAL: At least one job photo exists; tarp documentation completeness is not yet verified",
            carrier_package_submitted: false,
            age_timezone: "America/New_York",
          },
          sections: {
            tarps_assigned_not_complete:
              group("tarps_assigned_not_complete"),
            tarps_complete_photos_needed:
              group("tarps_complete_photos_needed"),
            sub_package_submitted:
              group("sub_package_submitted"),
          },
        })
      } catch (error) {
        request.log.error(error)
        return reply.code(500).send({
          ok: false,
          error: "Outstanding tarp report preview unavailable",
        })
      }
    }
  )
}
