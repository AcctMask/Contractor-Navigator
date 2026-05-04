import { FastifyInstance } from "fastify";
import {
  importCommercialTargets,
  sendQueuedCommercialEmail,
  getPipelineView,
} from "./service";
import { commercialPool as pool } from "./db";
import { calculateCommercialPriority } from "./priorityEngine";

export async function commercialRoutes(app: FastifyInstance) {

  // HEALTH
  app.get("/commercial/health", async () => {
    return { ok: true, name: "commercial-pipeline-builder", status: "ready" };
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

  // TARGET LIST (WITH FILTERS)
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
        engagement_score desc
      limit $1 offset $2
      `,
      [limit, offset]
    );

    return reply.send({
      ok: true,
      count: result.rowCount,
      rows: result.rows,
    });
  });

  // SINGLE TARGET DETAIL
  app.get("/commercial/targets/:id", async (req, reply) => {
    const { id } = req.params as any;

    const target = await pool.query(
      `select * from commercial_targets where id = $1`,
      [id]
    );

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

  // QUEUE EMAIL
  app.post("/commercial/targets/:id/queue-email", async (req, reply) => {
    const { id } = req.params as any;

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

  // EMAIL QUEUE VIEW
  app.get("/commercial/email-queue/pending", async (req, reply) => {
    const result = await pool.query(`
      select q.id as queue_id, q.status, q.scheduled_at,
             t.business_name, t.city, t.state, t.email,
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

  // 🚀 PRIORITY ENGINE (THE IMPORTANT PART)
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
  app.get("/commercial/pipeline", async (req, reply) => {
    const result = await getPipelineView();
    return reply.send({ ok: true, rows: result });
  });
}
