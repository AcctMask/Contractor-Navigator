import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"

async function ensureCalendarTable() {
  await pool.query(`
    create table if not exists calendar_events (
      id bigserial primary key,
      tenant_id bigint null references tenants(id) on delete cascade,
      job_id bigint null references jobs(id) on delete set null,
      title text not null,
      start_time timestamptz not null,
      end_time timestamptz null,
      location text null,
      notes text null,
      event_type text not null default 'general',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
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
}
