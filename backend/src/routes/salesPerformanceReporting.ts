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

        const actualAssistantPerformanceResult =
          await pool.query(
            `
              with selected_jobs as (
                select
                  j.id,
                  j.tenant_id,
                  j.estimate_sent_at,
                  j.contract_sent_at,

                  (
                    select min(te.created_at)
                    from timeline_events te
                    where te.tenant_id = j.tenant_id
                      and te.job_id = j.id
                      and te.kind in (
                        'ai_message_sent',
                        'ai_inbound_response_sent',
                        'voice_followup_sms_sent'
                      )
                  ) as first_aa_engagement_at,

                  (
                    select min(te.created_at)
                    from timeline_events te
                    where te.tenant_id = j.tenant_id
                      and te.job_id = j.id
                      and te.kind =
                        'buying_signal_detected'
                  ) as first_buying_signal_at,

                  (
                    select min(dp.sent_at)
                    from job_document_packages dp
                    where dp.tenant_id = j.tenant_id
                      and dp.job_id = j.id
                      and dp.package_type <> 'ems_tarp'
                      and dp.sent_at is not null
                  ) as package_sent_at,

                  (
                    select min(dp.signed_at)
                    from job_document_packages dp
                    where dp.tenant_id = j.tenant_id
                      and dp.job_id = j.id
                      and dp.package_type <> 'ems_tarp'
                      and dp.signed_at is not null
                  ) as package_signed_at,

                  (
                    select min(te.created_at)
                    from timeline_events te
                    where te.tenant_id = j.tenant_id
                      and te.job_id = j.id
                      and te.kind =
                        'document_package_sent'
                      and coalesce(
                        te.meta ->> 'package_type',
                        ''
                      ) <> 'ems_tarp'
                  ) as package_sent_event_at,

                  (
                    select min(te.created_at)
                    from timeline_events te
                    where te.tenant_id = j.tenant_id
                      and te.job_id = j.id
                      and te.kind =
                        'document_package_signed'
                      and coalesce(
                        te.meta ->> 'package_type',
                        ''
                      ) <> 'ems_tarp'
                  ) as package_signed_event_at

                from jobs j

                left join customers c
                  on c.id = j.customer_id
                  and c.tenant_id = j.tenant_id

                where 1 = 1
                ${tenantClause}
                ${businessPopulationClause}
                ${createdDuringPeriodClause}
              ),

              classified as (
                select
                  *,

                  case
                    when package_sent_at is null
                      then package_sent_event_at
                    when package_sent_event_at is null
                      then package_sent_at
                    else least(
                      package_sent_at,
                      package_sent_event_at
                    )
                  end as first_package_sent_at,

                  case
                    when package_signed_at is null
                      then package_signed_event_at
                    when package_signed_event_at is null
                      then package_signed_at
                    else least(
                      package_signed_at,
                      package_signed_event_at
                    )
                  end as first_package_signed_at

                from selected_jobs
              )

              select
                count(*) filter (
                  where first_aa_engagement_at is not null
                )::int as engaged_opportunities,

                count(*) filter (
                  where
                    first_aa_engagement_at is not null
                    and estimate_sent_at is not null
                    and estimate_sent_at >=
                      first_aa_engagement_at
                )::int as estimates_sent_after_engagement,

                count(*) filter (
                  where
                    first_aa_engagement_at is not null
                    and (
                      (
                        contract_sent_at is not null
                        and contract_sent_at >=
                          first_aa_engagement_at
                      )
                      or (
                        first_package_sent_at is not null
                        and first_package_sent_at >=
                          first_aa_engagement_at
                      )
                    )
                )::int as contracts_sent_after_engagement,

                count(*) filter (
                  where
                    first_aa_engagement_at is not null
                    and first_package_signed_at is not null
                    and first_package_signed_at >=
                      first_aa_engagement_at
                )::int as contracts_signed_after_engagement,

                count(*) filter (
                  where
                    first_aa_engagement_at is not null
                    and first_buying_signal_at is not null
                    and first_buying_signal_at >=
                      first_aa_engagement_at
                )::int as buying_signals_after_engagement

              from classified
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

        const opportunityJourneyResult =
          await pool.query(
            `
              with selected_jobs as (
                select
                  j.id,

                  nullif(trim(j.lead_source), '')
                    as stored_lead_source,

                  nullif(trim(j.lead_source_detail), '')
                    as stored_lead_source_detail,

                  nullif(trim(j.marketing_campaign), '')
                    as marketing_campaign,

                  (
                    select te.meta
                    from timeline_events te
                    where te.tenant_id = j.tenant_id
                      and te.job_id = j.id
                      and te.message = 'Website estimate received'
                    order by te.created_at asc
                    limit 1
                  ) as estimator_meta,

                  exists (
                    select 1
                    from timeline_events te
                    where te.tenant_id = j.tenant_id
                      and te.job_id = j.id
                      and te.message = 'Website estimate received'
                  ) as entered_via_estimator,

                  exists (
                    select 1
                    from timeline_events te
                    where te.tenant_id = j.tenant_id
                      and te.job_id = j.id
                      and (
                        te.meta ->> 'source' =
                          'wordpress_contact_form'
                        or te.meta ->> 'source_detail' =
                          'wordpress_contact_form'
                      )
                  ) as entered_via_contact_form,

                  exists (
                    select 1
                    from timeline_events te
                    where te.tenant_id = j.tenant_id
                      and te.job_id = j.id
                      and te.kind in (
                        'ai_message_sent',
                        'ai_inbound_response_sent',
                        'voice_followup_sms_sent'
                      )
                  ) as aa_engaged

                from jobs j

                left join customers c
                  on c.id = j.customer_id
                  and c.tenant_id = j.tenant_id

                where 1 = 1
                ${tenantClause}
                ${businessPopulationClause}
                ${createdDuringPeriodClause}
              ),

              interpreted as (
                select
                  *,

                  nullif(
                    trim(
                      coalesce(
                        estimator_meta ->> 'custSource',
                        estimator_meta ->> 'heardAbout'
                      )
                    ),
                    ''
                  ) as customer_reported_source,

                  case
                    when entered_via_estimator
                      then 'Instant Estimator'
                    when entered_via_contact_form
                      then 'Website Contact Form'
                    when lower(
                      coalesce(stored_lead_source, '')
                    ) in (
                      'manual_office_email',
                      'manual office email'
                    )
                      then 'Office Email'
                    when lower(
                      coalesce(stored_lead_source, '')
                    ) in (
                      'manual_office_entry',
                      'manual office entry'
                    )
                      then 'Manual Office Entry'
                    when lower(
                      coalesce(stored_lead_source, '')
                    ) like '%voice%'
                      then 'Voice Intake'
                    when lower(
                      coalesce(stored_lead_source, '')
                    ) like '%sms%'
                      then 'SMS Intake'
                    when lower(
                      coalesce(stored_lead_source, '')
                    ) like '%universal%outreach%'
                      then 'Universal Outreach'
                    else 'Unknown'
                  end as entry_channel

                from selected_jobs
              ),

              qualified as (
                select
                  *,

                  case
                    /*
                     * Customer-reported estimator source is acquisition
                     * evidence, but explicitly labeled as customer-reported.
                     */
                    when customer_reported_source is not null
                      then customer_reported_source

                    /*
                     * These are acquisition/origin values only when the
                     * stored source is not merely an intake mechanism.
                     */
                    when stored_lead_source is not null
                      and lower(stored_lead_source) not in (
                        'instant_estimator',
                        'website estimator',
                        'estimator',
                        'manual_office_email',
                        'manual office email',
                        'manual_office_entry',
                        'manual office entry',
                        'wordpress_contact_form',
                        'website contact form',
                        'voice_intake',
                        'twilio_voice_intake',
                        'sms_intake'
                      )
                      then stored_lead_source

                    else 'Unknown'
                  end as acquisition_source,

                  case
                    when customer_reported_source is not null
                      then 'customer_reported'
                    when stored_lead_source is not null
                      and lower(stored_lead_source) not in (
                        'instant_estimator',
                        'website estimator',
                        'estimator',
                        'manual_office_email',
                        'manual office email',
                        'manual_office_entry',
                        'manual office entry',
                        'wordpress_contact_form',
                        'website contact form',
                        'voice_intake',
                        'twilio_voice_intake',
                        'sms_intake'
                      )
                      then 'stored_navigator_attribution'
                    else 'unknown'
                  end as acquisition_evidence

                from interpreted
              )

              select
                acquisition_source,
                acquisition_evidence,
                entry_channel,
                aa_engaged,
                coalesce(marketing_campaign, 'unknown')
                  as marketing_campaign,
                count(*)::int as count

              from qualified

              group by
                acquisition_source,
                acquisition_evidence,
                entry_channel,
                aa_engaged,
                coalesce(marketing_campaign, 'unknown')

              order by
                count desc,
                acquisition_source asc,
                entry_channel asc
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

        const opportunityJourney =
          opportunityJourneyResult.rows.map((row: any) => ({
            acquisition_source:
              row.acquisition_source || "Unknown",
            acquisition_evidence:
              row.acquisition_evidence || "unknown",
            entry_channel:
              row.entry_channel || "Unknown",
            aa_engaged:
              row.aa_engaged === true,
            marketing_campaign:
              row.marketing_campaign || "unknown",
            count: Number(row.count || 0)
          }))

        const actualAssistantPerformanceRow =
          actualAssistantPerformanceResult.rows[0] || {}

        const actualAssistantPerformance = {
          authority:
            "durable_customer_facing_navigator_timeline_evidence",
          interpretation:
            "chronology_after_documented_aa_engagement_not_causation",
          engagement_event_kinds: [
            "ai_message_sent",
            "ai_inbound_response_sent",
            "voice_followup_sms_sent"
          ],
          engaged_opportunities: Number(
            actualAssistantPerformanceRow
              .engaged_opportunities || 0
          ),
          estimates_sent_after_engagement: Number(
            actualAssistantPerformanceRow
              .estimates_sent_after_engagement || 0
          ),
          contracts_sent_after_engagement: Number(
            actualAssistantPerformanceRow
              .contracts_sent_after_engagement || 0
          ),
          contracts_signed_after_engagement: Number(
            actualAssistantPerformanceRow
              .contracts_signed_after_engagement || 0
          ),
          buying_signals_after_engagement: Number(
            actualAssistantPerformanceRow
              .buying_signals_after_engagement || 0
          )
        }

        const createdDuringPeriod =
          Number(
            createdDuringPeriodResult
              .rows[0]
              ?.records_created || 0
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

        const currentPipeline =
          currentPipelineResult.rows.map(
            (row) => ({
              stage: row.stage,
              count: Number(row.count || 0),
              jobs: supportingJobs
                .filter(
                  (job) =>
                    String(
                      job.current_stage || "unknown"
                    ).toLowerCase() ===
                    String(
                      row.stage || "unknown"
                    ).toLowerCase()
                )
                .map((job) => ({
                  ...job
                }))
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

            opportunity_journey: {
              population:
                range === "all"
                  ? "all_available_business_population_jobs"
                  : "jobs_created_during_selected_period",
              semantics: {
                acquisition_source:
                  "who_or_what_generated_the_opportunity_when_supported_by_evidence",
                acquisition_evidence:
                  "strength_or_type_of_evidence_supporting_acquisition_source",
                entry_channel:
                  "how_the_opportunity_entered_navigator_or_actual_assistant",
                aa_engaged:
                  "durable_customer_facing_actual_assistant_engagement_exists",
                unknown:
                  "unknown_is_preserved_when_acquisition_cannot_be_proven"
              },
              dimensions_preserved_independently: [
                "acquisition_source",
                "acquisition_evidence",
                "entry_channel",
                "marketing_campaign",
                "aa_engaged"
              ],
              rows: opportunityJourney
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

            actual_assistant_performance:
              actualAssistantPerformance,

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
