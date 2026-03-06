import { FastifyInstance } from "fastify";
import { pool } from "../db/db";
import { planFollowUps } from "../services/conversationEngine";
/**
 * EVENTS ROUTES
 * Must export `registerEventsRoutes` because src/index.ts calls it explicitly.
 */
async function findOrCreateCustomer(tenantId, fullName) {
    const name = (fullName || "").trim();
    if (!name) {
        const r = await pool.query(`insert into customers (tenant_id, full_name)
       values ($1,'Unknown')
       returning id`, [tenantId]);
        return Number(r.rows[0].id);
    }
    const existing = await pool.query(`select id
       from customers
      where tenant_id=$1
        and full_name=$2
      limit 1`, [tenantId, name]);
    if (existing.rowCount)
        return Number(existing.rows[0].id);
    const r = await pool.query(`insert into customers (tenant_id, full_name)
     values ($1,$2)
     returning id`, [tenantId, name]);
    return Number(r.rows[0].id);
}
async function upsertJob(params) {
    const { tenant_id, external_crm, external_job_id, stage, zip, address1, city, state, customer_id, job_type, } = params;
    const existing = await pool.query(`select id
       from jobs
      where tenant_id=$1
        and external_job_id=$2
      limit 1`, [tenant_id, external_job_id]);
    if (existing.rowCount) {
        const jobId = Number(existing.rows[0].id);
        await pool.query(`update jobs
          set stage=$1,
              zip=$2,
              address1=$3,
              city=$4,
              state=$5,
              customer_id=$6,
              job_type=$7,
              updated_at=now()
        where id=$8`, [
            stage,
            zip || null,
            address1 || null,
            city || null,
            state || null,
            customer_id || null,
            job_type || null,
            jobId,
        ]);
        return jobId;
    }
    const r = await pool.query(`insert into jobs
      (tenant_id, external_crm, external_job_id, job_type, stage, address1, city, state, zip, customer_id, created_at, updated_at)
     values
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())
     returning id`, [
        tenant_id,
        external_crm,
        external_job_id,
        job_type || null,
        stage,
        address1 || null,
        city || null,
        state || null,
        zip || null,
        customer_id || null,
    ]);
    return Number(r.rows[0].id);
}
async function insertTimelineEvent(params) {
    const { tenant_id, job_id, kind, message, meta } = params;
    await pool.query(`insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
     values ($1,$2,$3,$4,$5::jsonb,now())`, [tenant_id, job_id, kind, message, JSON.stringify(meta || {})]);
}
function normalizeStage(toValue) {
    const to = (toValue ?? "").toString().trim();
    // Keep this explicit for now (you can expand later)
    if (to === "Estimate Sent")
        return "estimate_sent";
    if (to === "Lead")
        return "lead";
    // fallback normalize
    return (to
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "unknown");
}
async function getTenantIdBySlug(slug) {
    const t = await pool.query(`select id from tenants where slug=$1 limit 1`, [slug]);
    if (!t.rowCount)
        return null;
    return Number(t.rows[0].id);
}
export async function registerEventsRoutes(app) {
    app.post("/events", async (req, reply) => {
        const body = req.body || {};
        const tenant_slug = String(body.tenant_slug || "");
        const source = String(body.source || "unknown");
        const event_type = String(body.event_type || "");
        const occurred_at = String(body.occurred_at || new Date().toISOString());
        const payload = body.payload || {};
        if (!tenant_slug || !event_type) {
            return reply.send({ ok: false, error: "Required: tenant_slug, event_type" });
        }
        const tenantId = await getTenantIdBySlug(tenant_slug);
        if (!tenantId) {
            return reply.send({ ok: false, error: `tenant not found: ${tenant_slug}` });
        }
        const external_job_id = payload.job_id ? String(payload.job_id) : "";
        if (!external_job_id) {
            return reply.send({ ok: false, error: "payload.job_id required" });
        }
        const stageKey = normalizeStage(payload.to);
        const fullName = payload.name ? String(payload.name) : null;
        const zip = payload.zip ? String(payload.zip) : null;
        const address1 = payload.address1 ? String(payload.address1) : null;
        const city = payload.city ? String(payload.city) : null;
        const state = payload.state ? String(payload.state) : null;
        const customer_id = await findOrCreateCustomer(tenantId, fullName);
        const jobId = await upsertJob({
            tenant_id: tenantId,
            external_crm: source,
            external_job_id,
            stage: stageKey,
            zip,
            address1,
            city,
            state,
            customer_id,
            job_type: payload.job_type ? String(payload.job_type) : null,
        });
        await insertTimelineEvent({
            tenant_id: tenantId,
            job_id: jobId,
            kind: "event_received",
            message: `${source}:${event_type}`,
            meta: {
                occurred_at,
                payload,
                mapped_stage: stageKey,
                customer_id,
                external_job_id,
            },
        });
        // Keep your existing "workflow_started" timeline marker
        await insertTimelineEvent({
            tenant_id: tenantId,
            job_id: jobId,
            kind: "workflow_started",
            message: `workflow started for stage=${stageKey}`,
            meta: { stage: stageKey },
        });
        // NEW: schedule follow-up workflow_step actions
        try {
            await planFollowUps({
                tenant_id: tenantId,
                job_id: jobId,
                stage: stageKey,
                occurred_at,
            });
            await insertTimelineEvent({
                tenant_id: tenantId,
                job_id: jobId,
                kind: "workflow_planned",
                message: `follow-ups scheduled for stage=${stageKey}`,
                meta: { stage: stageKey },
            });
        }
        catch (e) {
            await insertTimelineEvent({
                tenant_id: tenantId,
                job_id: jobId,
                kind: "workflow_plan_failed",
                message: `follow-up scheduling failed for stage=${stageKey}`,
                meta: { error: String(e?.message || e) },
            });
        }
        return reply.send({ ok: true, tenant_id: tenantId, job_id: jobId, customer_id });
    });
}
// Optional extra exports (harmless)
export const eventsRoutes = registerEventsRoutes;
export default registerEventsRoutes;
//# sourceMappingURL=events.js.map