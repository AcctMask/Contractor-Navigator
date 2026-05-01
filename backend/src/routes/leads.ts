import type { FastifyInstance } from "fastify";
import { pool } from "../db/db";

const DEFAULT_TENANT = "g2g-roofing";

async function getTenantIdBySlug(slug: string): Promise<number> {
  const t = await pool.query(`select id from tenants where slug=$1 limit 1`, [slug]);
  if (!t.rowCount) throw new Error(`tenant not found: ${slug}`);
  return Number(t.rows[0].id);
}

function asString(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function findOrCreateCustomer(
  tenantId: number,
  fullName: string | null,
  phone: string | null,
  email: string | null
): Promise<number> {
  const existing = await pool.query(
    `select id from customers
     where tenant_id=$1
     and (
       ($2::text is not null and email=$2)
       or
       ($3::text is not null and phone=$3)
     )
     limit 1`,
    [tenantId, email, phone]
  );

  if (existing.rowCount) return Number(existing.rows[0].id);

  const inserted = await pool.query(
    `insert into customers (tenant_id, full_name, phone, email)
     values ($1,$2,$3,$4)
     returning id`,
    [tenantId, fullName, phone, email]
  );

  return Number(inserted.rows[0].id);
}

async function registerLeadRoutes(app: FastifyInstance) {

  app.post("/lead/new", async (req, reply) => {
    const body: any = (req as any).body || {};

    const tenantSlug = asString(body.tenant_slug) || DEFAULT_TENANT;
    const tenantId = await getTenantIdBySlug(tenantSlug);

    const fullName = asString(body.name) || "Unknown Lead";
    const phone = asString(body.phone);
    const email = asString(body.email);

    const customerId = await findOrCreateCustomer(tenantId, fullName, phone, email);

    const insertedJob = await pool.query(
      `insert into jobs (
        tenant_id,
        customer_id,
        external_crm,
        external_job_id,
        job_type,
        stage,
        address1,
        city,
        state,
        zip,
        lead_source,
        lead_source_detail
      )
      values (
        $1,$2,
        'estimator_app',
        $3,
        'ROOF_REPLACEMENT',
        'estimate_sent',
        $4,$5,$6,$7,
        'website',
        'estimate_form'
      )
      returning id`,
      [
        tenantId,
        customerId,
        `est-${Date.now()}`,
        asString(body.address),
        asString(body.city),
        asString(body.state),
        asString(body.zip),
      ]
    );

    const jobId = Number(insertedJob.rows[0].id);

    // Save structured estimate details for sales + AI follow-up
    try {
      const { upsertEstimateDetailsByTenantSlug } = await import("../services/documentPipelineService")

      await upsertEstimateDetailsByTenantSlug(tenantSlug, jobId, {
        roof_type: asString(body.roofType),
        roof_squares: body.roofSqft ? Number(body.roofSqft) / 100 : null,
        low_amount: body.estimateLow ? Number(body.estimateLow) : null,
        high_amount: body.estimateHigh ? Number(body.estimateHigh) : null,
        estimator_remarks: asString(body.estimateSummary)
      })
    } catch (err) {
      console.error("Failed to save estimate details", err)
    }

    await pool.query(
      `insert into timeline_events (
        tenant_id, job_id, kind, message, meta
      )
      values ($1,$2,'lead_created','Website estimate received',$3)`,
      [tenantId, jobId, JSON.stringify(body)]
    );

    return reply.send({
      ok: true,
      job_id: jobId
    });
  });

  app.post("/lead/contract-click", async (req, reply) => {
    const body: any = (req as any).body || {};

    const tenantSlug = asString(body.tenant_slug) || DEFAULT_TENANT;
    const tenantId = await getTenantIdBySlug(tenantSlug);

    const fullName = asString(body.name);
    const phone = asString(body.phone);
    const email = asString(body.email);

    const customerId = await findOrCreateCustomer(tenantId, fullName, phone, email);

    const insertedJob = await pool.query(
      `insert into jobs (
        tenant_id,
        customer_id,
        external_crm,
        external_job_id,
        job_type,
        stage,
        contract_status
      )
      values (
        $1,$2,
        'estimator_app',
        $3,
        'ROOF_REPLACEMENT',
        'contract_requested',
        'requested'
      )
      returning id`,
      [
        tenantId,
        customerId,
        `contract-${Date.now()}`
      ]
    );

    const jobId = Number(insertedJob.rows[0].id);

    await pool.query(
      `insert into timeline_events (
        tenant_id, job_id, kind, message, meta
      )
      values ($1,$2,'contract_click','Contract requested',$3)`,
      [tenantId, jobId, JSON.stringify(body)]
    );

    return reply.send({
      ok: true,
      job_id: jobId
    });
  });

}

export default registerLeadRoutes;
