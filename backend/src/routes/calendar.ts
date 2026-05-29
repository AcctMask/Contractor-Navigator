import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"

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
  app.get("/calendar/:tenantSlug/events", async (request: any, reply) => {
    try {
      await ensureCalendarTable()

      const { tenantSlug } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)

      const result = await pool.query(
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
          created_at,
          updated_at
        from calendar_events
        where tenant_id = $1
        order by start_time asc, id asc
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

      const result = await pool.query(
        `
        delete from calendar_events
        where tenant_id = $1
          and id = $2
        returning id
        `,
        [tenantId, Number(eventId)]
      )

      if (!result.rowCount) {
        reply.code(404)
        return { ok: false, error: "Calendar event not found" }
      }

      return { ok: true, deleted_event_id: Number(eventId) }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })


}
// redeploy Wed May 13 08:39:41 EDT 2026
