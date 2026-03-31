import type { FastifyInstance } from "fastify";
import { pool } from "../db/db";
import { schedulerTick } from "../services/scheduler";

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

function asNullableNumber(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
      const address1 = asNullableString(body.address1);
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
      add column if not exists lead_source text,
      add column if not exists lead_source_detail text,
      add column if not exists marketing_campaign text;
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
        c.full_name as customer_name
      from jobs j
      left join customers c
        on c.id = j.customer_id
       and c.tenant_id = j.tenant_id
      where j.tenant_id = $1
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

    const job = await pool.query(
      `
      select
        j.*,
        c.full_name as customer_name
      from jobs j
      left join customers c
        on c.id = j.customer_id
       and c.tenant_id = j.tenant_id
      where j.tenant_id = $1
        and j.id = $2
      limit 1
      `,
      [tenantId, jobId]
    );

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

    return reply.send({
      ok: true,
      tenant_id: tenantId,
      job: job.rows[0] || null,
      contacts: contacts.rows,
      insurance: insurance.rows[0] || null,
      damage_reports: damage.rows,
      documents: documents.rows,
      crew_assignments: crew.rows,
      timeline: timeline.rows
    });
  });

  app.post("/admin/job/:tenant_slug/:job_id/update", async (req, reply) => {
    const tenant_slug = String((req.params as any).tenant_slug || "");
    const tenantId = await getTenantIdBySlug(tenant_slug);
    const jobId = Number((req.params as any).job_id);
    const body: any = (req as any).body || {};

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
             policy_holder = coalesce($11, policy_holder),
             adjuster_name = coalesce($12, adjuster_name),
             adjuster_phone = coalesce($13, adjuster_phone),
             adjuster_email = coalesce($14, adjuster_email),
             assignment_subject = coalesce($15, assignment_subject),
             assignment_notes = coalesce($16, assignment_notes),
             damage_location = coalesce($17, damage_location),
             damage_summary = coalesce($18, damage_summary),
             last_human_note = coalesce($19, last_human_note),
             lead_source = coalesce($20, lead_source),
             lead_source_detail = coalesce($21, lead_source_detail),
             marketing_campaign = coalesce($22, marketing_campaign),
             updated_at = now()
       where tenant_id = $23
         and id = $24
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

  app.get("/admin/calendar/:tenant_slug", async (req, reply) => {
    try {
      const tenant_slug = String((req.params as any).tenant_slug || "");
      const tenantId = await getTenantIdBySlug(tenant_slug);
      const q: any = (req.query as any) || {};

      const from = asNullableString(q.from);
      const to = asNullableString(q.to);
      const status = asNullableString(q.status);
      const jobId = asNullableNumber(q.job_id);
      const limit = Number(q.limit || 250);

      const result = await pool.query(
        `
        select
          ce.*,
          c.full_name as customer_name,
          j.stage as job_stage,
          concat_ws(', ', nullif(j.address1,''), nullif(j.city,''), nullif(j.state,''), nullif(j.zip,'')) as job_address
        from calendar_events ce
        left join jobs j
          on j.id = ce.job_id
         and j.tenant_id = ce.tenant_id
        left join customers c
          on c.id = j.customer_id
         and c.tenant_id = j.tenant_id
        where ce.tenant_id = $1
          and ($2::timestamptz is null or ce.start_at >= $2::timestamptz)
          and ($3::timestamptz is null or ce.start_at <= $3::timestamptz)
          and ($4::text is null or ce.status = $4::text)
          and ($5::bigint is null or ce.job_id = $5::bigint)
        order by ce.start_at asc, ce.id asc
        limit $6
        `,
        [tenantId, from, to, status, jobId, limit]
      );

      return reply.send({
        ok: true,
        tenant_id: tenantId,
        filters: { from, to, status, job_id: jobId, limit },
        events: result.rows
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err?.message || "Calendar load failed" });
    }
  });

  app.post("/admin/calendar/:tenant_slug/create", async (req, reply) => {
    try {
      const tenant_slug = String((req.params as any).tenant_slug || "");
      const tenantId = await getTenantIdBySlug(tenant_slug);
      const body: any = (req as any).body || {};

      const title = asNullableString(body.title);
      const event_type = asNullableString(body.event_type) || "appointment";
      const start_at = asNullableString(body.start_at);
      const end_at = asNullableString(body.end_at);
      const location = asNullableString(body.location);
      const notes = asNullableString(body.notes);
      const status = asNullableString(body.status) || "scheduled";
      const assigned_to = asNullableString(body.assigned_to);
      const created_by = asNullableString(body.created_by);
      const job_id = asNullableNumber(body.job_id);

      if (!title) {
        return reply.code(400).send({ ok: false, error: "title required" });
      }
      if (!start_at) {
        return reply.code(400).send({ ok: false, error: "start_at required" });
      }
      if (!end_at) {
        return reply.code(400).send({ ok: false, error: "end_at required" });
      }

      const inserted = await pool.query(
        `
        insert into calendar_events
          (
            tenant_id,
            job_id,
            title,
            event_type,
            start_at,
            end_at,
            location,
            notes,
            status,
            assigned_to,
            created_by,
            created_at,
            updated_at
          )
        values
          ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10,$11,now(),now())
        returning *
        `,
        [
          tenantId,
          job_id,
          title,
          event_type,
          start_at,
          end_at,
          location,
          notes,
          status,
          assigned_to,
          created_by
        ]
      );

      const event = inserted.rows[0];

      await pool.query(
        `
        insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
        values ($1, $2, 'calendar_event_created', $3, $4::jsonb, now())
        `,
        [
          tenantId,
          job_id,
          `Calendar event scheduled: ${title}`,
          JSON.stringify({
            event_id: event.id,
            title,
            event_type,
            start_at,
            end_at,
            location,
            status,
            assigned_to,
            created_by
          })
        ]
      );

      return reply.send({ ok: true, tenant_id: tenantId, event });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err?.message || "Calendar create failed" });
    }
  });

  app.post("/admin/calendar/:tenant_slug/:event_id/update", async (req, reply) => {
    try {
      const tenant_slug = String((req.params as any).tenant_slug || "");
      const tenantId = await getTenantIdBySlug(tenant_slug);
      const eventId = Number((req.params as any).event_id);
      const body: any = (req as any).body || {};

      const before = await pool.query(
        `
        select *
        from calendar_events
        where tenant_id = $1 and id = $2
        limit 1
        `,
        [tenantId, eventId]
      );

      if (!before.rowCount) {
        return reply.code(404).send({ ok: false, error: "calendar event not found" });
      }

      const existing = before.rows[0];

      const updated = await pool.query(
        `
        update calendar_events
           set job_id = coalesce($1, job_id),
               title = coalesce($2, title),
               event_type = coalesce($3, event_type),
               start_at = coalesce($4::timestamptz, start_at),
               end_at = coalesce($5::timestamptz, end_at),
               location = coalesce($6, location),
               notes = coalesce($7, notes),
               status = coalesce($8, status),
               assigned_to = coalesce($9, assigned_to),
               updated_at = now()
         where tenant_id = $10
           and id = $11
        returning *
        `,
        [
          asNullableNumber(body.job_id),
          asNullableString(body.title),
          asNullableString(body.event_type),
          asNullableString(body.start_at),
          asNullableString(body.end_at),
          asNullableString(body.location),
          asNullableString(body.notes),
          asNullableString(body.status),
          asNullableString(body.assigned_to),
          tenantId,
          eventId
        ]
      );

      const event = updated.rows[0];

      await pool.query(
        `
        insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
        values ($1, $2, 'calendar_event_updated', $3, $4::jsonb, now())
        `,
        [
          tenantId,
          event.job_id || existing.job_id || null,
          `Calendar event updated: ${event.title || existing.title}`,
          JSON.stringify({
            event_id: eventId,
            changes: body
          })
        ]
      );

      return reply.send({ ok: true, tenant_id: tenantId, event });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err?.message || "Calendar update failed" });
    }
  });

  app.post("/admin/calendar/:tenant_slug/:event_id/delete", async (req, reply) => {
    try {
      const tenant_slug = String((req.params as any).tenant_slug || "");
      const tenantId = await getTenantIdBySlug(tenant_slug);
      const eventId = Number((req.params as any).event_id);

      const before = await pool.query(
        `
        select *
        from calendar_events
        where tenant_id = $1 and id = $2
        limit 1
        `,
        [tenantId, eventId]
      );

      if (!before.rowCount) {
        return reply.code(404).send({ ok: false, error: "calendar event not found" });
      }

      const existing = before.rows[0];

      await pool.query(
        `
        delete from calendar_events
        where tenant_id = $1 and id = $2
        `,
        [tenantId, eventId]
      );

      await pool.query(
        `
        insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
        values ($1, $2, 'calendar_event_deleted', $3, $4::jsonb, now())
        `,
        [
          tenantId,
          existing.job_id || null,
          `Calendar event deleted: ${existing.title}`,
          JSON.stringify({
            event_id: eventId,
            title: existing.title,
            start_at: existing.start_at,
            end_at: existing.end_at
          })
        ]
      );

      return reply.send({ ok: true, tenant_id: tenantId, event_id: eventId, deleted: true });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err?.message || "Calendar delete failed" });
    }
  });
}

export default registerAdminRoutes;
