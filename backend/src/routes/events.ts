import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/db";

// Optional: decision matrix / workflow starter may exist in your project.
// We keep imports lazy-safe so this file won't crash if you rename modules later.
let startWorkflowForJob: any = null;
try {
  // If you have a workflow starter helper, wire it here.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  startWorkflowForJob = require("../services/decisionMatrix").startWorkflowForJob;
} catch {
  // ok
}

const EventSchema = z.object({
  tenant_slug: z.string().min(1),
  source: z.string().min(1),
  event_type: z.string().min(1),
  occurred_at: z.string().min(1),
  payload: z.record(z.any()).default({}),
});

type TenantRow = { id: number; slug: string; name: string };

async function getTenantBySlug(slug: string): Promise<TenantRow | null> {
  const r = await pool.query(`select id, slug, name from tenants where slug=$1 limit 1`, [slug]);
  return r.rows?.[0] ?? null;
}

async function insertTimelineEvent(args: {
  tenant_id: number;
  job_id?: number | null;
  kind: string;
  message: string;
  meta?: any;
}) {
  const { tenant_id, job_id, kind, message, meta } = args;
  // Prefer timeline_events if present, else timeline. If neither exists, silently ignore.
  const t = await pool.query(
    `select table_name from information_schema.tables
     where table_schema='public' and table_name in ('timeline_events','timeline')
     order by case table_name when 'timeline_events' then 1 else 2 end
     limit 1`
  );
  const table = t.rows?.[0]?.table_name as "timeline_events" | "timeline" | undefined;
  if (!table) return;

  await pool.query(
    `insert into ${table} (tenant_id, job_id, kind, message, meta)
     values ($1,$2,$3,$4,$5)`,
    [tenant_id, job_id ?? null, kind, message, meta ?? {}]
  );
}

// Map CRM stage strings into canonical keys used by workflows.
function canonicalStage(toStage: string): string {
  const s = (toStage || "").trim().toLowerCase();
  if (s.includes("lead")) return "lead";
  if (s.includes("work auth") || s.includes("wa")) return "work_auth_sent";
  if (s.includes("estimate")) return "estimate_sent";
  if (s.includes("contract")) return "contract_sent";
  if (s.includes("paid") || s.includes("final")) return "paid_final";
  if (s.includes("tarp") && (s.includes("inv") || s.includes("pkg") || s.includes("package"))) {
    return "tarp_inv_pkg_uploaded";
  }
  // fallback: normalize spaces
  return s.replace(/\s+/g, "_");
}

async function findOrCreateCustomer(tenant_id: number, full_name: string | null): Promise<number | null> {
  const name = (full_name || "").trim();
  if (!name) return null;

  // Try find
  const found = await pool.query(
    `select id from customers where tenant_id=$1 and full_name=$2 limit 1`,
    [tenant_id, name]
  );
  if (found.rows?.[0]?.id) return Number(found.rows[0].id);

  // Create
  const created = await pool.query(
    `insert into customers (tenant_id, full_name)
     values ($1,$2)
     returning id`,
    [tenant_id, name]
  );
  return created.rows?.[0]?.id ? Number(created.rows[0].id) : null;
}

async function upsertJob(args: {
  tenant_id: number;
  external_crm: string;
  external_job_id: string;
  stage: string;
  zip?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  customer_id?: number | null;
  job_type?: string | null;
}) {
  const {
    tenant_id,
    external_crm,
    external_job_id,
    stage,
    zip,
    address1,
    city,
    state,
    customer_id,
    job_type,
  } = args;

  // If job already exists, update it.
  const existing = await pool.query(
    `select id from jobs where tenant_id=$1 and external_job_id=$2 limit 1`,
    [tenant_id, external_job_id]
  );

  if (existing.rows?.[0]?.id) {
    const id = Number(existing.rows[0].id);
    await pool.query(
      `update jobs
          set stage=$1,
              zip=coalesce($2, zip),
              address1=coalesce($3, address1),
              city=coalesce($4, city),
              state=coalesce($5, state),
              customer_id=coalesce($6, customer_id),
              job_type=coalesce($7, job_type),
              updated_at=now()
        where id=$8`,
      [stage, zip ?? null, address1 ?? null, city ?? null, state ?? null, customer_id ?? null, job_type ?? null, id]
    );
    return id;
  }

  // Else insert new row.
  const ins = await pool.query(
    `insert into jobs
      (tenant_id, customer_id, external_crm, external_job_id, job_type, stage, address1, city, state, zip)
     values
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning id`,
    [
      tenant_id,
      customer_id ?? null,
      external_crm,
      null, // external_customer_id (not known yet)
      external_job_id,
      job_type ?? null,
      stage,
      address1 ?? null,
      city ?? null,
      state ?? null,
      zip ?? null,
    ].slice(0, 10) // keep it aligned with your actual jobs schema below
  ).catch(async () => {
    // Your jobs schema is known; re-run with the exact order (no external_customer_id insert)
    const ins2 = await pool.query(
      `insert into jobs
        (tenant_id, customer_id, external_crm, external_customer_id, external_job_id, job_type, stage, address1, city, state, zip)
       values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       returning id`,
      [
        tenant_id,
        customer_id ?? null,
        external_crm,
        null,
        external_job_id,
        job_type ?? null,
        stage,
        address1 ?? null,
        city ?? null,
        state ?? null,
        zip ?? null,
      ]
    );
    return ins2;
  });

  // ins may be QueryResult if first insert succeeded, or ins2 result if fallback.
  const row = (ins as any).rows?.[0];
  return row?.id ? Number(row.id) : null;
}

export async function registerEventRoutes(app: FastifyInstance) {
  app.post("/events", async (req, reply) => {
    const parsed = EventSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "Invalid body", details: parsed.error.flatten() });
    }

    const { tenant_slug, source, event_type, occurred_at, payload } = parsed.data;
    const tenant = await getTenantBySlug(tenant_slug);
    if (!tenant) return reply.code(404).send({ ok: false, error: "Tenant not found" });

    // Normalize payload fields we care about
    const external_job_id =
      String((payload as any).job_id ?? (payload as any).external_job_id ?? "").trim();

    if (!external_job_id) {
      await insertTimelineEvent({
        tenant_id: tenant.id,
        job_id: null,
        kind: "event_rejected",
        message: `${source}:${event_type} missing job_id`,
        meta: { payload, occurred_at },
      });
      return reply.code(400).send({ ok: false, error: "payload.job_id is required" });
    }

    const fromStage = String((payload as any).from ?? "");
    const toStage = String((payload as any).to ?? (payload as any).stage ?? "");
    const stageKey = canonicalStage(toStage || fromStage || "lead");

    const fullName = (payload as any).name ? String((payload as any).name) : null;

    const zip = (payload as any).zip ? String((payload as any).zip) : null;
    const address1 = (payload as any).address1 ? String((payload as any).address1) : null;
    const city = (payload as any).city ? String((payload as any).city) : null;
    const state = (payload as any).state ? String((payload as any).state) : null;

    // Create or find customer row (our current schema only supports full_name)
    const customer_id = await findOrCreateCustomer(tenant.id, fullName);

    // Create/update job, link customer_id
    const jobId = await upsertJob({
      tenant_id: tenant.id,
      external_crm: source,
      external_job_id,
      stage: stageKey,
      zip,
      address1,
      city,
      state,
      customer_id,
      job_type: (payload as any).job_type ? String((payload as any).job_type) : null,
    });

    await insertTimelineEvent({
      tenant_id: tenant.id,
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

    // Start workflow (if your decision matrix module exists)
    // This keeps your existing behavior but won't crash if the module isn't wired yet.
    if (typeof startWorkflowForJob === "function") {
      try {
        await startWorkflowForJob({
          tenant_id: tenant.id,
          job_id: jobId,
          stage: stageKey,
          payload,
        });
        await insertTimelineEvent({
          tenant_id: tenant.id,
          job_id: jobId,
          kind: "workflow_started",
          message: `workflow started for stage=${stageKey}`,
          meta: { stage: stageKey },
        });
      } catch (e: any) {
        await insertTimelineEvent({
          tenant_id: tenant.id,
          job_id: jobId,
          kind: "workflow_start_failed",
          message: `workflow start failed for stage=${stageKey}`,
          meta: { error: String(e?.message || e) },
        });
      }
    }

    return reply.send({ ok: true, tenant_id: tenant.id, job_id: jobId, customer_id });
  });
}
