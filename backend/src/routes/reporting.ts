import { FastifyInstance } from "fastify"
import { pool } from "../db/db"

export async function registerReportingRoutes(app: FastifyInstance) {
  app.get("/reporting/crm-metrics.json", async (req, reply) => {
    try {
      const query = req.query as {
        tenant?: string
      }

      const tenantSlug = String(query.tenant || "").trim()

      let tenant:
        | {
            id: number
            slug: string
            name: string
          }
        | null = null

      if (tenantSlug) {
        const tenantResult = await pool.query(
          `
            select id, slug, name
            from tenants
            where slug = $1
            limit 1
          `,
          [tenantSlug]
        )

        if (!tenantResult.rowCount) {
          return reply.code(404).send({
            ok: false,
            error: `Tenant not found: ${tenantSlug}`
          })
        }

        tenant = {
          id: Number(tenantResult.rows[0].id),
          slug: String(tenantResult.rows[0].slug),
          name: String(tenantResult.rows[0].name)
        }
      }

      const tenantWhere = tenant
        ? "where tenant_id = $1"
        : ""

      const tenantAnd = tenant
        ? "and tenant_id = $1"
        : ""

      const params = tenant
        ? [tenant.id]
        : []

      const leadsResult = await pool.query(
        `
          select count(*)::int as total
          from jobs
          ${tenantWhere}
        `,
        params
      )

      const stagesResult = await pool.query(
        `
          select
            coalesce(stage, 'unknown') as stage,
            count(*)::int as total
          from jobs
          ${tenantWhere}
          group by stage
          order by total desc
        `,
        params
      )

      const timelineResult = await pool.query(
        `
          select
            kind,
            count(*)::int as total
          from timeline_events
          ${tenantWhere}
          group by kind
          order by total desc
        `,
        params
      )

      const estimateResult = await pool.query(
        `
          select count(*)::int as total
          from jobs
          where stage = 'estimate_sent'
          ${tenantAnd}
        `,
        params
      )

      const contractResult = await pool.query(
        `
          select count(*)::int as total
          from jobs
          where stage like '%contract%'
          ${tenantAnd}
        `,
        params
      )

      const aiActivityResult = await pool.query(
        `
          select count(*)::int as total
          from timeline_events
          where kind in (
            'workflow_started',
            'workflow_planned',
            'workflow_step'
          )
          ${tenantAnd}
        `,
        params
      )

      const leadSourceResult = await pool.query(
        `
          select
            coalesce(
              nullif(trim(lead_source), ''),
              'unknown'
            ) as source,
            count(*)::int as total
          from jobs
          ${tenantWhere}
          group by
            coalesce(
              nullif(trim(lead_source), ''),
              'unknown'
            )
          order by total desc
        `,
        params
      )

      const leadSourceDetailResult = await pool.query(
        `
          select
            coalesce(
              nullif(trim(lead_source_detail), ''),
              'unknown'
            ) as source_detail,
            count(*)::int as total
          from jobs
          ${tenantWhere}
          group by
            coalesce(
              nullif(trim(lead_source_detail), ''),
              'unknown'
            )
          order by total desc
        `,
        params
      )

      const marketingCampaignResult = await pool.query(
        `
          select
            coalesce(
              nullif(trim(marketing_campaign), ''),
              'unknown'
            ) as campaign,
            count(*)::int as total
          from jobs
          ${tenantWhere}
          group by
            coalesce(
              nullif(trim(marketing_campaign), ''),
              'unknown'
            )
          order by total desc
        `,
        params
      )

      const leadSourceStageResult = await pool.query(
        `
          select
            coalesce(
              nullif(trim(lead_source), ''),
              'unknown'
            ) as source,
            coalesce(
              nullif(trim(stage), ''),
              'unknown'
            ) as stage,
            count(*)::int as total
          from jobs
          ${tenantWhere}
          group by
            coalesce(
              nullif(trim(lead_source), ''),
              'unknown'
            ),
            coalesce(
              nullif(trim(stage), ''),
              'unknown'
            )
          order by source asc, total desc
        `,
        params
      )

      return reply.send({
        ok: true,
        source: "contractor-navigator",
        scope: tenant
          ? "tenant"
          : "global",
        tenant,
        generated_at: new Date().toISOString(),
        metrics: {
          total_leads:
            leadsResult.rows[0]?.total || 0,
          estimate_sent:
            estimateResult.rows[0]?.total || 0,
          contract_activity:
            contractResult.rows[0]?.total || 0,
          ai_activity:
            aiActivityResult.rows[0]?.total || 0
        },
        stage_breakdown:
          stagesResult.rows,
        timeline_activity:
          timelineResult.rows,
        lead_source_summary:
          leadSourceResult.rows,
        lead_source_stage_summary:
          leadSourceStageResult.rows,
        lead_source_detail_summary:
          leadSourceDetailResult.rows,
        marketing_campaign_summary:
          marketingCampaignResult.rows
      })
    } catch (err: any) {
      console.error(
        "crm reporting route failed",
        err
      )

      return reply.code(500).send({
        ok: false,
        error:
          err.message ||
          "crm reporting failed"
      })
    }
  })
}
