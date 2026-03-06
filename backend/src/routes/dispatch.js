import { FastifyInstance } from "fastify";
import { pool } from "../db/db";
async function getTenantIdBySlug(slug) {
    const t = await pool.query(`select id from tenants where slug=$1`, [slug]);
    if (!t.rowCount)
        throw new Error(`tenant not found: ${slug}`);
    return Number(t.rows[0].id);
}
async function timeline(tenantId, kind, message, meta = {}) {
    await pool.query(`insert into timeline_events (tenant_id, kind, message, meta)
     values ($1,$2,$3,$4::jsonb)`, [tenantId, kind, message, JSON.stringify(meta)]);
}
export async function dispatchRoutes(app) {
    /**
     * Zapier calls this. We enqueue a leap_dispatch action (scheduler handles it).
     */
    app.post("/dispatch/leap", async (req) => {
        const body = req.body || {};
        const tenant_slug = String(body.tenant_slug || "");
        const jobExternalId = String(body.job_id || "");
        const action = String(body.action || "");
        const payload = body.payload || {};
        if (!tenant_slug || !jobExternalId || !action) {
            return { ok: false, error: "Required: tenant_slug, job_id, action" };
        }
        const tenantId = await getTenantIdBySlug(tenant_slug);
        const jr = await pool.query(`select id from jobs where tenant_id=$1 and external_job_id=$2 limit 1`, [tenantId, jobExternalId]);
        if (!jr.rowCount) {
            return {
                ok: false,
                error: `job not found for external id "${jobExternalId}". Ensure /events stage_changed created it first.`,
            };
        }
        const internalJobId = Number(jr.rows[0].id);
        await pool.query(`
      insert into scheduled_actions (tenant_id, job_id, action_key, run_at, status, payload, created_at, updated_at)
      values ($1,$2,'leap_dispatch', now(), 'pending', $3::jsonb, now(), now())
      `, [
            tenantId,
            internalJobId,
            JSON.stringify({
                action,
                job_external_id: jobExternalId,
                payload,
            }),
        ]);
        await timeline(tenantId, "dispatch_enqueued", `leap_dispatch:${action} (job=${jobExternalId})`, {
            action,
            job_external_id: jobExternalId,
            payload,
        });
        return { ok: true };
    });
}
//# sourceMappingURL=dispatch.js.map