import { pool } from "../db/db";
/**
 * Customer “panel” API
 * - GET  /admin/customers/:tenant_slug
 * - GET  /admin/customer/:tenant_slug/:customer_id/history
 *
 * Notes:
 * - jobs table does NOT include phone/email (confirmed via your schema output)
 * - we rely on customers table for identity and timeline_events for activity
 */
async function resolveTenantId(tenantSlug) {
    const r = await pool.query(`select id from tenants where slug = $1 limit 1`, [tenantSlug]);
    if (!r.rows?.length)
        return null;
    return Number(r.rows[0].id);
}
export async function registerCustomerRoutes(app) {
    // List customers + activity summary
    app.get("/admin/customers/:tenant_slug", async (req, reply) => {
        const { tenant_slug } = req.params;
        const tenantId = await resolveTenantId(tenant_slug);
        if (!tenantId)
            return reply.code(404).send({ ok: false, error: "Tenant not found" });
        /**
         * We compute:
         * - last_activity_at: max(timeline_events.created_at) where meta.customer_id matches
         * - last_activity_kind/message: most recent event for that customer
         * - jobs_count: number of jobs associated via jobs.customer_id
         *
         * timeline_events.meta stores customer_id as JSON (we write it in events route)
         */
        const q = `
      with cust as (
        select id, full_name, created_at, updated_at
        from customers
        where tenant_id = $1
      ),
      jobs_counts as (
        select customer_id, count(*)::int as jobs_count
        from jobs
        where tenant_id = $1 and customer_id is not null
        group by customer_id
      ),
      last_evt as (
        select
          (meta->>'customer_id')::bigint as customer_id,
          max(created_at) as last_activity_at
        from timeline_events
        where tenant_id = $1
          and (meta ? 'customer_id')
        group by (meta->>'customer_id')::bigint
      ),
      last_evt_detail as (
        select distinct on ((meta->>'customer_id')::bigint)
          (meta->>'customer_id')::bigint as customer_id,
          kind as last_kind,
          message as last_message,
          created_at as last_activity_at
        from timeline_events
        where tenant_id = $1
          and (meta ? 'customer_id')
        order by (meta->>'customer_id')::bigint, created_at desc
      )
      select
        c.id,
        c.full_name,
        c.created_at,
        c.updated_at,
        coalesce(j.jobs_count, 0) as jobs_count,
        d.last_activity_at,
        d.last_kind,
        d.last_message
      from cust c
      left join jobs_counts j on j.customer_id = c.id
      left join last_evt_detail d on d.customer_id = c.id
      order by coalesce(d.last_activity_at, c.created_at) desc, c.id desc
      limit 500
    `;
        const r = await pool.query(q, [tenantId]);
        return {
            ok: true,
            tenant: { id: String(tenantId), slug: tenant_slug },
            items: r.rows.map((x) => ({
                id: Number(x.id),
                full_name: x.full_name,
                jobs_count: Number(x.jobs_count || 0),
                last_activity_at: x.last_activity_at || null,
                last_kind: x.last_kind || null,
                last_message: x.last_message || null,
                created_at: x.created_at,
                updated_at: x.updated_at,
            })),
            schema_hint: {
                note: "jobs has no phone/email; identity comes from customers table; activity from timeline_events(meta.customer_id).",
            },
        };
    });
    // Customer history: jobs + all timeline events tied to customer and/or their jobs
    app.get("/admin/customer/:tenant_slug/:customer_id/history", async (req, reply) => {
        const { tenant_slug, customer_id } = req.params;
        const tenantId = await resolveTenantId(tenant_slug);
        if (!tenantId)
            return reply.code(404).send({ ok: false, error: "Tenant not found" });
        const custId = Number(customer_id);
        if (!Number.isFinite(custId))
            return reply.code(400).send({ ok: false, error: "Invalid customer_id" });
        const cust = await pool.query(`select id, full_name, created_at, updated_at
       from customers
       where tenant_id=$1 and id=$2
       limit 1`, [tenantId, custId]);
        if (!cust.rows?.length)
            return reply.code(404).send({ ok: false, error: "Customer not found" });
        const jobsR = await pool.query(`select id, external_job_id, stage, job_type, address1, city, state, zip, created_at, updated_at
       from jobs
       where tenant_id=$1 and customer_id=$2
       order by id desc
       limit 200`, [tenantId, custId]);
        // Collect job IDs so we can include timeline events that are job-linked
        const jobIds = jobsR.rows.map((j) => Number(j.id)).filter((n) => Number.isFinite(n));
        const hasJobs = jobIds.length > 0;
        const eventsQ = `
      select id, job_id, kind, message, meta, created_at
      from timeline_events
      where tenant_id=$1
        and (
          (meta ? 'customer_id' and (meta->>'customer_id')::bigint = $2)
          ${hasJobs ? `or (job_id = any($3::bigint[]))` : ``}
        )
      order by created_at desc, id desc
      limit 1000
    `;
        const params = [tenantId, custId];
        if (hasJobs)
            params.push(jobIds);
        const eventsR = await pool.query(eventsQ, params);
        return {
            ok: true,
            tenant: { id: String(tenantId), slug: tenant_slug },
            customer: {
                id: Number(cust.rows[0].id),
                full_name: cust.rows[0].full_name,
                created_at: cust.rows[0].created_at,
                updated_at: cust.rows[0].updated_at,
            },
            jobs: jobsR.rows.map((j) => ({
                id: Number(j.id),
                external_job_id: j.external_job_id,
                stage: j.stage,
                job_type: j.job_type,
                address1: j.address1,
                city: j.city,
                state: j.state,
                zip: j.zip,
                created_at: j.created_at,
                updated_at: j.updated_at,
            })),
            timeline: eventsR.rows.map((e) => ({
                id: Number(e.id),
                job_id: e.job_id === null ? null : Number(e.job_id),
                kind: e.kind,
                message: e.message,
                meta: e.meta,
                created_at: e.created_at,
            })),
        };
    });
}
//# sourceMappingURL=customers.js.map