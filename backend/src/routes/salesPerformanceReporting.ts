import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"

const G2G_OWNER_PHONE = "7272154507"

function normalizedPhoneSql(value: string) {
  return `
    right(
      regexp_replace(
        coalesce(${value}, ''),
        '[^0-9]',
        '',
        'g'
      ),
      10
    )
  `
}

async function ensureSalesPerformanceReportingSchema() {
  await pool.query(`
    alter table customers
      add column if not exists reporting_classification text
      not null default 'customer'
  `)

  await pool.query(`
    update customers c
    set
      reporting_classification = 'owner',
      updated_at = now()
    from tenants t
    where t.id = c.tenant_id
      and t.slug = 'g2g-roofing'
      and ${normalizedPhoneSql("c.phone")} = $1
      and reporting_classification is distinct from 'owner'
  `, [G2G_OWNER_PHONE])
}

export async function registerSalesPerformanceReportingRoutes(
  app: FastifyInstance
) {
  await ensureSalesPerformanceReportingSchema()

  app.get(
    "/reporting/sales-performance.json",
    async (req, reply) => {
      try {
        const query = req.query as {
          tenant?: string
          range?: "7d" | "30d" | "all"
        }

        const requestedRange =
          String(query.range || "30d").trim()

        const range:
          | "7d"
          | "30d"
          | "all" =
          requestedRange === "7d" ||
          requestedRange === "all"
            ? requestedRange
            : "30d"

        const tenantSlug =
          String(query.tenant || "").trim()

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

        const params: unknown[] = []
        let tenantClause = ""

        if (tenant) {
          params.push(tenant.id)
          tenantClause =
            `and j.tenant_id = $${params.length}`
        }

        params.push(G2G_OWNER_PHONE)
        const ownerPhoneParameter = `$${params.length}`

        const businessPopulationClause = `
          and coalesce(
            c.reporting_classification,
            'customer'
          ) <> 'owner'

          and not (
            exists (
              select 1
              from tenants ot
              where ot.id = j.tenant_id
                and ot.slug = 'g2g-roofing'
            )
            and (
              ${normalizedPhoneSql("j.customer_phone")}
                = ${ownerPhoneParameter}
              or
              ${normalizedPhoneSql("c.phone")}
                = ${ownerPhoneParameter}
            )
          )
        `

        const funnelResult = await pool.query(
          `
            select
              count(*)::int as opportunities,

              count(*) filter (
                where j.estimate_sent_at is not null
              )::int as estimates_sent,

              count(*) filter (
                where
                  j.contract_sent_at is not null

                  or exists (
                    select 1
                    from job_document_packages dp
                    where dp.tenant_id = j.tenant_id
                      and dp.job_id = j.id
                      and dp.package_type <> 'ems_tarp'
                      and dp.sent_at is not null
                  )

                  or exists (
                    select 1
                    from timeline_events te
                    where te.tenant_id = j.tenant_id
                      and te.job_id = j.id
                      and te.kind = 'document_package_sent'
                      and coalesce(
                        te.meta ->> 'package_type',
                        ''
                      ) <> 'ems_tarp'
                  )
              )::int as contracts_sent,

              count(*) filter (
                where
                  exists (
                    select 1
                    from job_document_packages dp
                    where dp.tenant_id = j.tenant_id
                      and dp.job_id = j.id
                      and dp.package_type <> 'ems_tarp'
                      and dp.signed_at is not null
                  )

                  or exists (
                    select 1
                    from timeline_events te
                    where te.tenant_id = j.tenant_id
                      and te.job_id = j.id
                      and te.kind = 'document_package_signed'
                      and coalesce(
                        te.meta ->> 'package_type',
                        ''
                      ) <> 'ems_tarp'
                  )
              )::int as signed_package_received

            from jobs j

            left join customers c
              on c.id = j.customer_id
             and c.tenant_id = j.tenant_id

            where 1 = 1
            ${tenantClause}
            ${businessPopulationClause}
          `,
          params
        )

        const bySourceResult = await pool.query(
          `
            select
              coalesce(
                nullif(trim(j.lead_source), ''),
                'unknown'
              ) as source,

              count(*)::int as opportunities,

              count(*) filter (
                where j.estimate_sent_at is not null
              )::int as estimates_sent,

              count(*) filter (
                where
                  j.contract_sent_at is not null

                  or exists (
                    select 1
                    from job_document_packages dp
                    where dp.tenant_id = j.tenant_id
                      and dp.job_id = j.id
                      and dp.package_type <> 'ems_tarp'
                      and dp.sent_at is not null
                  )

                  or exists (
                    select 1
                    from timeline_events te
                    where te.tenant_id = j.tenant_id
                      and te.job_id = j.id
                      and te.kind = 'document_package_sent'
                      and coalesce(
                        te.meta ->> 'package_type',
                        ''
                      ) <> 'ems_tarp'
                  )
              )::int as contracts_sent,

              count(*) filter (
                where
                  exists (
                    select 1
                    from job_document_packages dp
                    where dp.tenant_id = j.tenant_id
                      and dp.job_id = j.id
                      and dp.package_type <> 'ems_tarp'
                      and dp.signed_at is not null
                  )

                  or exists (
                    select 1
                    from timeline_events te
                    where te.tenant_id = j.tenant_id
                      and te.job_id = j.id
                      and te.kind = 'document_package_signed'
                      and coalesce(
                        te.meta ->> 'package_type',
                        ''
                      ) <> 'ems_tarp'
                  )
              )::int as signed_package_received

            from jobs j

            left join customers c
              on c.id = j.customer_id
             and c.tenant_id = j.tenant_id

            where 1 = 1
            ${tenantClause}
            ${businessPopulationClause}

            group by
              coalesce(
                nullif(trim(j.lead_source), ''),
                'unknown'
              )

            order by
              opportunities desc,
              source asc
          `,
          params
        )

        const operationalParams = [...params]

        let createdDuringPeriodClause = ""

        if (range === "7d") {
          createdDuringPeriodClause =
            "and j.created_at >= now() - interval '7 days'"
        } else if (range === "30d") {
          createdDuringPeriodClause =
            "and j.created_at >= now() - interval '30 days'"
        }

        const createdDuringPeriodResult =
          await pool.query(
            `
              select count(*)::int as records_created
              from jobs j
              left join customers c
                on c.id = j.customer_id
               and c.tenant_id = j.tenant_id
              where 1 = 1
              ${tenantClause}
              ${businessPopulationClause}
              ${createdDuringPeriodClause}
            `,
            operationalParams
          )

        const buyingSignalResult =
          await pool.query(
            `
              select count(*)::int as jobs_with_buying_signal
              from jobs j

              left join customers c
                on c.id = j.customer_id
               and c.tenant_id = j.tenant_id

              where 1 = 1
              ${tenantClause}
              ${businessPopulationClause}
              ${createdDuringPeriodClause}

              and exists (
                select 1
                from timeline_events te
                where te.tenant_id = j.tenant_id
                  and te.job_id = j.id
                  and te.kind = 'buying_signal_detected'
              )
            `,
            operationalParams
          )

        const currentPipelineResult =
          await pool.query(
            `
              select
                coalesce(
                  nullif(trim(j.stage), ''),
                  'unknown'
                ) as stage,
                count(*)::int as count
              from jobs j
              left join customers c
                on c.id = j.customer_id
               and c.tenant_id = j.tenant_id
              where 1 = 1
              ${tenantClause}
              ${businessPopulationClause}
              group by
                coalesce(
                  nullif(trim(j.stage), ''),
                  'unknown'
                )
              order by
                count desc,
                stage asc
            `,
            operationalParams
          )

        const workMixResult =
          await pool.query(
            `
              select
                coalesce(
                  nullif(trim(j.job_type), ''),
                  'unknown'
                ) as job_type,
                count(*)::int as count
              from jobs j
              left join customers c
                on c.id = j.customer_id
               and c.tenant_id = j.tenant_id
              where 1 = 1
              ${tenantClause}
              ${businessPopulationClause}
              ${createdDuringPeriodClause}
              group by
                coalesce(
                  nullif(trim(j.job_type), ''),
                  'unknown'
                )
              order by
                count desc,
                job_type asc
            `,
            operationalParams
          )

        const attributionResult =
          await pool.query(
            `
              select
                coalesce(
                  nullif(trim(j.lead_source), ''),
                  'unknown'
                ) as lead_source,

                coalesce(
                  nullif(trim(j.lead_source_detail), ''),
                  'unknown'
                ) as lead_source_detail,

                coalesce(
                  nullif(trim(j.marketing_campaign), ''),
                  'unknown'
                ) as marketing_campaign,

                coalesce(
                  nullif(trim(j.carrier), ''),
                  'unknown'
                ) as carrier,

                count(*)::int as count

              from jobs j

              left join customers c
                on c.id = j.customer_id
               and c.tenant_id = j.tenant_id

              where 1 = 1
              ${tenantClause}
              ${businessPopulationClause}
              ${createdDuringPeriodClause}

              group by
                coalesce(
                  nullif(trim(j.lead_source), ''),
                  'unknown'
                ),
                coalesce(
                  nullif(trim(j.lead_source_detail), ''),
                  'unknown'
                ),
                coalesce(
                  nullif(trim(j.marketing_campaign), ''),
                  'unknown'
                ),
                coalesce(
                  nullif(trim(j.carrier), ''),
                  'unknown'
                )

              order by
                count desc,
                lead_source asc,
                lead_source_detail asc,
                marketing_campaign asc,
                carrier asc
            `,
            operationalParams
          )

        const periodOutcomeResult =
          await pool.query(
            `
              select
                coalesce(
                  nullif(trim(j.stage), ''),
                  'unknown'
                ) as current_stage,
                count(*)::int as count
              from jobs j
              left join customers c
                on c.id = j.customer_id
               and c.tenant_id = j.tenant_id
              where 1 = 1
              ${tenantClause}
              ${businessPopulationClause}
              ${createdDuringPeriodClause}
              group by
                coalesce(
                  nullif(trim(j.stage), ''),
                  'unknown'
                )
              order by
                count desc,
                current_stage asc
            `,
            operationalParams
          )

        const insurancePerformanceResult =
          await pool.query(
            `
              select
                coalesce(
                  nullif(trim(j.carrier), ''),
                  'unknown'
                ) as carrier,

                coalesce(
                  nullif(trim(j.lead_source_detail), ''),
                  'unknown'
                ) as tpa_or_source_detail,

                coalesce(
                  nullif(trim(j.job_type), ''),
                  'unknown'
                ) as job_type,

                coalesce(
                  nullif(trim(j.stage), ''),
                  'unknown'
                ) as current_stage,

                count(*)::int as count

              from jobs j

              left join customers c
                on c.id = j.customer_id
               and c.tenant_id = j.tenant_id

              where 1 = 1
              ${tenantClause}
              ${businessPopulationClause}
              ${createdDuringPeriodClause}

              and (
                nullif(trim(j.carrier), '') is not null
                or lower(
                  coalesce(
                    nullif(trim(j.lead_source), ''),
                    ''
                  )
                ) in (
                  'insurance',
                  'insurance assignment',
                  'insurance claim',
                  'claims'
                )
              )

              group by
                coalesce(
                  nullif(trim(j.carrier), ''),
                  'unknown'
                ),
                coalesce(
                  nullif(trim(j.lead_source_detail), ''),
                  'unknown'
                ),
                coalesce(
                  nullif(trim(j.job_type), ''),
                  'unknown'
                ),
                coalesce(
                  nullif(trim(j.stage), ''),
                  'unknown'
                )

              order by
                count desc,
                carrier asc,
                tpa_or_source_detail asc,
                job_type asc,
                current_stage asc
            `,
            operationalParams
          )

        const supportingJobsResult =
          await pool.query(
            `
              select
                j.id as navigator_job_id,

                coalesce(
                  nullif(trim(c.full_name), ''),
                  'Job ' || j.id::text
                ) as job_label,

                j.created_at,

                coalesce(
                  nullif(trim(j.stage), ''),
                  'unknown'
                ) as current_stage,

                nullif(trim(j.job_type), '')
                  as job_type,

                nullif(trim(j.lead_source), '')
                  as lead_source,

                nullif(trim(j.lead_source_detail), '')
                  as lead_source_detail,

                nullif(trim(j.marketing_campaign), '')
                  as marketing_campaign,

                nullif(trim(j.carrier), '')
                  as carrier,

                j.current_stage_entered_at,

                case
                  when j.current_stage_entered_at is null
                    then null
                  else greatest(
                    0,
                    floor(
                      extract(
                        epoch from (
                          now() -
                          j.current_stage_entered_at
                        )
                      ) / 86400
                    )
                  )::int
                end as days_in_current_stage

              from jobs j

              left join customers c
                on c.id = j.customer_id
               and c.tenant_id = j.tenant_id

              where 1 = 1
              ${tenantClause}
              ${businessPopulationClause}
              ${createdDuringPeriodClause}

              order by
                j.created_at desc,
                j.id desc
            `,
            operationalParams
          )

        const stageAgingResult =
          await pool.query(
            `
              select
                j.id as navigator_job_id,

                coalesce(
                  nullif(trim(c.full_name), ''),
                  'Job ' || j.id::text
                ) as job_label,

                coalesce(
                  nullif(trim(j.stage), ''),
                  'unknown'
                ) as current_stage,

                j.current_stage_entered_at,

                case
                  when j.current_stage_entered_at is null
                    then null
                  else greatest(
                    0,
                    floor(
                      extract(
                        epoch from (
                          now() -
                          j.current_stage_entered_at
                        )
                      ) / 86400
                    )
                  )::int
                end as days_in_current_stage,

                nullif(
                  trim(j.job_type),
                  ''
                ) as job_type,

                nullif(
                  trim(j.lead_source),
                  ''
                ) as lead_source,

                nullif(
                  trim(j.lead_source_detail),
                  ''
                ) as lead_source_detail,

                nullif(
                  trim(j.marketing_campaign),
                  ''
                ) as marketing_campaign,

                nullif(
                  trim(j.carrier),
                  ''
                ) as carrier

              from jobs j

              left join customers c
                on c.id = j.customer_id
               and c.tenant_id = j.tenant_id

              where 1 = 1
              ${tenantClause}
              ${businessPopulationClause}

              and j.current_stage_entered_at is not null

              and lower(
                coalesce(
                  nullif(trim(j.stage), ''),
                  'unknown'
                )
              ) not in (
                'archived',
                'disqualified',
                'paid'
              )

              order by
                days_in_current_stage desc,
                j.current_stage_entered_at asc,
                j.id asc
            `,
            operationalParams
          )

        const createdDuringPeriod =
          Number(
            createdDuringPeriodResult
              .rows[0]
              ?.records_created || 0
          )

        const currentPipeline =
          currentPipelineResult.rows.map(
            (row) => ({
              stage: row.stage,
              count: Number(row.count || 0)
            })
          )

        const workMix =
          workMixResult.rows.map(
            (row) => ({
              job_type: row.job_type,
              count: Number(row.count || 0)
            })
          )

        const attribution =
          attributionResult.rows.map(
            (row) => ({
              lead_source: row.lead_source,
              lead_source_detail:
                row.lead_source_detail,
              marketing_campaign:
                row.marketing_campaign,
              carrier: row.carrier,
              count: Number(row.count || 0)
            })
          )

        const periodOutcomes =
          periodOutcomeResult.rows.map(
            (row) => ({
              current_stage: row.current_stage,
              count: Number(row.count || 0)
            })
          )

        const insurancePerformance =
          insurancePerformanceResult.rows.map(
            (row) => ({
              carrier: row.carrier,
              tpa_or_source_detail:
                row.tpa_or_source_detail,
              job_type: row.job_type,
              current_stage: row.current_stage,
              count: Number(row.count || 0)
            })
          )

        const supportingJobs =
          supportingJobsResult.rows.map(
            (row) => ({
              navigator_job_id:
                Number(row.navigator_job_id),
              job_label: row.job_label,
              created_at: row.created_at,
              current_stage: row.current_stage,
              job_type: row.job_type,
              lead_source: row.lead_source,
              lead_source_detail:
                row.lead_source_detail,
              marketing_campaign:
                row.marketing_campaign,
              carrier: row.carrier,
              current_stage_entered_at:
                row.current_stage_entered_at,
              days_in_current_stage:
                row.days_in_current_stage === null
                  ? null
                  : Number(row.days_in_current_stage)
            })
          )

        const stageAging =
          stageAgingResult.rows.map(
            (row) => ({
              navigator_job_id:
                Number(row.navigator_job_id),

              job_label:
                row.job_label,

              current_stage:
                row.current_stage,

              current_stage_entered_at:
                row.current_stage_entered_at,

              days_in_current_stage:
                row.days_in_current_stage === null
                  ? null
                  : Number(
                      row.days_in_current_stage
                    ),

              job_type:
                row.job_type,

              lead_source:
                row.lead_source,

              lead_source_detail:
                row.lead_source_detail,

              marketing_campaign:
                row.marketing_campaign,

              carrier:
                row.carrier
            })
          )

        const summary =
          funnelResult.rows[0] || {
            opportunities: 0,
            estimates_sent: 0,
            contracts_sent: 0,
            signed_package_received: 0
          }

        const opportunities =
          Number(summary.opportunities || 0)

        const estimatesSent =
          Number(summary.estimates_sent || 0)

        const contractsSent =
          Number(summary.contracts_sent || 0)

        const signedPackageReceived =
          Number(summary.signed_package_received || 0)

        const percent = (
          numerator: number,
          denominator: number
        ) =>
          denominator > 0
            ? Number(
                (
                  (numerator / denominator) *
                  100
                ).toFixed(1)
              )
            : 0

        const bySource =
          bySourceResult.rows.map((row) => {
            const sourceOpportunities =
              Number(row.opportunities || 0)

            const sourceEstimates =
              Number(row.estimates_sent || 0)

            const sourceContracts =
              Number(row.contracts_sent || 0)

            const sourcePackageReceived =
              Number(row.signed_package_received || 0)

            return {
              source: row.source,
              opportunities:
                sourceOpportunities,
              estimates_sent:
                sourceEstimates,
              estimate_rate:
                percent(
                  sourceEstimates,
                  sourceOpportunities
                ),
              contracts_sent:
                sourceContracts,
              contract_rate:
                percent(
                  sourceContracts,
                  sourceOpportunities
                ),
              signed_package_received:
                sourcePackageReceived,
              package_received_rate:
                percent(
                  sourcePackageReceived,
                  sourceOpportunities
                )
            }
          })

        return reply.send({
          ok: true,
          source:
            "contractor-navigator-sales-performance",
          scope: tenant
            ? "tenant"
            : "global",
          tenant,
          generated_at:
            new Date().toISOString(),

          reporting_policy: {
            owner_activity:
              "excluded_from_business_performance",
            operational_records:
              "preserved",
            ems_tarp_signatures:
              "not_counted_as_sales"
          },

          operational_summary: {
            semantics: {
              selected_range: range,
              selected_period_population:
                range === "all"
                  ? "all_available_business_population_jobs"
                  : "jobs_created_during_selected_period",
              current_pipeline:
                "current_stage_snapshot_not_period_stage_transitions",
              current_stage_aging:
                "derived_only_from_current_stage_entered_at",
              unknown_stage_since:
                "preserved_as_unknown",
              historical_cycle_time:
                "not_claimed",
              financial_interpretation:
                "not_claimed"
            },

            created_during_period: {
              count: createdDuringPeriod
            },

            current_pipeline: {
              by_stage: currentPipeline
            },

            work_mix: {
              population:
                range === "all"
                  ? "all_available_business_population_jobs"
                  : "jobs_created_during_selected_period",
              by_job_type: workMix
            },

            attribution: {
              population:
                range === "all"
                  ? "all_available_business_population_jobs"
                  : "jobs_created_during_selected_period",
              dimensions_preserved_independently: [
                "lead_source",
                "lead_source_detail",
                "marketing_campaign",
                "carrier"
              ],
              combinations: attribution
            },

            period_outcomes: {
              population:
                range === "all"
                  ? "all_available_business_population_jobs"
                  : "jobs_created_during_selected_period",
              interpretation:
                "current_stage_of_selected_population_not_historical_transition",
              by_current_stage: periodOutcomes
            },

            buying_signals: {
              authority:
                "timeline_events.kind=buying_signal_detected",
              population:
                range === "all"
                  ? "all_available_business_population_jobs"
                  : "jobs_created_during_selected_period",
              interpretation:
                "jobs_with_at_least_one_durable_navigator_buying_signal",
              jobs_with_buying_signal: Number(
                buyingSignalResult.rows[0]
                  ?.jobs_with_buying_signal || 0
              )
            },

            insurance_performance: {
              population:
                range === "all"
                  ? "all_available_business_population_jobs"
                  : "jobs_created_during_selected_period",
              dimensions_preserved_independently: [
                "carrier",
                "tpa_or_source_detail",
                "job_type",
                "current_stage"
              ],
              tpa_semantics:
                "lead_source_detail_when_present_not_carrier",
              rows: insurancePerformance
            },

            supporting_jobs: {
              population:
                range === "all"
                  ? "all_available_business_population_jobs"
                  : "jobs_created_during_selected_period",
              drill_down:
                "/job/:navigator_job_id",
              jobs: supportingJobs
            },

            current_stage_aging: {
              authority:
                "current_stage_entered_at",
              interpretation:
                "factual_age_not_automatic_bottleneck",
              jobs: stageAging
            }
          },

          funnel: {
            opportunities,
            estimates_sent:
              estimatesSent,
            estimate_rate:
              percent(
                estimatesSent,
                opportunities
              ),
            contracts_sent:
              contractsSent,
            contract_rate:
              percent(
                contractsSent,
                opportunities
              ),
            signed_package_received:
              signedPackageReceived,
            package_received_rate:
              percent(
                signedPackageReceived,
                opportunities
              )
          },

          by_source: bySource
        })
      } catch (err: any) {
        console.error(
          "sales performance reporting route failed",
          err
        )

        return reply.code(500).send({
          ok: false,
          error:
            err?.message ||
            "sales performance reporting failed"
        })
      }
    }
  )
}
