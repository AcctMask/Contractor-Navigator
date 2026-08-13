import type { FastifyInstance } from "fastify";
import { pool } from "../db/db";
import { schedulerTick } from "../services/scheduler";
import { listJobAssetsByTenantSlug } from "../services/jobAssetsService";
import { getCurrentUserFromToken } from "../services/authService";

async function getTenantIdBySlug(slug: string): Promise<number> {
  const t = await pool.query(`select id from tenants where slug=$1 limit 1`, [slug]);
  if (!t.rowCount) throw new Error(`tenant not found: ${slug}`);
  return Number(t.rows[0].id);
}

function asNullableString(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function getBearerToken(request: any) {
  const auth = String(request.headers.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

async function requireAssignmentManager(request: any, reply: any) {
  const token = getBearerToken(request);

  if (!token) {
    reply.code(401);
    return null;
  }

  const user = await getCurrentUserFromToken(token);

  if (!user?.is_active) {
    reply.code(401);
    return null;
  }

  const allowedRoles = ["platform_owner", "tenant_admin", "admin", "manager"];

  if (!allowedRoles.includes(String(user.role))) {
    reply.code(403);
    return null;
  }

  return user;
}

async function requireJobReadUser(
  request: any,
  reply: any,
  tenantId: number
) {
  const token = getBearerToken(request);

  if (!token) {
    return reply.code(401).send({
      ok: false,
      error: "Authentication required"
    });
  }

  try {
    const user = await getCurrentUserFromToken(token);

    if (!user?.is_active) {
      return reply.code(401).send({
        ok: false,
        error: "Authentication required"
      });
    }

    if (
      String(user.role) !== "platform_owner" &&
      Number(user.tenant_id) !== tenantId
    ) {
      return reply.code(403).send({
        ok: false,
        error: "Tenant access denied"
      });
    }

    return user;
  } catch {
    return reply.code(401).send({
      ok: false,
      error: "Authentication required"
    });
  }
}

async function ensureCrewAssignmentUserColumn() {
  await pool.query(`
    alter table crew_assignments
    add column if not exists app_user_id bigint null
  `);

  await pool.query(`
    create index if not exists idx_crew_assignments_tenant_user
    on crew_assignments (tenant_id, app_user_id)
  `);
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post("/admin/scheduler/tick", async (req, reply) => {
    const body: any = (req as any).body || {};
    const limit = Number(body.limit || 25);

    await schedulerTick(limit);

    return reply.send({ ok: true, ticked: true, limit });
  });

  app.post("/admin/create-job/:tenant_slug", async (req, reply) => {
    try {
      const tenant_slug = String((req.params as any).tenant_slug || "");
      const tenantId = await getTenantIdBySlug(tenant_slug);
      const body: any = (req as any).body || {};

      const customer_name = asNullableString(body.customer_name);
      const customer_phone = asNullableString(body.customer_phone);
      const customer_email = asNullableString(body.customer_email);
      const address1 = asNullableString(body.address1 ?? body.address);
      const city = asNullableString(body.city);
      const state = asNullableString(body.state);
      const zip = asNullableString(body.zip);
      const stage = asNullableString(body.stage) || "lead";

      if (!customer_name) {
        return reply.code(400).send({ ok: false, error: "customer_name required" });
      }

      const customerRes = await pool.query(
        `
        insert into customers
          (tenant_id, full_name, phone, email, created_at, updated_at)
        values
          ($1, $2, $3, $4, now(), now())
        returning id, tenant_id, full_name, phone, email, created_at, updated_at
        `,
        [tenantId, customer_name, customer_phone, customer_email]
      );

      const customer = customerRes.rows[0];

      const jobRes = await pool.query(
        `
        insert into jobs
          (
            tenant_id,
            customer_id,
            external_crm,
            external_job_id,
            external_customer_id,
            external_customer_name,
            customer_phone,
            customer_email,
            stage,
            job_type,
            address1,
            city,
            state,
            zip,
            lead_source,
            lead_source_detail,
            created_at,
            updated_at
          )
        values
          (
            $1,
            $2,
            'manual',
            null,
            $3,
            $4,
            $5,
            $6,
            $7,
            'inspection',
            $8,
            $9,
            $10,
            $11,
            'manual',
            'admin_create_job',
            now(),
            now()
          )
        returning *
        `,
        [
          tenantId,
          customer.id,
          String(customer.id),
          customer_name,
          customer_phone,
          customer_email,
          stage,
          address1,
          city,
          state,
          zip,
        ]
      );

      const job = jobRes.rows[0];

      await pool.query(
        `
        insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
        values ($1, $2, 'manual_job_created', 'Job manually created from Job Admin', $3::jsonb, now())
        `,
        [
          tenantId,
          job.id,
          JSON.stringify({
            customer_name,
            customer_phone,
            customer_email,
            address1,
            city,
            state,
            zip,
            stage,
          }),
        ]
      );

      return reply.send({ ok: true, tenant_id: tenantId, customer, job });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err?.message || "Create job failed" });
    }
  });

  app.get("/admin/timeline/:tenant_slug", async (req, reply) => {
    const tenant_slug = String((req.params as any).tenant_slug || "");
    const tenantId = await getTenantIdBySlug(tenant_slug);
    const q: any = (req.query as any) || {};

    const from = asNullableString(q.from);
    const to = asNullableString(q.to);
    const limit = Number(q.limit || 200);

    const notes = await pool.query(
      `
      select id, job_id, kind, message, meta, created_at
        from timeline_events
       where tenant_id=$1
         and ($2::timestamptz is null or created_at >= $2::timestamptz)
         and ($3::timestamptz is null or created_at <= $3::timestamptz)
       order by id desc
       limit $4
      `,
      [tenantId, from, to, limit]
    );

    return reply.send({
      ok: true,
      tenant_id: tenantId,
      filters: { from, to, limit },
      timeline: notes.rows
    });
  });

  app.get("/admin/scheduled/:tenant_slug", async (req, reply) => {
    const tenant_slug = String((req.params as any).tenant_slug || "");
    const tenantId = await getTenantIdBySlug(tenant_slug);

    const actions = await pool.query(
      `
      select id, job_id, action_key, status, run_at, payload, created_at, updated_at
        from scheduled_actions
       where tenant_id=$1
       order by id desc
       limit 200
      `,
      [tenantId]
    );

    return reply.send({ ok: true, tenant_id: tenantId, scheduled_actions: actions.rows });
  });

  app.post("/admin/bootstrap-crm/:tenant_slug", async (req, reply) => {
    const tenant_slug = String((req.params as any).tenant_slug || "");
    const tenantId = await getTenantIdBySlug(tenant_slug);

    await pool.query(`
      create table if not exists job_contacts (
        id bigserial primary key,
        tenant_id bigint not null,
        job_id bigint not null,
        contact_role text not null default 'primary',
        full_name text,
        phone text,
        email text,
        is_primary boolean not null default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);

    await pool.query(`
      create table if not exists job_insurance (
        id bigserial primary key,
        tenant_id bigint not null,
        job_id bigint not null unique,
        carrier text,
        claim_number text,
        policy_holder text,
        adjuster_name text,
        adjuster_phone text,
        adjuster_email text,
        assignment_subject text,
        assignment_notes text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);

    await pool.query(`
      create table if not exists job_damage_reports (
        id bigserial primary key,
        tenant_id bigint not null,
        job_id bigint not null,
        damage_location text,
        damage_type text,
        tree_damage boolean not null default false,
        missing_shingles boolean not null default false,
        missing_plywood boolean not null default false,
        leak_present boolean not null default false,
        notes text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);

    await pool.query(`
      create table if not exists job_documents (
        id bigserial primary key,
        tenant_id bigint not null,
        job_id bigint not null,
        document_type text not null,
        file_url text,
        signed boolean not null default false,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);

    await pool.query(`
      create table if not exists crew_assignments (
        id bigserial primary key,
        tenant_id bigint not null,
        job_id bigint not null,
        crew_name text,
        assigned_by text,
        status text not null default 'PENDING',
        assigned_at timestamptz not null default now(),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);

    await pool.query(`
      alter table jobs
      add column if not exists crm_flow_key text,
      add column if not exists crm_substatus text,
      add column if not exists manual_owner text,
      add column if not exists bot_paused boolean not null default false,
      add column if not exists bot_pause_reason text,
      add column if not exists active_followup_workflow text,
      add column if not exists followup_workflow_started_at timestamptz,

      add column if not exists tarp_conversion_active boolean not null default false,
      add column if not exists tarp_conversion_started_at timestamptz,
      add column if not exists contract_status text,
      add column if not exists estimate_status text,
      add column if not exists last_human_note text,
      add column if not exists carrier text,
      add column if not exists claim_number text,
      add column if not exists date_of_loss date,
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
      add column if not exists lead_source text,
      add column if not exists lead_source_detail text,
      add column if not exists marketing_campaign text;
    `);

    await pool.query(`
      -- CENTRAL FOLLOW-UP WORKFLOW LIFECYCLE
      create or replace function sync_job_followup_workflow()
      returns trigger
      language plpgsql
      as $$
      declare
        derived_workflow text;
      begin
        if new.stage in ('archived', 'disqualified') then
          derived_workflow := null;

        elsif new.crm_flow_key = 'weather_evidence_report' then
          derived_workflow := 'weather_evidence_report';

        elsif new.stage = 'lead' then
          derived_workflow := 'lead';

        elsif new.stage = 'tarp_complete' then
          derived_workflow := 'tarp';

        elsif new.stage = 'estimate_sent' then
          derived_workflow := 'estimate_sent';

        elsif new.stage = 'contract_sent' then
          derived_workflow := 'contract_sent';

        elsif tg_op = 'UPDATE' then
          derived_workflow := old.active_followup_workflow;

        else
          derived_workflow := new.active_followup_workflow;
        end if;

        if tg_op = 'INSERT' then
          new.active_followup_workflow := derived_workflow;

          if derived_workflow is null then
            new.followup_workflow_started_at := null;
          else
            new.followup_workflow_started_at :=
              coalesce(new.followup_workflow_started_at, now());
          end if;

        elsif derived_workflow is distinct from old.active_followup_workflow then
          new.active_followup_workflow := derived_workflow;

          if derived_workflow is null then
            new.followup_workflow_started_at := null;
          else
            new.followup_workflow_started_at := now();
          end if;

        else
          new.active_followup_workflow := old.active_followup_workflow;
          new.followup_workflow_started_at :=
            old.followup_workflow_started_at;
        end if;

        return new;
      end;
      $$;

      drop trigger if exists jobs_sync_followup_workflow on jobs;

      create trigger jobs_sync_followup_workflow
      before insert or update of stage, crm_flow_key
      on jobs
      for each row
      execute function sync_job_followup_workflow();
    `);


    await pool.query(
      `
      insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
      values ($1, null, 'crm_bootstrap_complete', 'Good2Go CRM layer bootstrapped', '{}'::jsonb, now())
      `,
      [tenantId]
    );

    return reply.send({ ok: true, tenant_id: tenantId, bootstrapped: true });
  });

  app.get("/admin/reports/:tenant_slug", async (req, reply) => {
    const tenant_slug = String((req.params as any).tenant_slug || "");
    const tenantId = await getTenantIdBySlug(tenant_slug);
    const q: any = (req.query as any) || {};
    const range = String(q.range || "30d");

    let fromSql = "now() - interval '30 days'";
    if (range === "7d") fromSql = "now() - interval '7 days'";
    if (range === "all") fromSql = "null";

    const dateFilter = range === "all" ? "" : `and j.created_at >= ${fromSql}`;

    const bySource = await pool.query(
      `
      select
        coalesce(nullif(trim(j.lead_source_detail), ''), nullif(trim(j.lead_source), ''), 'unknown') as label,
        count(*)::int as count
      from jobs j
      where j.tenant_id = $1
      ${dateFilter}
      group by 1
      order by count desc, label asc
      limit 50
      `,
      [tenantId]
    );

    const byJobType = await pool.query(
      `
      select
        coalesce(nullif(trim(j.job_type), ''), 'unknown') as label,
        count(*)::int as count
      from jobs j
      where j.tenant_id = $1
      ${dateFilter}
      group by 1
      order by count desc, label asc
      `,
      [tenantId]
    );

    const byStage = await pool.query(
      `
      select
        coalesce(nullif(trim(j.stage), ''), 'unknown') as label,
        count(*)::int as count
      from jobs j
      where j.tenant_id = $1
      ${dateFilter}
      group by 1
      order by count desc, label asc
      `,
      [tenantId]
    );

    return reply.send({
      ok: true,
      tenant_id: tenantId,
      range,
      by_source: bySource.rows,
      by_job_type: byJobType.rows,
      by_stage: byStage.rows,
    });
  });

  app.get("/admin/jobs/:tenant_slug", async (req, reply) => {
    const tenant_slug = String((req.params as any).tenant_slug || "");
    const tenantId = await getTenantIdBySlug(tenant_slug);
    const q: any = (req.query as any) || {};

    const from = asNullableString(q.from);
    const to = asNullableString(q.to);
    const lead_source = asNullableString(q.lead_source);
    const limit = Number(q.limit || 250);

    const jobs = await pool.query(
      `
      select
        j.id,
        j.external_job_id,
        j.stage,
        j.crm_flow_key,
        j.crm_substatus,
        j.bot_paused,
        j.manual_owner,
        j.address1,
        j.city,
        j.state,
        j.zip,
        j.carrier,
        j.claim_number,
        j.wa_status,
        j.estimate_status,
        j.contract_status,
        j.lead_source,
        j.lead_source_detail,
        j.marketing_campaign,
        j.created_at,
        j.updated_at,
        exists (
          select 1
          from timeline_events te
          where te.tenant_id = j.tenant_id
            and te.job_id = j.id
            and te.kind = 'buying_signal_detected'
        ) as has_buying_signal,
        c.full_name as customer_name
      from jobs j
      left join customers c
        on c.id = j.customer_id
       and c.tenant_id = j.tenant_id
      where j.tenant_id = $1
        and coalesce(j.stage, '') not in ('intake_pending', 'archived')
        and ($2::timestamptz is null or j.created_at >= $2::timestamptz)
        and ($3::timestamptz is null or j.created_at <= $3::timestamptz)
        and ($4::text is null or j.lead_source = $4::text)
      order by j.updated_at desc nulls last, j.id desc
      limit $5
      `,
      [tenantId, from, to, lead_source, limit]
    );

    return reply.send({
      ok: true,
      tenant_id: tenantId,
      filters: { from, to, lead_source, limit },
      jobs: jobs.rows
    });
  });

  app.get("/admin/job/:tenant_slug/:job_id", async (req, reply) => {
    const tenant_slug = String((req.params as any).tenant_slug || "");
    const tenantId = await getTenantIdBySlug(tenant_slug);
    const jobId = Number((req.params as any).job_id);
    const user = await requireJobReadUser(req, reply, tenantId);

    if (!user || !("id" in user)) {
      return;
    }

    await ensureCrewAssignmentUserColumn();

    const job = await pool.query(
      `
      select
        j.*,
        j.address1 as address,
        c.full_name as customer_name,
        c.phone as customer_phone,
        c.email as customer_email
      from jobs j
      left join customers c
        on c.id = j.customer_id
       and c.tenant_id = j.tenant_id
      where j.tenant_id = $1
        and j.id = $2
        and (
          $3::text <> 'subcontractor'
          or exists (
            select 1
            from crew_assignments ca
            where ca.tenant_id = j.tenant_id
              and ca.job_id = j.id
              and ca.app_user_id = $4
          )
        )
      limit 1
      `,
      [
        tenantId,
        jobId,
        String(user.role),
        Number(user.id)
      ]
    );

    if (!job.rowCount) {
      if (String(user.role) === "subcontractor") {
        return reply.code(403).send({
          ok: false,
          error: "Job access denied"
        });
      }

      return reply.code(404).send({
        ok: false,
        error: "Job not found"
      });
    }

    const contacts = await pool.query(
      `
      select *
      from job_contacts
      where tenant_id = $1 and job_id = $2
      order by is_primary desc, id asc
      `,
      [tenantId, jobId]
    );

    const insurance = await pool.query(
      `
      select *
      from job_insurance
      where tenant_id = $1 and job_id = $2
      limit 1
      `,
      [tenantId, jobId]
    );

    const damage = await pool.query(
      `
      select *
      from job_damage_reports
      where tenant_id = $1 and job_id = $2
      order by id desc
      `,
      [tenantId, jobId]
    );

    const documents = await pool.query(
      `
      select *
      from job_documents
      where tenant_id = $1 and job_id = $2
      order by id desc
      `,
      [tenantId, jobId]
    );

    const crew = await pool.query(
      `
      select *
      from crew_assignments
      where tenant_id = $1 and job_id = $2
      order by id desc
      `,
      [tenantId, jobId]
    );

    const timeline = await pool.query(
      `
      select id, kind, message, meta, created_at
      from timeline_events
      where tenant_id = $1 and job_id = $2
      order by id desc
      limit 250
      `,
      [tenantId, jobId]
    );

    const filesRaw = await listJobAssetsByTenantSlug(tenant_slug, jobId);
    const files = filesRaw.map((f: any) => ({
      id: f.id,
      kind: f.asset_type || "other",
      note: f.note || "",
      original_name: f.original_name || "",
      file_name: f.stored_name || "",
      path: f.relative_path ? `${process.env.PUBLIC_BASE_URL || "https://contractor-navigator.onrender.com"}/files/${f.relative_path}` : null,
      url: f.relative_path ? `${process.env.PUBLIC_BASE_URL || "https://contractor-navigator.onrender.com"}/files/${f.relative_path}` : null,
      created_at: f.created_at || null,
    }));

    return reply.send({
      ok: true,
      tenant_id: tenantId,
      job: job.rows[0] || null,
      contacts: contacts.rows,
      insurance: insurance.rows[0] || null,
      damage_reports: damage.rows,
      documents: documents.rows,
      crew_assignments: crew.rows,
      timeline: timeline.rows,
      files
    });
  });

  app.get("/admin/recent-activity/:tenant_slug", async (req, reply) => {
    const tenant_slug = String((req.params as any).tenant_slug || "")
    const tenantId = await getTenantIdBySlug(tenant_slug)
    const q: any = (req as any).query || {}
    const limit = Math.max(1, Math.min(Number(q.limit || 20), 100))

    const result = await pool.query(
      `
      select
        te.id,
        te.job_id,
        te.kind,
        te.message,
        te.meta,
        te.created_at,
        c.full_name as customer_name
      from timeline_events te
      left join jobs j
        on j.tenant_id = te.tenant_id
       and j.id = te.job_id
      left join customers c
        on c.id = j.customer_id
       and c.tenant_id = j.tenant_id
      where te.tenant_id = $1
        and te.kind in (
          'manual_note',
          'staff_note',
          'lead_created',
          'estimate_details',
          'document_package_sent',
          'document_package_signed',
          'buying_signal_detected',
          'customer_frustration_detected',
          'human_takeover_frustration',
          'frustrated_customer_alert_routed',
          'user_invitation_sent',
          'user_invitation_accepted'
        )
      order by te.created_at desc
      limit $2
      `,
      [tenantId, limit]
    )

    return reply.send({
      ok: true,
      count: result.rowCount,
      rows: result.rows,
    })
  })

  app.post("/admin/job/:tenant_slug/:job_id/update", async (req, reply) => {
    const tenant_slug = String((req.params as any).tenant_slug || "");
    const tenantId = await getTenantIdBySlug(tenant_slug);
    const jobId = Number((req.params as any).job_id);
    const body: any = (req as any).body || {};

    const jobRow = await pool.query(
      `
      select id, customer_id
      from jobs
      where tenant_id = $1 and id = $2
      limit 1
      `,
      [tenantId, jobId]
    );

    if (!jobRow.rowCount) {
      return reply.code(404).send({ ok: false, error: "Job not found" });
    }

    const customerId = jobRow.rows[0].customer_id;

    await pool.query(
      `
      update jobs
         set stage = coalesce($1, stage),
             crm_flow_key = coalesce($2, crm_flow_key),
             crm_substatus = coalesce($3, crm_substatus),
             manual_owner = coalesce($4, manual_owner),
             bot_paused = coalesce($5, bot_paused),
             estimate_status = coalesce($6, estimate_status),
             contract_status = coalesce($7, contract_status),
             wa_status = coalesce($8, wa_status),
             carrier = coalesce($9, carrier),
             claim_number = coalesce($10, claim_number),
             date_of_loss = coalesce($11, date_of_loss),
             policy_holder = coalesce($12, policy_holder),
             adjuster_name = coalesce($13, adjuster_name),
             adjuster_phone = coalesce($14, adjuster_phone),
             adjuster_email = coalesce($15, adjuster_email),
             assignment_subject = coalesce($16, assignment_subject),
             assignment_notes = coalesce($17, assignment_notes),
             damage_location = coalesce($18, damage_location),
             damage_summary = coalesce($19, damage_summary),
             last_human_note = coalesce($20, last_human_note),
             lead_source = coalesce($21, lead_source),
             lead_source_detail = coalesce($22, lead_source_detail),
             marketing_campaign = coalesce($23, marketing_campaign),
             job_type = coalesce($24, job_type),
             address1 = coalesce($25, address1),
             city = coalesce($26, city),
             state = coalesce($27, state),
             zip = coalesce($28, zip),
             updated_at = now()
       where tenant_id = $29
         and id = $30
      `,
      [
        body.stage ?? null,
        body.crm_flow_key ?? null,
        body.crm_substatus ?? null,
        body.manual_owner ?? null,
        typeof body.bot_paused === "boolean" ? body.bot_paused : null,
        body.estimate_status ?? null,
        body.contract_status ?? null,
        body.wa_status ?? null,
        body.carrier ?? null,
        body.claim_number ?? null,
        body.date_of_loss ?? null,
        body.policy_holder ?? null,
        body.adjuster_name ?? null,
        body.adjuster_phone ?? null,
        body.adjuster_email ?? null,
        body.assignment_subject ?? null,
        body.assignment_notes ?? null,
        body.damage_location ?? null,
        body.damage_summary ?? null,
        body.last_human_note ?? null,
        body.lead_source ?? null,
        body.lead_source_detail ?? null,
        body.marketing_campaign ?? null,
        body.job_type ?? null,
        body.address ?? body.address1 ?? null,
        body.city ?? null,
        body.state ?? null,
        body.zip ?? null,
        tenantId,
        jobId
      ]
    );

    if (customerId) {
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
        [
          body.customer_name ?? null,
          body.customer_phone ?? null,
          body.customer_email ?? null,
          tenantId,
          customerId
        ]
      );
    }

    await pool.query(
      `
      update jobs
         set customer_phone = coalesce($1, customer_phone),
             customer_email = coalesce($2, customer_email),
             secondary_contact_name = coalesce($3, secondary_contact_name),
             secondary_contact_phone = coalesce($4, secondary_contact_phone),
             secondary_contact_email = coalesce($5, secondary_contact_email),
             secondary_contact_type = coalesce($6, secondary_contact_type),
             updated_at = now()
       where tenant_id = $7
         and id = $8
      `,
      [
        body.customer_phone ?? null,
        body.customer_email ?? null,
        body.secondary_contact_name ?? null,
        body.secondary_contact_phone ?? null,
        body.secondary_contact_email ?? null,
        body.secondary_contact_type ?? null,
        tenantId,
        jobId
      ]
    );

    await pool.query(
      `
      insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
      values ($1, $2, 'job_manually_updated', 'Job manually updated from CRM command center', $3::jsonb, now())
      `,
      [tenantId, jobId, JSON.stringify(body)]
    );

    return reply.send({ ok: true, tenant_id: tenantId, job_id: jobId, updated: true });
  });


  app.post("/admin/job/:tenant_slug/:job_id/archive", async (req, reply) => {
    const tenant_slug = String((req.params as any).tenant_slug || "");
    const tenantId = await getTenantIdBySlug(tenant_slug);
    const jobId = Number((req.params as any).job_id);
    const body: any = (req as any).body || {};
    const reason = String(body.reason || "Archived / removed from active CRM by user").trim();

    await pool.query(
      `
      update jobs
         set stage = 'archived',
             crm_substatus = 'archived_by_user',
             bot_paused = true,
             updated_at = now()
       where tenant_id = $1
         and id = $2
      `,
      [tenantId, jobId]
    );

    await pool.query(
      `
      update scheduled_actions
         set status = 'cancelled',
             updated_at = now()
       where tenant_id = $1
         and job_id = $2
         and status = 'pending'
      `,
      [tenantId, jobId]
    );

    await pool.query(
      `
      insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
      values ($1, $2, 'job_archived', $3, $4::jsonb, now())
      `,
      [tenantId, jobId, reason, JSON.stringify({ reason, source: "job_detail_ui" })]
    );

    return reply.send({ ok: true, tenant_id: tenantId, job_id: jobId, archived: true });
  });

  app.post("/admin/job/:tenant_slug/:job_id/note", async (req, reply) => {
    const tenant_slug = String((req.params as any).tenant_slug || "");
    const tenantId = await getTenantIdBySlug(tenant_slug);
    const jobId = Number((req.params as any).job_id);
    const body: any = (req as any).body || {};
    const note = String(body.note || "").trim();

    if (!note) {
      return reply.code(400).send({ ok: false, error: "note required" });
    }

    await pool.query(
      `
      insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
      values ($1, $2, 'manual_note', $3, $4::jsonb, now())
      `,
      [tenantId, jobId, note, JSON.stringify({ author: body.author || "team" })]
    );

    await pool.query(
      `
      update jobs
         set last_human_note = $1,
             updated_at = now()
       where tenant_id = $2 and id = $3
      `,
      [note, tenantId, jobId]
    );

    return reply.send({ ok: true, tenant_id: tenantId, job_id: jobId, noted: true });
  });

  app.post("/admin/job/:tenant_slug/:job_id/contact", async (req, reply) => {
    const tenant_slug = String((req.params as any).tenant_slug || "");
    const tenantId = await getTenantIdBySlug(tenant_slug);
    const jobId = Number((req.params as any).job_id);
    const body: any = (req as any).body || {};

    const full_name = body.full_name ? String(body.full_name) : null;
    const phone = body.phone ? String(body.phone) : null;
    const email = body.email ? String(body.email) : null;
    const contact_role = body.contact_role ? String(body.contact_role) : "secondary";
    const is_primary = Boolean(body.is_primary);

    await pool.query(
      `
      insert into job_contacts
        (tenant_id, job_id, contact_role, full_name, phone, email, is_primary, created_at, updated_at)
      values
        ($1, $2, $3, $4, $5, $6, $7, now(), now())
      `,
      [tenantId, jobId, contact_role, full_name, phone, email, is_primary]
    );

    await pool.query(
      `
      insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
      values ($1, $2, 'job_contact_added', 'Additional job contact saved', $3::jsonb, now())
      `,
      [tenantId, jobId, JSON.stringify({ full_name, phone, email, contact_role, is_primary })]
    );

    return reply.send({ ok: true, tenant_id: tenantId, job_id: jobId, contact_saved: true });
  });

  app.get("/admin/:tenant_slug/subcontractors", async (req, reply) => {
    try {
      const actor = await requireAssignmentManager(req, reply);

      if (!actor) {
        return reply.send({ ok: false, error: "Not authorized" });
      }

      const tenant_slug = String((req.params as any).tenant_slug || "");
      const tenantId = await getTenantIdBySlug(tenant_slug);

      if (
        String(actor.role) !== "platform_owner" &&
        Number(actor.tenant_id) !== tenantId
      ) {
        return reply.code(403).send({
          ok: false,
          error: "Tenant access denied",
        });
      }

      const result = await pool.query(
        `
        select
          id,
          email,
          full_name,
          role,
          is_active
        from app_users
        where tenant_id = $1
          and role = 'subcontractor'
          and is_active = true
        order by full_name asc, id asc
        `,
        [tenantId]
      );

      return reply.send({
        ok: true,
        subcontractors: result.rows
      });
    } catch (err: any) {
      return reply.code(400).send({
        ok: false,
        error: err?.message || String(err)
      });
    }
  });

  app.post("/admin/job/:tenant_slug/:job_id/assign-subcontractor", async (req, reply) => {
    try {
      const actor = await requireAssignmentManager(req, reply);

      if (!actor) {
        return reply.send({ ok: false, error: "Not authorized" });
      }

      await ensureCrewAssignmentUserColumn();

      const tenant_slug = String((req.params as any).tenant_slug || "");
      const tenantId = await getTenantIdBySlug(tenant_slug);
      const jobId = Number((req.params as any).job_id);
      const body: any = (req as any).body || {};
      const appUserId = Number(body.app_user_id);

      if (Number(actor.tenant_id) !== tenantId) {
        return reply.code(403).send({ ok: false, error: "Tenant access denied" });
      }

      if (!Number.isFinite(jobId) || jobId <= 0) {
        return reply.code(400).send({ ok: false, error: "Valid job required" });
      }

      if (!Number.isFinite(appUserId) || appUserId <= 0) {
        return reply.code(400).send({ ok: false, error: "Valid subcontractor required" });
      }

      const jobResult = await pool.query(
        `
        select id
        from jobs
        where tenant_id = $1
          and id = $2
        limit 1
        `,
        [tenantId, jobId]
      );

      if (!jobResult.rowCount) {
        return reply.code(404).send({ ok: false, error: "Job not found" });
      }

      const subcontractorResult = await pool.query(
        `
        select
          id,
          email,
          full_name
        from app_users
        where tenant_id = $1
          and id = $2
          and role = 'subcontractor'
          and is_active = true
        limit 1
        `,
        [tenantId, appUserId]
      );

      if (!subcontractorResult.rowCount) {
        return reply.code(404).send({
          ok: false,
          error: "Active subcontractor not found"
        });
      }

      const subcontractor = subcontractorResult.rows[0];

      const existing = await pool.query(
        `
        select id
        from crew_assignments
        where tenant_id = $1
          and job_id = $2
          and app_user_id = $3
        limit 1
        `,
        [tenantId, jobId, appUserId]
      );

      let assignment;

      if (existing.rowCount) {
        const updated = await pool.query(
          `
          update crew_assignments
             set crew_name = $1,
                 assigned_by = $2,
                 status = 'PENDING',
                 assigned_at = now(),
                 updated_at = now()
           where tenant_id = $3
             and job_id = $4
             and app_user_id = $5
          returning *
          `,
          [
            subcontractor.full_name,
            actor.full_name || actor.email,
            tenantId,
            jobId,
            appUserId
          ]
        );

        assignment = updated.rows[0];
      } else {
        const inserted = await pool.query(
          `
          insert into crew_assignments
            (
              tenant_id,
              job_id,
              crew_name,
              assigned_by,
              status,
              assigned_at,
              created_at,
              updated_at,
              app_user_id
            )
          values
            ($1, $2, $3, $4, 'PENDING', now(), now(), now(), $5)
          returning *
          `,
          [
            tenantId,
            jobId,
            subcontractor.full_name,
            actor.full_name || actor.email,
            appUserId
          ]
        );

        assignment = inserted.rows[0];
      }

      await pool.query(
        `
        insert into timeline_events
          (tenant_id, job_id, kind, message, meta, created_at)
        values
          ($1, $2, 'subcontractor_assigned', $3, $4::jsonb, now())
        `,
        [
          tenantId,
          jobId,
          `Job assigned to subcontractor: ${subcontractor.full_name}`,
          JSON.stringify({
            author: actor.full_name || actor.email,
            app_user_id: appUserId,
            subcontractor_name: subcontractor.full_name,
            subcontractor_email: subcontractor.email,
            assignment_status: "PENDING"
          })
        ]
      );

      return reply.send({
        ok: true,
        assignment
      });
    } catch (err: any) {
      return reply.code(400).send({
        ok: false,
        error: err?.message || String(err)
      });
    }
  });

  app.post("/admin/simulate-inbound/:tenant_slug", async (req, reply) => {
    try {
      const tenant_slug = String((req.params as any).tenant_slug || "");
      const body: any = (req as any).body || {};

      const jobId = Number(body.job_id);
      const message = String(body.message || "");

      const { handleInboundMessageByTenantSlug } = await import("../services/followupEngine");

      const result = await handleInboundMessageByTenantSlug(
        tenant_slug,
        jobId,
        message,
        "+15555555555"
      );

      return reply.send({
        ok: true,
        simulated: true,
        result
      });
    } catch (err: any) {
      return reply.status(500).send({
        ok: false,
        error: err?.message || String(err)
      });
    }
  });

}

export default registerAdminRoutes;
