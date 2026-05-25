import { FastifyInstance } from "fastify"
import { pool } from "../db/db"

export async function registerReportingRoutes(app: FastifyInstance) {
  app.get("/reporting/crm-metrics.json", async (_req, reply) => {
    try {
      const leadsResult = await pool.query(`
        select count(*)::int as total
        from jobs
      `)

      const stagesResult = await pool.query(`
        select coalesce(stage, 'unknown') as stage, count(*)::int as total
        from jobs
        group by stage
        order by total desc
      `)

      const timelineResult = await pool.query(`
        select kind, count(*)::int as total
        from timeline_events
        group by kind
        order by total desc
      `)

      const estimateResult = await pool.query(`
        select count(*)::int as total
        from jobs
        where stage = 'estimate_sent'
      `)

      const contractResult = await pool.query(`
        select count(*)::int as total
        from jobs
        where stage like '%contract%'
      `)

      const aiActivityResult = await pool.query(`
        select count(*)::int as total
        from timeline_events
        where kind in ('workflow_started', 'workflow_planned', 'workflow_step')
      `)

      return reply.send({
        ok: true,
        source: "contractor-navigator",
        generated_at: new Date().toISOString(),
        metrics: {
          total_leads: leadsResult.rows[0]?.total || 0,
          estimate_sent: estimateResult.rows[0]?.total || 0,
          contract_activity: contractResult.rows[0]?.total || 0,
          ai_activity: aiActivityResult.rows[0]?.total || 0
        },
        stage_breakdown: stagesResult.rows,
        timeline_activity: timelineResult.rows
      })
    } catch (err: any) {
      console.error("crm reporting route failed", err)
      return reply.code(500).send({
        ok: false,
        error: err.message || "crm reporting failed"
      })
    }
  })
}
