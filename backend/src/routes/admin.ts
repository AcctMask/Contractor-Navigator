import { FastifyInstance } from "fastify";
import { pool } from "../db/db";
import { runSchedulerTick } from "../services/scheduler";
import crypto from "crypto";

async function timeline(tenantId: number, kind: string, message: string, meta: any = {}) {
  await pool.query(
    `insert into timeline_events (tenant_id, kind, message, meta)
     values ($1,$2,$3,$4::jsonb)`,
    [tenantId, kind, message, JSON.stringify(meta)]
  );
}

async function getTenantIdBySlug(slug: string): Promise<number> {
  const t = await pool.query(`select id from tenants where slug=$1`, [slug]);
  if (!t.rowCount) throw new Error(`tenant not found: ${slug}`);
  return Number(t.rows[0].id);
}

function normPhone(p: string): string {
  const s = String(p || "").trim();
  if (!s) return "";
  // keep + and digits only
  const cleaned = s.replace(/[^\d+]/g, "");
  // if no +, assume US and add +1 when 10 digits
  if (!cleaned.startsWith("+")) {
    const digits = cleaned.replace(/[^\d]/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return digits ? `+${digits}` : "";
  }
  return cleaned;
}

export async function adminRoutes(app: FastifyInstance) {
  /**
   * BOOTSTRAP V2
   */
  app.post("/admin/bootstrap_v2", async () => {
    await pool.query(`
      create table if not exists tenants (
        id bigserial primary key,
        slug text unique not null,
        name text not null,
        created_at timestamptz not null default now()
      );
    `);

    await pool.query(`
      create table if not exists jobs (
        id bigserial primary key,
        tenant_id bigint not null references tenants(id) on delete cascade,
        external_crm text not null,
        external_job_id text not null,
        job_type text not null default 'unknown',
        stage text not null default 'lead',
        zip text null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(tenant_id, external_job_id)
      );
    `);

    await pool.query(`
      create table if not exists events (
        id bigserial primary key,
        tenant_id bigint not null references tenants(id) on delete cascade,
        source text not null,
        event_type text not null,
        occurred_at timestamptz not null,
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
    `);

    await pool.query(`
      create table if not exists timeline_events (
        id bigserial primary key,
        tenant_id bigint not null references tenants(id) on delete cascade,
        kind text not null,
        message text not null,
        meta jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
    `);

    await pool.query(`
      create table if not exists workflow_configs (
        id bigserial primary key,
        tenant_id bigint not null references tenants(id) on delete cascade,
        workflow_key text not null,
        step_order int not null,
        step_name text not null,
        delay_minutes int not null default 0,
        channel text not null default 'sms',
        message_template text not null default '',
        enabled boolean not null default true,
        max_attempts int not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(tenant_id, workflow_key, step_order)
      );
    `);

    await pool.query(`
      create table if not exists scheduled_actions (
        id bigserial primary key,
        tenant_id bigint not null references tenants(id) on delete cascade,
        job_id bigint not null,
        action_key text not null,
        run_at timestamptz not null,
        status text not null default 'pending',
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);

    // ===== NEW: customers mirror (JobProgress contact/customer)
    await pool.query(`
      create table if not exists customers (
        id bigserial primary key,
        tenant_id bigint not null references tenants(id) on delete cascade,
        external_customer_id text null,
        name text null,
        email text null,
        phone text null,
        preferred_language text not null default 'en',
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(tenant_id, external_customer_id)
      );
    `);

    // ===== NEW: DNC list (tenant-wide)
    await pool.query(`
      create table if not exists dnc (
        id bigserial primary key,
        tenant_id bigint not null references tenants(id) on delete cascade,
        phone text not null,
        reason text not null default 'opt_out',
        source text not null default 'system',
        created_at timestamptz not null default now(),
        unique(tenant_id, phone)
      );
    `);

    // ===== NEW: customer portal tokens
    await pool.query(`
      create table if not exists customer_portal_tokens (
        id bigserial primary key,
        tenant_id bigint not null references tenants(id) on delete cascade,
        customer_id bigint not null references customers(id) on delete cascade,
        token text not null unique,
        created_at timestamptz not null default now(),
        expires_at timestamptz null
      );
    `);

    return { ok: true };
  });

  app.post("/admin/seed-g2g", async () => {
    const slug = "g2g-roofing";
    const name = "Good2Go Roofing and Construction LLC";

    const r = await pool.query(
      `
      insert into tenants (slug, name)
      values ($1,$2)
      on conflict (slug) do update set name=excluded.name
      returning id, slug, name, created_at
      `,
      [slug, name]
    );

    return { ok: true, tenant: r.rows[0] };
  });

  /**
   * Seed workflows (same as your working baseline)
   */
  app.post("/admin/seed-workflows-g2g", async () => {
    const tenantId = await getTenantIdBySlug("g2g-roofing");

    const upsert = async (w: any) => {
      await pool.query(
        `
        insert into workflow_configs
          (tenant_id, workflow_key, step_order, step_name, delay_minutes, channel, message_template, enabled, max_attempts, updated_at)
        values
          ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
        on conflict (tenant_id, workflow_key, step_order)
        do update set
          step_name=excluded.step_name,
          delay_minutes=excluded.delay_minutes,
          channel=excluded.channel,
          message_template=excluded.message_template,
          enabled=excluded.enabled,
          max_attempts=excluded.max_attempts,
          updated_at=now()
        `,
        [
          tenantId,
          w.workflow_key,
          w.step_order,
          w.step_name,
          w.delay_minutes,
          w.channel,
          w.message_template,
          w.enabled ?? true,
          w.max_attempts ?? 1,
        ]
      );
    };

    const estimate_followup = [
      {
        workflow_key: "estimate_followup",
        step_order: 1,
        step_name: "confirm_received",
        delay_minutes: 10,
        channel: "sms",
        message_template:
          "Hi {{name}} — we sent your roofing estimate. Did you receive it okay? If you have any questions just reply here.",
      },
      {
        workflow_key: "estimate_followup",
        step_order: 2,
        step_name: "preferred_vendor_positioning",
        delay_minutes: 1440,
        channel: "sms",
        message_template:
          "Just following up {{name}} — when we installed your emergency tarp we also inspected and documented the roof for the insurance company. Since they dispatched us as a preferred vendor we already have the measurements and photo report if you decide to move forward.",
      },
      {
        workflow_key: "estimate_followup",
        step_order: 3,
        step_name: "objection_prompt",
        delay_minutes: 4320,
        channel: "sms",
        message_template:
          "Checking in again {{name}} — if you’re still considering it, tell me what’s holding you back (timing, scope or price) and we’ll see what we can do.",
      },
      {
        workflow_key: "estimate_followup",
        step_order: 4,
        step_name: "if_i_could_would_you",
        delay_minutes: 7200,
        channel: "sms",
        message_template:
          "If I could, would you… If we could get this done for a number that works for you what price would you commit to? No pressure, just seeing if there’s a deal to be made.",
      },
      {
        workflow_key: "estimate_followup",
        step_order: 5,
        step_name: "conditional_contract_offer",
        delay_minutes: 8640,
        channel: "sms",
        message_template:
          "If you’re comfortable, the next step is a simple agreement at that number so I can take it to ownership for approval. If they approve it we move into production. If they can’t, they will present what they can do and you can accept or decline. If you decline, the agreement is void.",
      },
    ];

    const lead = [
      {
        workflow_key: "lead",
        step_order: 1,
        step_name: "welcome",
        delay_minutes: 10,
        channel: "sms",
        message_template:
          "Hi {{name}} — thanks for reaching out to Good2Go Roofing. What can we help you with today (tarp, leak, repair, replacement)? Reply here anytime.",
      },
    ];

    const contract_sent = [
      {
        workflow_key: "contract_sent",
        step_order: 1,
        step_name: "contract_nudge",
        delay_minutes: 1440,
        channel: "sms",
        message_template:
          "Hi {{name}} — quick check-in on the agreement we sent. If you’d like, reply ‘CALL’ and we’ll go over it with you.",
      },
    ];

    const paid = [
      {
        workflow_key: "paid",
        step_order: 1,
        step_name: "thank_you_review_referral",
        delay_minutes: 1440,
        channel: "email",
        message_template:
          "Thank you {{name}} for trusting Good2Go Roofing. If you’re happy with our work, a 5-star Google review helps more than you know. If you’re not comfortable leaving 5 stars, reply and tell us what we can do to earn it. Also: we pay 5% on any full replacement referral.",
      },
    ];

    const tarp_inv_pkg_uploaded = [
      {
        workflow_key: "tarp_inv_pkg_uploaded",
        step_order: 1,
        step_name: "insurance_process_positioning",
        delay_minutes: 10,
        channel: "sms",
        message_template:
          "Hi {{name}} — we uploaded the tarp invoice + photo documentation. Your desk adjuster will determine causation, scope, and coverage based on your policy. If coverage includes roofing, we’re a licensed roofer and preferred vendor (they already dispatched us). If the process drags out, we can also offer a simple conditional agreement that becomes effective only if coverage is approved.",
      },
    ];

    for (const w of [...estimate_followup, ...lead, ...contract_sent, ...paid, ...tarp_inv_pkg_uploaded]) {
      await upsert(w);
    }

    await timeline(tenantId, "workflows_seeded", "Seeded workflows for g2g-roofing", {});
    return { ok: true };
  });

  // ===== Step Editor Endpoints =====

  app.post("/admin/workflows/:tenant_slug/:workflow_key/step-delay", async (req) => {
    const tenantSlug = String((req.params as any).tenant_slug || "");
    const workflowKey = String((req.params as any).workflow_key || "");
    const body: any = req.body || {};
    const stepOrder = Number(body.step_order);
    const delayMinutes = Number(body.delay_minutes);

    if (!tenantSlug || !workflowKey || !Number.isFinite(stepOrder) || !Number.isFinite(delayMinutes)) {
      return { ok: false, error: "Body required: { step_order:number, delay_minutes:number }" };
    }

    const tenantId = await getTenantIdBySlug(tenantSlug);

    await pool.query(
      `update workflow_configs
       set delay_minutes=$1, updated_at=now()
       where tenant_id=$2 and workflow_key=$3 and step_order=$4`,
      [delayMinutes, tenantId, workflowKey, stepOrder]
    );

    await timeline(tenantId, "workflow_step_updated", `Updated delay for ${workflowKey} step ${stepOrder}`, {
      workflow_key: workflowKey,
      step_order: stepOrder,
      delay_minutes: delayMinutes,
    });

    return { ok: true };
  });

  app.post("/admin/workflows/:tenant_slug/:workflow_key/step-message", async (req) => {
    const tenantSlug = String((req.params as any).tenant_slug || "");
    const workflowKey = String((req.params as any).workflow_key || "");
    const body: any = req.body || {};
    const stepOrder = Number(body.step_order);
    const messageTemplate = String(body.message_template || "");

    if (!tenantSlug || !workflowKey || !Number.isFinite(stepOrder) || !messageTemplate) {
      return { ok: false, error: "Body required: { step_order:number, message_template:string }" };
    }

    const tenantId = await getTenantIdBySlug(tenantSlug);

    await pool.query(
      `update workflow_configs
       set message_template=$1, updated_at=now()
       where tenant_id=$2 and workflow_key=$3 and step_order=$4`,
      [messageTemplate, tenantId, workflowKey, stepOrder]
    );

    await timeline(tenantId, "workflow_step_updated", `Updated message for ${workflowKey} step ${stepOrder}`, {
      workflow_key: workflowKey,
      step_order: stepOrder,
      message_template: messageTemplate,
    });

    return { ok: true };
  });

  app.post("/admin/workflows/:tenant_slug/:workflow_key/step-enable", async (req) => {
    const tenantSlug = String((req.params as any).tenant_slug || "");
    const workflowKey = String((req.params as any).workflow_key || "");
    const body: any = req.body || {};
    const stepOrder = Number(body.step_order);
    const enabled = Boolean(body.enabled);

    if (!tenantSlug || !workflowKey || !Number.isFinite(stepOrder)) {
      return { ok: false, error: "Body required: { step_order:number, enabled:boolean }" };
    }

    const tenantId = await getTenantIdBySlug(tenantSlug);

    await pool.query(
      `update workflow_configs
       set enabled=$1, updated_at=now()
       where tenant_id=$2 and workflow_key=$3 and step_order=$4`,
      [enabled, tenantId, workflowKey, stepOrder]
    );

    await timeline(tenantId, "workflow_step_updated", `Updated enabled for ${workflowKey} step ${stepOrder}`, {
      workflow_key: workflowKey,
      step_order: stepOrder,
      enabled,
    });

    return { ok: true };
  });

  // ===== NEW: Customer import + DNC + Portal =====

  /**
   * Import/Upsert customers from JobProgress (Michelle/Zapier will call this)
   * Body: { tenant_slug, customers: [{external_customer_id,name,email,phone,preferred_language,metadata}] }
   * DNC filter: if phone already DNC, we still store customer but mark in metadata.dnc=true (so you can see them)
   */
  app.post("/admin/customers/import", async (req) => {
    const body: any = req.body || {};
    const tenantSlug = String(body.tenant_slug || "");
    const list: any[] = Array.isArray(body.customers) ? body.customers : [];

    if (!tenantSlug || !Array.isArray(list)) {
      return { ok: false, error: "Body required: { tenant_slug, customers:[...] }" };
    }

    const tenantId = await getTenantIdBySlug(tenantSlug);

    let upserted = 0;

    for (const c of list) {
      const external_customer_id = c.external_customer_id ? String(c.external_customer_id) : null;
      const name = c.name ? String(c.name) : null;
      const email = c.email ? String(c.email) : null;
      const phone = c.phone ? normPhone(String(c.phone)) : null;
      const preferred_language = c.preferred_language ? String(c.preferred_language) : "en";
      const metadata = c.metadata && typeof c.metadata === "object" ? c.metadata : {};

      // check DNC
      let isDnc = false;
      if (phone) {
        const dr = await pool.query(`select 1 from dnc where tenant_id=$1 and phone=$2`, [tenantId, phone]);
        isDnc = !!dr.rowCount;
      }

      metadata.dnc = isDnc;

      await pool.query(
        `
        insert into customers (tenant_id, external_customer_id, name, email, phone, preferred_language, metadata, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7::jsonb, now())
        on conflict (tenant_id, external_customer_id)
        do update set
          name=excluded.name,
          email=excluded.email,
          phone=excluded.phone,
          preferred_language=excluded.preferred_language,
          metadata=excluded.metadata,
          updated_at=now()
        `,
        [tenantId, external_customer_id, name, email, phone, preferred_language, JSON.stringify(metadata)]
      );

      upserted++;
    }

    await timeline(tenantId, "customers_imported", `Imported customers: ${upserted}`, { count: upserted });
    return { ok: true, imported: upserted };
  });

  /**
   * Manually add to DNC (internal use)
   * Body: { tenant_slug, phone, reason?, source? }
   */
  app.post("/admin/dnc/add", async (req) => {
    const body: any = req.body || {};
    const tenantSlug = String(body.tenant_slug || "");
    const phone = normPhone(String(body.phone || ""));
    const reason = body.reason ? String(body.reason) : "manual";
    const source = body.source ? String(body.source) : "admin";

    if (!tenantSlug || !phone) return { ok: false, error: "Body required: { tenant_slug, phone }" };

    const tenantId = await getTenantIdBySlug(tenantSlug);

    await pool.query(
      `
      insert into dnc (tenant_id, phone, reason, source)
      values ($1,$2,$3,$4)
      on conflict (tenant_id, phone)
      do update set reason=excluded.reason, source=excluded.source
      `,
      [tenantId, phone, reason, source]
    );

    await timeline(tenantId, "dnc_added", `DNC added ${phone}`, { phone, reason, source });
    return { ok: true };
  });

  /**
   * Generate a customer portal token (you can email/text this later)
   * Body: { tenant_slug, external_customer_id }
   */
  app.post("/admin/portal/create", async (req) => {
    const body: any = req.body || {};
    const tenantSlug = String(body.tenant_slug || "");
    const externalCustomerId = body.external_customer_id ? String(body.external_customer_id) : "";

    if (!tenantSlug || !externalCustomerId) {
      return { ok: false, error: "Body required: { tenant_slug, external_customer_id }" };
    }

    const tenantId = await getTenantIdBySlug(tenantSlug);

    const cr = await pool.query(
      `select id from customers where tenant_id=$1 and external_customer_id=$2 limit 1`,
      [tenantId, externalCustomerId]
    );
    if (!cr.rowCount) return { ok: false, error: "customer not found (import first)" };

    const customerId = Number(cr.rows[0].id);
    const token = crypto.randomBytes(24).toString("hex");

    await pool.query(
      `
      insert into customer_portal_tokens (tenant_id, customer_id, token)
      values ($1,$2,$3)
      `,
      [tenantId, customerId, token]
    );

    await timeline(tenantId, "portal_token_created", `Portal token created for customer ${externalCustomerId}`, {
      external_customer_id: externalCustomerId,
      token_hint: token.slice(0, 6) + "…",
    });

    return { ok: true, token, url_path: `/portal/${token}` };
  });

  // ===== Scheduler =====
  app.post("/admin/tick", async () => {
    return runSchedulerTick(25);
  });

  // ===== Timeline =====
  app.get("/admin/timeline/:tenant_slug", async (req) => {
    const tenantSlug = String((req.params as any).tenant_slug || "");
    const limit = Math.min(Number((req.query as any)?.limit || 50), 500);
    const tenantId = await getTenantIdBySlug(tenantSlug);

    const r = await pool.query(
      `
      select id, kind, message, meta, created_at
      from timeline_events
      where tenant_id=$1
      order by created_at desc
      limit $2
      `,
      [tenantId, limit]
    );

    return { ok: true, items: r.rows };
  });

  /**
   * Job-level history (existing feature)
   */
  app.get("/admin/history/:tenant_slug/:external_job_id", async (req) => {
    const tenantSlug = String((req.params as any).tenant_slug || "");
    const externalJobId = String((req.params as any).external_job_id || "");
    const limit = Math.min(Number((req.query as any)?.limit || 200), 1000);

    const tenantId = await getTenantIdBySlug(tenantSlug);

    const jr = await pool.query(
      `select id, external_job_id, stage, zip, created_at, updated_at
       from jobs
       where tenant_id=$1 and external_job_id=$2
       limit 1`,
      [tenantId, externalJobId]
    );

    if (!jr.rowCount) return { ok: false, error: `job not found: ${externalJobId}` };

    const job = jr.rows[0];
    const jobId = Number(job.id);

    const [events, actions, notes] = await Promise.all([
      pool.query(
        `
        select id, source, event_type, occurred_at, payload, created_at
        from events
        where tenant_id=$1 and payload->>'job_id' = $2
        order by created_at desc
        limit $3
        `,
        [tenantId, externalJobId, limit]
      ),
      pool.query(
        `
        select id, action_key, run_at, status, payload, created_at, updated_at
        from scheduled_actions
        where tenant_id=$1 and job_id=$2
        order by created_at desc
        limit $3
        `,
        [tenantId, jobId, limit]
      ),
      pool.query(
        `
        select id, kind, message, meta, created_at
        from timeline_events
        where tenant_id=$1
          and (
            meta->>'job_external_id' = $2
            or message ilike '%' || $2 || '%'
          )
        order by created_at desc
        limit $3
        `,
        [tenantId, externalJobId, limit]
      ),
    ]);

    return { ok: true, job, timeline: notes.rows, events: events.rows, scheduled_actions: actions.rows };
  });

  /**
   * Customer portal view (token-based)
   * Returns customer profile + notes + (for now) most recent tenant timeline slice.
   */
  app.get("/portal/:token", async (req) => {
    const token = String((req.params as any).token || "");
    if (!token) return { ok: false, error: "token required" };

    const tr = await pool.query(
      `
      select t.tenant_id, t.customer_id, t.expires_at
      from customer_portal_tokens t
      where t.token=$1
      limit 1
      `,
      [token]
    );
    if (!tr.rowCount) return { ok: false, error: "invalid token" };

    const tenantId = Number(tr.rows[0].tenant_id);
    const customerId = Number(tr.rows[0].customer_id);

    const cr = await pool.query(
      `select id, external_customer_id, name, email, phone, preferred_language, metadata, created_at, updated_at
       from customers where id=$1 limit 1`,
      [customerId]
    );

    if (!cr.rowCount) return { ok: false, error: "customer missing" };
    const customer = cr.rows[0];

    // Notes: for now filter by phone match (strong practical linkage early on)
    const phone = customer.phone ? String(customer.phone) : "";
    const notes = phone
      ? await pool.query(
          `
          select id, kind, message, meta, created_at
          from timeline_events
          where tenant_id=$1
            and (meta->>'from' = $2 or meta->>'to' = $2 or message ilike '%'||$2||'%')
          order by created_at desc
          limit 500
          `,
          [tenantId, phone]
        )
      : await pool.query(
          `
          select id, kind, message, meta, created_at
          from timeline_events
          where tenant_id=$1
          order by created_at desc
          limit 100
          `,
          [tenantId]
        );

    return { ok: true, customer, notes: notes.rows };
  });

  // ===== Workflow read/pause/enable =====

  app.get("/admin/workflows/:tenant_slug/:workflow_key", async (req) => {
    const tenantSlug = String((req.params as any).tenant_slug || "");
    const workflowKey = String((req.params as any).workflow_key || "");
    const tenantId = await getTenantIdBySlug(tenantSlug);

    const r = await pool.query(
      `
      select workflow_key, step_order, step_name, delay_minutes, channel, message_template, enabled, max_attempts
      from workflow_configs
      where tenant_id=$1 and workflow_key=$2
      order by step_order asc
      `,
      [tenantId, workflowKey]
    );

    return { ok: true, items: r.rows };
  });

  app.post("/admin/workflows/:tenant_slug/:workflow_key/pause", async (req) => {
    const tenantSlug = String((req.params as any).tenant_slug || "");
    const workflowKey = String((req.params as any).workflow_key || "");
    const tenantId = await getTenantIdBySlug(tenantSlug);

    await pool.query(
      `update workflow_configs set enabled=false, updated_at=now()
       where tenant_id=$1 and workflow_key=$2`,
      [tenantId, workflowKey]
    );

    await timeline(tenantId, "workflow_paused", `Paused workflow ${workflowKey}`, { workflow_key: workflowKey });
    return { ok: true };
  });

  app.post("/admin/workflows/:tenant_slug/:workflow_key/enable", async (req) => {
    const tenantSlug = String((req.params as any).tenant_slug || "");
    const workflowKey = String((req.params as any).workflow_key || "");
    const tenantId = await getTenantIdBySlug(tenantSlug);

    await pool.query(
      `update workflow_configs set enabled=true, updated_at=now()
       where tenant_id=$1 and workflow_key=$2`,
      [tenantId, workflowKey]
    );

    await timeline(tenantId, "workflow_enabled", `Enabled workflow ${workflowKey}`, { workflow_key: workflowKey });
    return { ok: true };
  });
}
