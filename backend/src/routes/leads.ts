import type { FastifyInstance } from "fastify";
import { pool } from "../db/db";

const DEFAULT_TENANT = "g2g-roofing";

// Temporary dual-write so old Zapier flow still works while Co-Pilot becomes primary
const ESTIMATE_ZAPIER_FALLBACK =
  "https://hooks.zapier.com/hooks/catch/14602714/uw4n7rt/";
const CONTRACT_ZAPIER_FALLBACK =
  "https://hooks.zapier.com/hooks/catch/14602714/uwh1w79/";

async function getTenantIdBySlug(slug: string): Promise<number> {
  const t = await pool.query(`select id from tenants where slug=$1 limit 1`, [slug]);
  if (!t.rowCount) {
    throw new Error(`tenant not found: ${slug}`);
  }
  return Number(t.rows[0].id);
}

function asString(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function ensureLeadSchema() {
  // Customers table safety
  await pool.query(`
    alter table customers
      add column if not exists full_name text,
      add column if not exists phone text,
      add column if not exists email text,
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now();
  `);

  // Jobs table safety for lead intake fields
  await pool.query(`
    alter table jobs
      add column if not exists external_crm text,
      add column if not exists external_customer_id text,
      add column if not exists external_job_id text,
      add column if not exists job_type text,
      add column if not exists address1 text,
      add column if not exists city text,
      add column if not exists state text,
      add column if not exists zip text,
      add column if not exists lead_source text,
      add column if not exists lead_source_detail text,
      add column if not exists marketing_campaign text,
      add column if not exists crm_flow_key text,
      add column if not exists crm_substatus text,
      add column if not exists manual_owner text,
      add column if not exists bot_paused boolean not null default false,
      add column if not exists contract_status text,
      add column if not exists estimate_status text,
      add column if not exists last_human_note text,
      add column if not exists carrier text,
      add column if not exists claim_number text,
      add column if not exists policy_holder text,
      add column if not exists adjuster_name text,
      add column if not exists adjuster_phone text,
      add column if not exists adjuster_email text,
      add column if not exists assignment_subject text,
      add column if not exists assignment_notes text,
      add column if not exists damage_location text,
      add column if not exists damage_summary text,
      add column if not exists wa_status text,
      add column if not exists contract_sent_at timestamptz,
      add column if not exists estimate_sent_at timestamptz,
      add column if not exists wa_sent_at timestamptz,
      add column if not exists wa_signed_at timestamptz,
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now();
  `);
}

async function findOrCreateCustomer(
  tenantId: number,
  fullName: string | null,
  phone: string | null,
  email: string | null
): Promise<number> {
  const existing = await pool.query(
    `
    select id
      from customers
     where tenant_id = $1
       and (
         ($2::text is not null and email = $2::text)
         or
         ($3::text is not null and phone = $3::text)
       )
     order by id desc
     limit 1
    `,
    [tenantId, email, phone]
  );

  if (existing.rowCount) {
    const customerId = Number(existing.rows[0].id);

    await pool.query(
      `
      update customers
         set full_name = coalesce($1, full_name),
             phone = coalesce($2, phone),
             email = coalesce($3, email),
             updated_at = now()
       where tenant_id = $4
         and id = $5
      `,
      [fullName, phone, email, tenantId, customerId]
    );

    return customerId;
  }

  const inserted = await pool.query(
    `
    insert into customers
      (tenant_id, full_name, phone, email, created_at, updated_at)
    values
      ($1, $2, $3, $4, now(), now())
    returning id
    `,
    [tenantId, fullName, phone, email]
  );

  return Number(inserted.rows[0].id);
}

async function forwardToZapier(url: string, payload: any) {
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function registerLeadRoutes(app: FastifyInstance) {
  await ensureLeadSchema();

  app.post("/lead/new", async (req, reply) => {
    const body: any = (req as any).body || {};

    const tenantSlug = asString(body.tenant_slug) || DEFAULT_TENANT;
    const tenantId = await getTenantIdBySlug(tenantSlug);

    const fullName =
      asString(body.name) ||
      [asString(body.firstName), asString(body.lastName)].filter(Boolean).join(" ") ||
      "Unknown Lead";

    const phone = asString(body.phone);
    const email = asString(body.email);
    const address1 = asString(body.address) || asString(body.address1);
    const city = asString(body.city);
    const state = asString(body.state);
    const zip = asString(body.zip);
    const notes = asString(body.notes);
    const source = asString(body.custSource) || asString(body.source) || "Estimator";
    const roofType = asString(body.roofType);
    const structureSqft = asString(body.structureSqft);
    const roofSqft = asString(body.roofSqft);
    const estimateLow = asString(body.estimateLow);
    const estimateHigh = asString(body.estimateHigh);
    const estimateSummary = asString(body.estimateSummary);
    const emailSummary = asString(body.emailSummary);

    const customerId = await findOrCreateCustomer(tenantId, fullName, phone, email);

    const externalJobId =
      asString(body.job_id) ||
      asString(body.external_job_id) ||
      `estimator-${Date.now()}`;

    const insertedJob = await pool.query(
      `
      insert into jobs
        (
          tenant_id,
          customer_id,
          external_crm,
          external_customer_id,
          external_job_id,
          job_type,
          stage,
          address1,
          city,
          state,
          zip,
          lead_source,
          lead_source_detail,
          marketing_campaign,
          created_at,
          updated_at
        )
      values
        (
          $1,
          $2,
          'estimator_app',
          null,
          $3,
          'ROOF_REPLACEMENT',
          'estimate_sent',
          $4,
          $5,
          $6,
          $7,
          $8,
          'website_estimate',
          null,
          now(),
          now()
        )
      returning id
      `,
      [
        tenantId,
        customerId,
        externalJobId,
        address1,
        city,
        state,
        zip,
        source,
      ]
    );

    const jobId = Number(insertedJob.rows[0].id);

    await pool.query(
      `
      insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
      values
      (
        $1,
        $2,
        'lead_created',
        'Estimator lead received',
        $3::jsonb,
        now()
      )
      `,
      [
        tenantId,
        jobId,
        JSON.stringify({
          source,
          phone,
          email,
          address1,
          city,
          state,
          zip,
          roofType,
          structureSqft,
          roofSqft,
          estimateLow,
          estimateHigh,
          estimateSummary,
          emailSummary,
          notes,
          externalJobId,
          rawPayload: body,
        }),
      ]
    );

    if (notes) {
      await pool.query(
        `
        update jobs
           set last_human_note = $1,
               updated_at = now()
         where tenant_id = $2
           and id = $3
        `,
        [notes, tenantId, jobId]
      );
    }

    const zapierResult = await forwardToZapier(
      process.env.ZAPIER_ESTIMATE_WEBHOOK || ESTIMATE_ZAPIER_FALLBACK,
      body
    );

    return reply.send({
      ok: true,
      tenant_id: tenantId,
      customer_id: customerId,
      job_id: jobId,
      forwarded_to_zapier: zapierResult.ok,
      zapier_error: zapierResult.ok ? null : zapierResult.error,
    });
  });

  app.post("/lead/contract-click", async (req, reply) => {
    const body: any = (req as any).body || {};

    const tenantSlug = asString(body.tenant_slug) || DEFAULT_TENANT;
    const tenantId = await getTenantIdBySlug(tenantSlug);

    const fullName = asString(body.name) || "Unknown Lead";
    const phone = asString(body.phone);
    const email = asString(body.email);
    const zip = asString(body.zip);

    const customerId = await findOrCreateCustomer(tenantId, fullName, phone, email);

    const existingJob = await pool.query(
      `
      select id
        from jobs
       where tenant_id = $1
         and customer_id = $2
         and ($3::text is null or zip = $3::text)
       order by id desc
       limit 1
      `,
      [tenantId, customerId, zip]
    );

    let jobId: number;

    if (existingJob.rowCount) {
      jobId = Number(existingJob.rows[0].id);

      await pool.query(
        `
        update jobs
           set contract_status = 'requested',
               updated_at = now()
         where tenant_id = $1
           and id = $2
        `,
        [tenantId, jobId]
      );
    } else {
      const externalJobId = asString(body.job_id) || `contract-click-${Date.now()}`;

      const insertedJob = await pool.query(
        `
        insert into jobs
          (
            tenant_id,
            customer_id,
            external_crm,
            external_customer_id,
            external_job_id,
            job_type,
            stage,
            address1,
            city,
            state,
            zip,
            lead_source,
            lead_source_detail,
            marketing_campaign,
            contract_status,
            created_at,
            updated_at
          )
        values
          (
            $1,
            $2,
            'estimator_app',
            null,
            $3,
            'ROOF_REPLACEMENT',
            'contract_requested',
            $4,
            $5,
            $6,
            $7,
            $8,
            'website_contract_click',
            null,
            'requested',
            now(),
            now()
          )
        returning id
        `,
        [
          tenantId,
          customerId,
          externalJobId,
          asString(body.address) || asString(body.address1),
          asString(body.city),
          asString(body.state),
          zip,
          asString(body.custSource) || "Estimator",
        ]
      );

      jobId = Number(insertedJob.rows[0].id);
    }

    await pool.query(
      `
      insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
      values
      (
        $1,
        $2,
        'contract_click_received',
        'Contract request received from estimator app',
        $3::jsonb,
        now()
      )
      `,
      [tenantId, jobId, JSON.stringify({ rawPayload: body })]
    );

    const zapierResult = await forwardToZapier(
      process.env.ZAPIER_CONTRACT_WEBHOOK || CONTRACT_ZAPIER_FALLBACK,
      body
    );

    return reply.send({
      ok: true,
      tenant_id: tenantId,
      customer_id: customerId,
      job_id: jobId,
      forwarded_to_zapier: zapierResult.ok,
      zapier_error: zapierResult.ok ? null : zapierResult.error,
    });
  });
}

export default registerLeadRoutes;
export { registerLeadRoutes };
