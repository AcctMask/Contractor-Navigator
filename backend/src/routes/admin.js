import { FastifyInstance } from "fastify";
import { pool } from "../db/db";
import { schedulerTick } from "../services/scheduler";
async function getTenantIdBySlug(slug) {
    const t = await pool.query(`select id from tenants where slug=$1 limit 1`, [slug]);
    if (!t.rowCount)
        throw new Error(`tenant not found: ${slug}`);
    return Number(t.rows[0].id);
}
export async function registerAdminRoutes(app) {
    app.post("/admin/scheduler/tick", async (req, reply) => {
        const body = req.body || {};
        const limit = Number(body.limit || 25);
        await schedulerTick(limit);
        return reply.send({ ok: true, ticked: true, limit });
    });
    app.get("/admin/timeline/:tenant_slug", async (req, reply) => {
        const tenant_slug = String(req.params.tenant_slug || "");
        const tenantId = await getTenantIdBySlug(tenant_slug);
        const notes = await pool.query(`
      select id, job_id, kind, message, meta, created_at
        from timeline_events
       where tenant_id=$1
       order by id desc
       limit 200
      `, [tenantId]);
        return reply.send({ ok: true, tenant_id: tenantId, timeline: notes.rows });
    });
    app.get("/admin/scheduled/:tenant_slug", async (req, reply) => {
        const tenant_slug = String(req.params.tenant_slug || "");
        const tenantId = await getTenantIdBySlug(tenant_slug);
        const actions = await pool.query(`
      select id, job_id, action_key, status, run_at, payload, created_at, updated_at
        from scheduled_actions
       where tenant_id=$1
       order by id desc
       limit 200
      `, [tenantId]);
        return reply.send({ ok: true, tenant_id: tenantId, scheduled_actions: actions.rows });
    });
}
export default registerAdminRoutes;
//# sourceMappingURL=admin.js.map