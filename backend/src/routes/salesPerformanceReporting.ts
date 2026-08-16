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
        }

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
              )::int as signed_sold

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
              )::int as signed_sold

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

        const summary =
          funnelResult.rows[0] || {
            opportunities: 0,
            estimates_sent: 0,
            contracts_sent: 0,
            signed_sold: 0
          }

        const opportunities =
          Number(summary.opportunities || 0)

        const estimatesSent =
          Number(summary.estimates_sent || 0)

        const contractsSent =
          Number(summary.contracts_sent || 0)

        const signedSold =
          Number(summary.signed_sold || 0)

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

            const sourceSigned =
              Number(row.signed_sold || 0)

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
              signed_sold:
                sourceSigned,
              sold_rate:
                percent(
                  sourceSigned,
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
            signed_sold:
              signedSold,
            sold_rate:
              percent(
                signedSold,
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
