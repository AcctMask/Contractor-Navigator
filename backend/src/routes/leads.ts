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
  email: string | null,
  address: string | null
): Promise<number> {
  // First: match by property address so property managers / repeat callers do not get merged by phone.
  if (address) {
    const byAddress = await pool.query(
      `select c.id
       from customers c
       join jobs j
         on j.customer_id = c.id
        and j.tenant_id = c.tenant_id
       where c.tenant_id = $1
         and lower(trim(j.address1)) = lower(trim($2))
       limit 1`,
      [tenantId, address]
    );

    if (byAddress.rowCount) return Number(byAddress.rows[0].id);
  }

  // Do not match by phone or email alone. Address/property is the job anchor.

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

    const customerId = await findOrCreateCustomer(tenantId, fullName, phone, email, asString(body.address));

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

    const estimateDetailsMeta = {
      roof_type: asString(body.roofType),
      stories: asString(body.stories),
      condition: asString(body.condition),
      structure_sqft: body.structureSqft ? Number(body.structureSqft) : null,
      roof_sqft: body.roofSqft ? Number(body.roofSqft) : null,
      estimate_low: body.estimateLow ? Number(body.estimateLow) : null,
      estimate_high: body.estimateHigh ? Number(body.estimateHigh) : null,
      estimate_summary: asString(body.estimateSummary),
      estimator_notes: asString(body.notes),
      captured_at: new Date().toISOString()
    };

    const estimateDetailsMessage =
      `Estimator details captured\n` +
      `Roof Type: ${estimateDetailsMeta.roof_type || "-"}\n` +
      `Stories: ${estimateDetailsMeta.stories || "-"}\n` +
      `Condition: ${estimateDetailsMeta.condition || "-"}\n` +
      `Home Sq Ft: ${estimateDetailsMeta.structure_sqft || "-"}\n` +
      `Roof Sq Ft: ${estimateDetailsMeta.roof_sqft || "-"}\n` +
      `Estimate Low: ${estimateDetailsMeta.estimate_low || "-"}\n` +
      `Estimate High: ${estimateDetailsMeta.estimate_high || "-"}\n` +
      `Estimate Summary: ${estimateDetailsMeta.estimate_summary || "-"}\n` +
      `Customer Notes: ${estimateDetailsMeta.estimator_notes || "-"}`;

    await pool.query(
      `insert into timeline_events (
        tenant_id, job_id, kind, message, meta
      )
      values ($1,$2,'estimate_details',$3,$4)`,
      [
        tenantId,
        jobId,
        estimateDetailsMessage,
        JSON.stringify(estimateDetailsMeta)
      ]
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
