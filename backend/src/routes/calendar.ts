import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import {
  ensureCalendarAutomationFoundation,
  recordCalendarRescheduleActivity,
} from "../services/calendarAutomationService"
import { getCurrentUserFromToken } from "../services/authService"

function getBearerToken(request: any) {
  const auth = String(request.headers.authorization || "")
  return auth.startsWith("Bearer ") ? auth.slice(7) : ""
}

async function requireCalendarUser(
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

function calendarActorMeta(user: any) {
  return {
    actor_name:
      user?.full_name ||
      user?.email ||
      "User",
    actor_email:
      user?.email ||
      null,
    actor_user_id:
      user?.id ||
      null,
  }
}

async function ensureCalendarTable() {
  await pool.query(`
    create table if not exists calendar_events (
      id bigserial primary key,
      tenant_id bigint null references tenants(id) on delete cascade,
      job_id bigint null references jobs(id) on delete set null,
      title text not null default 'Calendar Event',
      start_time timestamptz not null,
      end_time timestamptz null,
      location text null,
      notes text null,
      event_type text not null default 'general',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)

  await pool.query(`
    alter table calendar_events
      add column if not exists tenant_id bigint null,
      add column if not exists job_id bigint null,
      add column if not exists title text not null default 'Calendar Event',
      add column if not exists start_time timestamptz,
      add column if not exists end_time timestamptz null,
      add column if not exists location text null,
      add column if not exists notes text null,
      add column if not exists event_type text not null default 'general',
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now()
  `)
}

async function getTenantIdBySlug(slug: string): Promise<number> {
  const result = await pool.query(
    `select id from tenants where slug = $1 limit 1`,
    [slug]
  )

  if (!result.rowCount) {
    throw new Error(`Tenant not found: ${slug}`)
  }

  return Number(result.rows[0].id)
}

export async function registerCalendarRoutes(app: FastifyInstance) {
  await ensureCalendarTable()
  await ensureCalendarAutomationFoundation()

  app.get("/calendar/:tenantSlug/events", async (request: any, reply) => {
    try {
      await ensureCalendarTable()

      const { tenantSlug } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)

      const result = await pool.query(
        `
        select
          ce.id,
          ce.job_id,
          ce.title,
          ce.start_time,
          ce.end_time,
          ce.location,
          ce.notes,
          ce.event_type,
          ce.automation_managed,
          ce.automation_stage_key,
          ce.created_at,
          ce.updated_at,
          c.full_name as customer_name,
          j.stage as job_stage,
          concat_ws(
            ', ',
            nullif(trim(j.address1), ''),
            nullif(trim(j.city), ''),
            nullif(trim(j.state), ''),
            nullif(trim(j.zip), '')
          ) as job_address
        from calendar_events ce
        left join jobs j
          on j.id = ce.job_id
         and j.tenant_id = ce.tenant_id
        left join customers c
          on c.id = j.customer_id
         and c.tenant_id = j.tenant_id
        where ce.tenant_id = $1
        order by ce.start_time asc, ce.id asc
        `,
        [tenantId]
      )

      return {
        ok: true,
        events: result.rows,
      }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.post("/calendar/:tenantSlug/events", async (request: any, reply) => {
    try {
      await ensureCalendarTable()

      const { tenantSlug } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const actor = await requireCalendarUser(request, reply, tenantId)

      if (!actor) {
        return { ok: false, error: "Unauthorized" }
      }

      const body = request.body || {}

      if (!body.title) {
        reply.code(400)
        return { ok: false, error: "Title is required" }
      }

      if (!body.start_time) {
        reply.code(400)
        return { ok: false, error: "Start time is required" }
      }

      const result = await pool.query(
        `
        insert into calendar_events (
          tenant_id,
          job_id,
          title,
          start_time,
          end_time,
          location,
          notes,
          event_type,
          created_at,
          updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, now(), now()
        )
        returning
          id,
          job_id,
          title,
          start_time,
          end_time,
          location,
          notes,
          event_type,
          created_at,
          updated_at
        `,
        [
          tenantId,
          body.job_id ? Number(body.job_id) : null,
          String(body.title),
          String(body.start_time),
          body.end_time ? String(body.end_time) : null,
          body.location || null,
          body.notes || null,
          body.event_type || "general",
        ]
      )

      if (result.rows[0]?.job_id) {
        await pool.query(
          `
          insert into timeline_events (
            tenant_id,
            job_id,
            kind,
            message,
            meta,
            created_at
          )
          values ($1, $2, $3, $4, $5::jsonb, now())
          `,
          [
            tenantId,
            Number(result.rows[0].job_id),
            "calendar_event_created",
            `Calendar event created by ${
              actor.full_name || actor.email || "User"
            }: ${result.rows[0].title}`,
            JSON.stringify({
              ...calendarActorMeta(actor),
              event_id: result.rows[0].id,
              event_type: result.rows[0].event_type,
              start_time: result.rows[0].start_time,
              end_time: result.rows[0].end_time,
              source: "calendar_ui",
            }),
          ]
        )
      }

      return {
        ok: true,
        event: result.rows[0],
      }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })
  app.put("/calendar/:tenantSlug/events/:eventId", async (request: any, reply) => {
    try {
      await ensureCalendarTable()

      const { tenantSlug, eventId } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const actor = await requireCalendarUser(request, reply, tenantId)

      if (!actor) {
        return { ok: false, error: "Unauthorized" }
      }

      const body = request.body || {}

      const previousResult = await pool.query(
        `
        select
          id,
          job_id,
          title,
          start_time,
          end_time,
          location,
          notes,
          event_type,
          automation_managed,
          automation_stage_key,
          created_at,
          updated_at
        from calendar_events
        where tenant_id = $1
          and id = $2
        limit 1
        `,
        [tenantId, Number(eventId)]
      )

      if (!previousResult.rowCount) {
        reply.code(404)
        return { ok: false, error: "Calendar event not found" }
      }

      if (!body.title) {
        reply.code(400)
        return { ok: false, error: "Title is required" }
      }

      if (!body.start_time) {
        reply.code(400)
        return { ok: false, error: "Start time is required" }
      }

      const result = await pool.query(
        `
        update calendar_events
        set
          title = $1,
          start_time = $2,
          end_time = $3,
          location = $4,
          notes = $5,
          event_type = $6,
          updated_at = now()
        where tenant_id = $7
          and id = $8
        returning
          id,
          job_id,
          title,
          start_time,
          end_time,
          location,
          notes,
          event_type,
          automation_managed,
          automation_stage_key,
          created_at,
          updated_at
        `,
        [
          String(body.title),
          String(body.start_time),
          body.end_time ? String(body.end_time) : null,
          body.location || null,
          body.notes || null,
          body.event_type || "general",
          tenantId,
          Number(eventId),
        ]
      )

      if (!result.rowCount) {
        reply.code(404)
        return { ok: false, error: "Calendar event not found" }
      }

      await recordCalendarRescheduleActivity({
        tenantId,
        before: previousResult.rows[0],
        after: result.rows[0],
        source: body.audit_source || "calendar_ui",
        actor: calendarActorMeta(actor),
      })

      return { ok: true, event: result.rows[0] }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.delete("/calendar/:tenantSlug/events/:eventId", async (request: any, reply) => {
    try {
      await ensureCalendarTable()

      const { tenantSlug, eventId } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const actor = await requireCalendarUser(request, reply, tenantId)

      if (!actor) {
        return { ok: false, error: "Unauthorized" }
      }

      const result = await pool.query(
        `
        delete from calendar_events
        where tenant_id = $1
          and id = $2
        returning
          id,
          job_id,
          title,
          start_time,
          end_time,
          event_type
        `,
        [tenantId, Number(eventId)]
      )

      if (!result.rowCount) {
        reply.code(404)
        return { ok: false, error: "Calendar event not found" }
      }

      const deleted = result.rows[0]

      if (deleted?.job_id) {
        await pool.query(
          `
          insert into timeline_events (
            tenant_id,
            job_id,
            kind,
            message,
            meta,
            created_at
          )
          values ($1, $2, $3, $4, $5::jsonb, now())
          `,
          [
            tenantId,
            Number(deleted.job_id),
            "calendar_event_deleted",
            `Calendar event deleted by ${
              actor.full_name || actor.email || "User"
            }: ${deleted.title}`,
            JSON.stringify({
              ...calendarActorMeta(actor),
              event_id: deleted.id,
              event_type: deleted.event_type,
              start_time: deleted.start_time,
              end_time: deleted.end_time,
              source: "calendar_ui",
            }),
          ]
        )
      }

      return { ok: true, deleted_event_id: Number(eventId) }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })


}
// redeploy Wed May 13 08:39:41 EDT 2026
