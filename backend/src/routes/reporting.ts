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

      // Historical production milestones are intentionally independent
      // of the job's current CRM stage.
      //
      // A completed tarp remains a completed tarp even if that property
      // later becomes a roof job and advances through the roofing pipeline.
      //
      // A completed roof is an actual roofing-production job that is
      // currently completed or has historical stage-transition evidence
      // showing it reached completed. Estimate-only roof records are excluded.
      //
      // The same job may therefore count once as a completed tarp and once
      // as a completed roof. That overlap is the tarp-to-roof conversion.
      const productionMilestonesResult = await pool.query(
        `
          with production_jobs as (
            select
              j.id,
              j.tenant_id,
              lower(coalesce(trim(j.job_type), '')) as job_type,
              coalesce(j.stage, '') as current_stage,
              (
                coalesce(j.tarp_conversion_active, false) = true
                or j.stage = 'tarp_complete'
                or exists (
                  select 1
                  from timeline_events te
                  where te.tenant_id = j.tenant_id
                    and te.job_id = j.id
                    and te.kind = 'manual_stage_updated'
                    and coalesce(te.meta->>'stage', '') = 'tarp_complete'
                )
              ) as completed_tarp,
              (
                (
                  lower(coalesce(trim(j.job_type), '')) = 'roof'
                  or lower(coalesce(trim(j.job_type), '')) = 'roof_replacement'
                  or lower(coalesce(trim(j.job_type), '')) like '%roof replacement%'
                  or lower(coalesce(trim(j.job_type), '')) like '%new build roof%'
                  or lower(coalesce(trim(j.job_type), '')) like '%roof installation%'
                  or lower(coalesce(trim(j.job_type), '')) = 'residential roofing'
                )
                and lower(coalesce(trim(j.job_type), '')) not like '%estimate only%'
                and (
                  j.stage = 'completed'
                  or exists (
                    select 1
                    from timeline_events te
                    where te.tenant_id = j.tenant_id
                      and te.job_id = j.id
                      and te.kind = 'manual_stage_updated'
                      and coalesce(te.meta->>'stage', '') = 'completed'
                  )
                )
              ) as completed_roof
            from jobs j
            ${tenant ? "where j.tenant_id = $1" : ""}
          )
          select
            count(*) filter (
              where completed_tarp
            )::int as completed_tarps,
            count(*) filter (
              where completed_roof
            )::int as completed_roofs,
            count(*) filter (
              where completed_tarp and completed_roof
            )::int as tarp_to_roof_conversions
          from production_jobs
        `,
        params
      )

      const completedTarps =
        Number(productionMilestonesResult.rows[0]?.completed_tarps || 0)

      const completedRoofs =
        Number(productionMilestonesResult.rows[0]?.completed_roofs || 0)

      const tarpToRoofConversions =
        Number(
          productionMilestonesResult.rows[0]?.tarp_to_roof_conversions || 0
        )

      const tarpToRoofConversionRate =
        completedTarps > 0
          ? Number(
              (
                (tarpToRoofConversions / completedTarps) *
                100
              ).toFixed(2)
            )
          : 0

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

        const navigatorHealthResult = await pool.query(
    `
    select
      id,
      event_type,
      entity_id,
      metadata,
      created_at
    from system_events
    where entity_type = 'navigator_health'
      and event_type in (
        'navigator_health_failure',
        'navigator_health_recovered'
      )
    order by created_at desc, id desc
    limit 100
    `
  )

  const navigatorHealthEvents = navigatorHealthResult.rows

return reply.send({
        ok: true,
        source: "contractor-navigator",
      navigator_health: {
        events: navigatorHealthEvents,
      },
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
            aiActivityResult.rows[0]?.total || 0,
          completed_tarps:
            completedTarps,
          completed_roofs:
            completedRoofs,
          tarp_to_roof_conversions:
            tarpToRoofConversions,
          tarp_to_roof_conversion_rate:
            tarpToRoofConversionRate
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
