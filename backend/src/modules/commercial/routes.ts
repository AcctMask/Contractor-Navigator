import { FastifyInstance } from "fastify";
import {
  importCommercialTargets,
  sendQueuedCommercialEmail,
  runCommercialEmailScheduler,
  getPipelineView,
} from "./service";
import { commercialPool as pool } from "./db";
import { calculateCommercialPriority } from "./priorityEngine";

export async function commercialRoutes(app: FastifyInstance) {
  // SYSTEM EVENTS - RECENT ACTIVITY
  app.get("/events", async (_req, reply) => {
    const result = await pool.query(`
      select *
      from system_events
      order by created_at desc
      limit 100
    `);

    return reply.send({
      ok: true,
      count: result.rowCount,
      rows: result.rows,
    });
  });

  // HEALTH
  app.get("/commercial/health", async () => {
    return { ok: true, name: "commercial-pipeline-builder", status: "ready" };
  });

  // CREATE TARGET - MANUAL / FIELD CAPTURE
  app.post("/commercial/targets", async (req, reply) => {
    try {
      const body = req.body as any;

      const business_name = String(body.business_name || "").trim();
      const city = String(body.city || "").trim();
      const state = String(body.state || "FL").trim() || "FL";
      const email = String(body.email || "").trim() || null;
      const target_type = String(
        body.target_type || body.contractor_category || "general_contractor"
      ).trim();
      const campaign_priority = String(
        body.campaign_priority || body.source || "manual"
      ).trim();

      if (!business_name) {
        return reply.code(400).send({ ok: false, error: "business_name required" });
      }

      const existing = await pool.query(
        `
        select id
        from commercial_targets
        where lower(business_name) = lower($1)
          and coalesce(lower(city),'') = coalesce(lower($2),'')
        limit 1
        `,
        [business_name, city]
      );

      if (existing.rowCount) {
        return reply.code(409).send({
          ok: false,
          error: "Contractor already exists",
          existing_id: existing.rows[0].id,
        });
      }

      const result = await pool.query(
        `
        insert into commercial_targets (
          business_name, city, state, email,
          target_type, contractor_category, campaign_priority, fit_score,
          pipeline_status, priority_level,
          telephone, website, source, notes, zip, license_number
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        returning *
        `,
        [
          business_name,
          city || null,
          state,
          email,
          target_type,
          target_type,
          campaign_priority,
          0,
          "working",
          email ? "medium" : "low",
          body.telephone || null,
          body.website || null,
          body.source || campaign_priority,
          body.notes || null,
          body.zip || null,
          body.license_number || null,
        ]
      );

      const missing_fields: string[] = [];
      if (!email) missing_fields.push("email");
      if (!body.telephone) missing_fields.push("telephone");
      if (!body.contact_name) missing_fields.push("contact_name");

      return reply.send({
        ok: true,
        created: result.rows[0],
        missing_fields,
      });
    } catch (err: any) {
      return reply.code(500).send({
        ok: false,
        error: err.message || "Failed to create contractor",
      });
    }
  });

  // IMPORT
  app.post("/commercial/import", async (req, reply) => {
    try {
      const { rows } = req.body as any;
      if (!rows || !Array.isArray(rows)) {
        return reply.code(400).send({ ok: false, error: "rows required" });
      }

      const result = await importCommercialTargets(rows);
      return reply.send({ ok: true, ...result });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  // TARGET LIST
  app.get("/commercial/targets", async (req, reply) => {
    const q = req.query as any;

    const limit = Number(q.limit || 500);
    const offset = Number(q.offset || 0);

    const result = await pool.query(
      `
      select *
      from commercial_targets
      where coalesce(do_not_contact,false) = false
      order by 
        case priority_level
          when 'high' then 1
          when 'medium' then 2
          else 3
        end,
        engagement_score desc,
        created_at desc
      limit $1 offset $2
      `,
      [limit, offset]
    );

    const total = await pool.query(
      `
      select count(*)::int as total
      from commercial_targets
      where coalesce(do_not_contact,false) = false
      `
    );

    return reply.send({
      ok: true,
      count: result.rowCount,
      total_count: total.rows[0]?.total || result.rowCount,
      rows: result.rows,
    });
  });

  // SINGLE TARGET DETAIL + EMAIL HISTORY
  app.get("/commercial/targets/:id", async (req, reply) => {
    const { id } = req.params as any;

    const target = await pool.query(
      `select * from commercial_targets where id = $1`,
      [id]
    );

    if (!target.rowCount) {
      return reply.code(404).send({ ok: false, error: "Contractor not found" });
    }

    const history = await pool.query(
      `
      select *
      from commercial_email_queue
      where target_id = $1
      order by created_at desc
      `,
      [id]
    );

    return reply.send({
      ok: true,
      target: target.rows[0],
      email_history: history.rows,
    });
  });

  // UPDATE TARGET STATUS / FIELDS
  app.patch("/commercial/targets/:id", async (req, reply) => {
    const { id } = req.params as any;
    const body = req.body as any;

    const result = await pool.query(
      `
      update commercial_targets
      set
        pipeline_status = coalesce($2, pipeline_status),
        priority_level = coalesce($3, priority_level),
        do_not_contact = coalesce($4, do_not_contact),
        opt_out_reason = coalesce($5, opt_out_reason),
        opted_out_at = case
          when $4::boolean = true then now()
          else opted_out_at
        end,
        updated_at = now()
      where id = $1
      returning *
      `,
      [
        id,
        body.pipeline_status || null,
        body.priority_level || null,
        typeof body.do_not_contact === "boolean" ? body.do_not_contact : null,
        body.opt_out_reason || null,
      ]
    );

    if (!result.rowCount) {
      return reply.code(404).send({ ok: false, error: "Contractor not found" });
    }

    return reply.send({ ok: true, target: result.rows[0] });
  });

  // DO NOT CONTACT
  app.post("/commercial/targets/:id/do-not-contact", async (req, reply) => {
    const { id } = req.params as any;
    const body = req.body as any;

    const result = await pool.query(
      `
      update commercial_targets
      set
        do_not_contact = true,
        pipeline_status = 'opted_out',
        priority_level = 'none',
        opt_out_reason = coalesce($2, 'manual_do_not_contact'),
        opted_out_at = now(),
        updated_at = now()
      where id = $1
      returning *
      `,
      [id, body?.reason || null]
    );

    if (!result.rowCount) {
      return reply.code(404).send({ ok: false, error: "Contractor not found" });
    }

    return reply.send({ ok: true, dnc: true, target: result.rows[0] });
  });

  // DNC TOGGLE ALIAS FOR UI
  app.post("/commercial/targets/:id/dnc", async (req, reply) => {
    const { id } = req.params as any;

    const current = await pool.query(
      `select do_not_contact from commercial_targets where id = $1`,
      [id]
    );

    if (!current.rowCount) {
      return reply.code(404).send({ ok: false, error: "Contractor not found" });
    }

    const next = !Boolean(current.rows[0].do_not_contact);

    const result = await pool.query(
      `
      update commercial_targets
      set
        do_not_contact = $2,
        pipeline_status = case when $2 then 'opted_out' else pipeline_status end,
        priority_level = case when $2 then 'none' else priority_level end,
        opt_out_reason = case when $2 then 'manual_dnc_toggle' else opt_out_reason end,
        opted_out_at = case when $2 then now() else opted_out_at end,
        updated_at = now()
      where id = $1
      returning *
      `,
      [id, next]
    );

    return reply.send({ ok: true, dnc: next, target: result.rows[0] });
  });

  // PUBLIC UNSUBSCRIBE / DNC LINK
  app.get("/commercial/unsubscribe/:id", async (req, reply) => {
    const { id } = req.params as any;

    await pool.query(
      `
      update commercial_targets
      set
        do_not_contact = true,
        pipeline_status = 'opted_out',
        priority_level = 'none',
        opt_out_reason = 'email_unsubscribe',
        opted_out_at = now(),
        updated_at = now()
      where id = $1
      `,
      [id]
    );

    return reply.type("text/html").send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px; color: #111827;">
          <h2>You have been unsubscribed</h2>
          <p>You will no longer receive commercial outreach emails from Good2Go Roofing.</p>
          <p>If this was a mistake, please contact info@g2groofing.com.</p>
        </body>
      </html>
    `);
  });

  // QUEUE EMAIL
  app.post("/commercial/targets/:id/queue-email", async (req, reply) => {
    const { id } = req.params as any;

    const target = await pool.query(
      `
      select id, email, do_not_contact
      from commercial_targets
      where id = $1
      `,
      [id]
    );

    if (!target.rowCount) {
      return reply.code(404).send({ ok: false, error: "Contractor not found" });
    }

    if (target.rows[0].do_not_contact) {
      return reply.code(400).send({ ok: false, error: "Contractor is marked do not contact" });
    }

    if (!target.rows[0].email) {
      return reply.code(400).send({ ok: false, error: "Contractor has no email" });
    }

    const result = await pool.query(
      `
      insert into commercial_email_queue (target_id, status)
      values ($1, 'pending')
      returning id
      `,
      [id]
    );

    return reply.send({
      ok: true,
      queued: true,
      queue_id: result.rows[0].id,
    });
  });

  // SEND EMAIL
  app.post("/commercial/email-queue/:id/send", async (req, reply) => {
    const { id } = req.params as any;

    try {
      const result = await sendQueuedCommercialEmail(id);
      return reply.send(result);
    } catch (err: any) {
      return reply.send({ ok: false, error: err.message });
    }
  });

  // EMAIL QUEUE VIEW - PENDING
  app.get("/commercial/email-queue/pending", async (_req, reply) => {
    const result = await pool.query(`
      select q.id as queue_id, q.status, q.scheduled_at, q.created_at,
             t.id as target_id, t.business_name, t.city, t.state, t.email,
             t.pipeline_status, t.priority_level
      from commercial_email_queue q
      join commercial_targets t on t.id = q.target_id
      where q.status = 'pending'
      order by q.created_at desc
      limit 100
    `);

    return reply.send({
      ok: true,
      count: result.rowCount,
      rows: result.rows,
    });
  });

  // EMAIL QUEUE VIEW - SENT
  app.get("/commercial/email-queue/sent", async (_req, reply) => {
    const result = await pool.query(`
      select q.id as queue_id, q.status, q.scheduled_at, q.created_at, q.sent_at,
             t.id as target_id, t.business_name, t.city, t.state, t.email,
             t.pipeline_status, t.priority_level
      from commercial_email_queue q
      join commercial_targets t on t.id = q.target_id
      where q.status = 'sent'
      order by q.sent_at desc nulls last, q.created_at desc
      limit 100
    `);

    return reply.send({
      ok: true,
      count: result.rowCount,
      rows: result.rows,
    });
  });

  // CAMPAIGN / EMAIL HISTORY SUMMARY
  app.get("/commercial/campaigns/batches", async (_req, reply) => {
    const result = await pool.query(`
      select
        batch_id as id,
        case
          when batch_id = 'manual-email-queue' then 'Manual / Direct Emails'
          else batch_id
        end as name,
        min(created_at) as created_at,
        count(*)::int as total_count,
        count(*) filter (where status = 'pending')::int as pending_count,
        count(*) filter (where status = 'sent')::int as sent_count,
        count(*) filter (where status = 'failed')::int as failed_count,
        max(sent_at) as last_sent_at
      from (
        select
          coalesce(campaign_id::text, 'manual-email-queue') as batch_id,
          status,
          created_at,
          sent_at
        from commercial_email_queue
      ) q
      group by batch_id
      order by coalesce(max(sent_at), max(created_at)) desc
      limit 50
    `)

    return reply.send({
      ok: true,
      count: result.rowCount,
      rows: result.rows,
    })
  })

  // CAMPAIGN RECIPIENTS
  app.get("/commercial/campaigns/:id/recipients", async (req, reply) => {
    const { id } = req.params as any

    const result = await pool.query(
      `
      select
        q.id as queue_id,
        q.status,
        q.created_at,
        q.scheduled_at,
        q.sent_at,
        q.error,
        t.id as target_id,
        t.business_name,
        t.city,
        t.state,
        t.email,
        t.telephone,
        t.pipeline_status,
        t.priority_level,
        t.do_not_contact
      from commercial_email_queue q
      join commercial_targets t on t.id = q.target_id
      where
        ($1 = 'manual-email-queue' and q.campaign_id is null)
        or q.campaign_id::text = $1
      order by q.created_at desc
      limit 1000
      `,
      [id]
    )

    return reply.send({
      ok: true,
      count: result.rowCount,
      rows: result.rows,
    })
  })

  // COMMERCIAL EMAIL SCHEDULER - SEND LIMITED PENDING BATCH
  app.post("/commercial/scheduler/run", async (req, reply) => {
    try {
      const body = req.body as any;
      const max = Number(body?.max || body?.limit || 10);

      const result = await runCommercialEmailScheduler(max);
      return reply.send(result);
    } catch (err: any) {
      return reply.code(500).send({
        ok: false,
        error: err.message || "Commercial scheduler failed",
      });
    }
  });

  // PRIORITY ENGINE
  app.post("/commercial/prioritize", async (_req, reply) => {
    const result = await pool.query(`select * from commercial_targets`);

    let updated = 0;

    for (const target of result.rows) {
      const p = calculateCommercialPriority(target);

      await pool.query(
        `
        update commercial_targets
        set
          engagement_score = $2,
          priority_level = $3,
          updated_at = now()
        where id = $1
        `,
        [target.id, p.score, p.priority]
      );

      updated++;
    }

    return reply.send({ ok: true, updated });
  });

  // PIPELINE VIEW
  app.get("/commercial/pipeline", async (_req, reply) => {
    const result = await getPipelineView();
    return reply.send({ ok: true, rows: result });
  });
}
