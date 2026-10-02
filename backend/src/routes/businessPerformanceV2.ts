import type { FastifyInstance } from "fastify";
import { pool } from "../db/db";

type Range = "7d" | "30d" | "90d" | "365d" | "all";

function numberValue(value: unknown): number {
  return Number(value || 0);
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

export async function registerBusinessPerformanceV2Routes(
  app: FastifyInstance
) {
  app.get(
    "/reporting/business-performance-v2.json",
    async (req, reply) => {
      try {
        const query = req.query as {
          tenant?: string;
          range?: Range;
        };

        const tenantSlug =
          String(query.tenant || "g2g-roofing").trim();

        const requestedRange =
          String(query.range || "30d").trim();

        const range: Range =
          requestedRange === "7d" ||
          requestedRange === "30d" ||
          requestedRange === "90d" ||
          requestedRange === "365d" ||
          requestedRange === "all"
            ? requestedRange
            : "30d";

        const tenantResult = await pool.query(
          `
            select id, slug, name
            from tenants
            where slug = $1
            limit 1
          `,
          [tenantSlug]
        );

        if (tenantResult.rows.length === 0) {
          return reply.code(404).send({
            ok: false,
            error: "tenant_not_found",
            tenant: tenantSlug
          });
        }

        const tenant = tenantResult.rows[0];

        const rangeClause =
          range === "all"
            ? ""
            : range === "7d"
              ? "and j.created_at >= now() - interval '7 days'"
              : range === "30d"
                ? "and j.created_at >= now() - interval '30 days'"
                : range === "90d"
                  ? "and j.created_at >= now() - interval '90 days'"
                  : "and j.created_at >= now() - interval '365 days'";

        /*
         * V2 REPORTING CONTRACT
         *
         * This report intentionally keeps these truths independent:
         *
         *   1. Acquisition source
         *      Who/what generated the opportunity when supported.
         *
         *   2. Entry channel
         *      How the opportunity entered Navigator / Actual Assistant.
         *
         *   3. Actual Assistant participation
         *      Durable customer-facing AA evidence.
         *
         *   4. Downstream chronology
         *      What happened at/after documented AA participation.
         *      Chronology is NOT causation.
         *
         *   5. Insurance / assignment dimensions
         *      Carrier and source/TPA evidence remain separate.
         *
         * Owner-classified activity is excluded from business performance.
         * Unknown evidence is preserved as Unknown.
         */

        const tarpRoofConversionResult = await pool.query(
          `
            select
              count(*)::int as tarp_roof_conversions,
              coalesce(
                array_agg(conversions.id order by conversions.id),
                '{}'::int[]
              ) as tarp_roof_conversion_job_ids
            from (
              select
                j.id,
                min(qualifying_event.created_at) as qualifying_at
              from jobs j
              join lateral (
                select min(te.created_at) as tarp_at
                from timeline_events te
                where te.tenant_id = j.tenant_id
                  and te.job_id = j.id
                  and te.kind = 'manual_stage_updated'
                  and coalesce(te.meta->>'stage', '') = 'tarp_complete'
              ) tarp_event on tarp_event.tarp_at is not null
              join lateral (
                select min(te.created_at) as created_at
                from timeline_events te
                where te.tenant_id = j.tenant_id
                  and te.job_id = j.id
                  and te.kind = 'manual_stage_updated'
                  and coalesce(te.meta->>'stage', '') in (
                    'roof_repair',
                    'roof_replacement',
                    'completed',
                    'invoiced',
                    'paid'
                  )
                  and te.created_at > tarp_event.tarp_at
              ) qualifying_event on qualifying_event.created_at is not null
              where j.tenant_id = $1
              group by j.id
            ) conversions
            where conversions.qualifying_at >=
              case
                when $2 = '7d' then now() - interval '7 days'
                when $2 = '30d' then now() - interval '30 days'
                when $2 = '90d' then now() - interval '90 days'
                when $2 = '365d' then now() - interval '365 days'
                else '-infinity'::timestamptz
              end
          `,
          [tenant.id, range]
        );

        const result = await pool.query(
          `
            with selected_jobs as (
              select
                j.id,
                j.tenant_id,
                j.created_at,
                j.stage,
                j.current_stage_entered_at,
                j.job_type,

                nullif(trim(j.lead_source), '')
                  as stored_lead_source,

                nullif(trim(j.lead_source_detail), '')
                  as stored_lead_source_detail,

                nullif(trim(j.marketing_campaign), '')
                  as marketing_campaign,

                nullif(trim(j.carrier), '')
                  as carrier,

                j.estimate_sent_at,
                j.contract_sent_at,

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

                (
                  select min(te.created_at)
                  from timeline_events te
                  where te.tenant_id = j.tenant_id
                    and te.job_id = j.id
                    and te.kind in (
                      'ai_message_sent',
                      'ai_inbound_response_sent',
                      'voice_followup_sms_sent',
                      'voice_ai_response_spoken'
                    )
                ) as first_aa_engagement_at,

                (
                  select min(te.created_at)
                  from timeline_events te
                  where te.tenant_id = j.tenant_id
                    and te.job_id = j.id
                    and te.kind = 'buying_signal_detected'
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
                    and te.kind = 'document_package_sent'
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
                    and te.kind = 'document_package_signed'
                    and coalesce(
                      te.meta ->> 'package_type',
                      ''
                    ) <> 'ems_tarp'
                ) as package_signed_event_at,

                coalesce(
                  nullif(trim(c.full_name), ''),
                  'Job ' || j.id::text
                ) as job_label

              from jobs j

              left join customers c
                on c.id = j.customer_id
               and c.tenant_id = j.tenant_id

              where j.tenant_id = $1

                and coalesce(
                  c.reporting_classification,
                  'customer'
                ) <> 'owner'

                ${rangeClause}
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
                    'instant_estimator',
                    'website estimator',
                    'estimator'
                  )
                    then 'Instant Estimator'

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
                  ) = 'phone call'
                    and lower(
                      coalesce(stored_lead_source_detail, '')
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

                  else 'Other / Unknown'
                end as entry_channel,

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
            ),

            qualified as (
              select
                *,

                case
                  when customer_reported_source is not null
                    then customer_reported_source

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
                      'sms_intake',
                      'phone call'
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
                      'sms_intake',
                      'phone call'
                    )
                    then 'stored_navigator_attribution'

                  else 'unknown'
                end as acquisition_evidence,

                first_aa_engagement_at is not null
                  as aa_engaged,

                (
                  estimate_sent_at is not null
                  or stage in (
                    'estimate_sent',
                    'contract_sent',
                    'contract_signed',
                    'in_production',
                    'invoiced',
                    'paid'
                  )
                ) as estimate_evidence,

                (
                  contract_sent_at is not null
                  or first_package_sent_at is not null
                  or stage in (
                    'contract_sent',
                    'contract_signed',
                    'in_production',
                    'invoiced',
                    'paid'
                  )
                ) as contract_evidence,

                (
                  first_package_signed_at is not null
                  or stage in (
                    'contract_signed',
                    'in_production',
                    'invoiced',
                    'paid'
                  )
                ) as signed_evidence,

                stage in (
                  'in_production',
                  'invoiced',
                  'paid'
                ) as production_evidence,

                stage in (
                  'invoiced',
                  'paid'
                ) as invoiced_evidence,

                stage = 'paid'
                  as paid_evidence,

                (
                  first_package_signed_at is not null
                  or stage in (
                    'contract_signed',
                    'pre_production',
                    'in_production',
                    'invoiced',
                    'paid'
                  )
                ) as work_scheduled_evidence

              from interpreted
            )

            select
              *
            from qualified
            order by created_at desc, id desc
          `,
          [tenant.id]
        );

        const jobs = result.rows.map((row: any) => {
          const firstAA =
            row.first_aa_engagement_at
              ? new Date(row.first_aa_engagement_at)
              : null;

          const estimateAt =
            row.estimate_sent_at
              ? new Date(row.estimate_sent_at)
              : null;

          const contractCandidates = [
            row.contract_sent_at,
            row.first_package_sent_at
          ]
            .filter(Boolean)
            .map((value) => new Date(value));

          const contractAt =
            contractCandidates.length > 0
              ? new Date(
                  Math.min(
                    ...contractCandidates.map(
                      (value) => value.getTime()
                    )
                  )
                )
              : null;

          const signedAt =
            row.first_package_signed_at
              ? new Date(row.first_package_signed_at)
              : null;

          const buyingSignalAt =
            row.first_buying_signal_at
              ? new Date(row.first_buying_signal_at)
              : null;

          return {
            navigator_job_id: numberValue(row.id),
            job_label: row.job_label,
            created_at: row.created_at,
            current_stage: row.stage || "unknown",
            job_type: row.job_type || null,

            acquisition: {
              source: row.acquisition_source || "Unknown",
              evidence:
                row.acquisition_evidence || "unknown",
              raw_lead_source:
                row.stored_lead_source || null,
              raw_lead_source_detail:
                row.stored_lead_source_detail || null,
              marketing_campaign:
                row.marketing_campaign || null
            },

            entry: {
              channel:
                row.entry_channel || "Other / Unknown"
            },

            actual_assistant: {
              engaged: row.aa_engaged === true,
              first_engagement_at:
                row.first_aa_engagement_at || null,

              buying_signal_after_engagement:
                Boolean(
                  firstAA &&
                  buyingSignalAt &&
                  buyingSignalAt >= firstAA
                ),

              estimate_after_engagement:
                Boolean(
                  firstAA &&
                  estimateAt &&
                  estimateAt >= firstAA
                ),

              contract_after_engagement:
                Boolean(
                  firstAA &&
                  contractAt &&
                  contractAt >= firstAA
                ),

              signed_after_engagement:
                Boolean(
                  firstAA &&
                  signedAt &&
                  signedAt >= firstAA
                )
            },

            insurance: {
              assignment_source:
                row.stored_lead_source || null,
              source_detail:
                row.stored_lead_source_detail || null,
              carrier: row.carrier || null
            },

            outcomes: {
              estimate: row.estimate_evidence === true,
              contract: row.contract_evidence === true,
              signed: row.signed_evidence === true,
              production:
                row.production_evidence === true,
              invoiced:
                row.invoiced_evidence === true,
              paid: row.paid_evidence === true,
              work_scheduled:
                row.work_scheduled_evidence === true
            }
          };
        });

        /*
         * REPORTABLE OPPORTUNITY POPULATION
         *
         * Raw Voice Intake / Phone Call records are preserved as
         * activity but are not automatically promoted to equivalent
         * business opportunities.
         *
         * A record becomes reportable when it contains at least one
         * meaningful business signal:
         *
         * - supported acquisition evidence
         * - non-voice/phone entry
         * - estimate or later business outcome
         * - buying signal
         *
         * AA engagement by itself remains participation evidence;
         * it does not manufacture an acquisition source.
         */

        const reportableJobs = jobs.filter((job: any) => {
          const hasAcquisition =
            job.acquisition.source !== "Unknown";

          const meaningfulEntry =
            ![
              "Voice Intake",
              "Other / Unknown"
            ].includes(job.entry.channel);

          const hasOutcome =
            job.outcomes.estimate ||
            job.outcomes.contract ||
            job.outcomes.signed ||
            job.outcomes.production ||
            job.outcomes.invoiced ||
            job.outcomes.paid;

          const hasBuyingSignal =
            job.actual_assistant
              .buying_signal_after_engagement;

          return (
            hasAcquisition ||
            meaningfulEntry ||
            hasOutcome ||
            hasBuyingSignal
          );
        });

        const activityOnlyJobs = jobs.filter(
          (job: any) =>
            !reportableJobs.some(
              (reportable: any) =>
                reportable.navigator_job_id ===
                job.navigator_job_id
            )
        );

        const countOutcome = (
          key:
            | "estimate"
            | "contract"
            | "signed"
            | "production"
            | "invoiced"
            | "paid"
        ) =>
          reportableJobs.filter(
            (job: any) => job.outcomes[key]
          ).length;

        const engagedJobs = reportableJobs.filter(
          (job: any) =>
            job.actual_assistant.engaged
        );

        const aaWorkScheduled =
          engagedJobs.filter(
            (job: any) =>
              job.outcomes.work_scheduled
          ).length;

        const aaAfter = (
          key:
            | "buying_signal_after_engagement"
            | "estimate_after_engagement"
            | "contract_after_engagement"
            | "signed_after_engagement"
        ) =>
          engagedJobs.filter(
            (job: any) =>
              job.actual_assistant[key]
          ).length;

        const groupBy = (
          values: any[],
          getKey: (value: any) => string
        ) => {
          const map = new Map<string, any[]>();

          for (const value of values) {
            const key = getKey(value) || "Unknown";
            const existing = map.get(key) || [];
            existing.push(value);
            map.set(key, existing);
          }

          return Array.from(map.entries())
            .map(([name, groupedJobs]) => ({
              name,
              count: groupedJobs.length,
              work_scheduled:
                groupedJobs.filter(
                  (job: any) =>
                    job.outcomes.work_scheduled
                ).length,
              job_ids: groupedJobs.map(
                (job: any) =>
                  job.navigator_job_id
              )
            }))
            .sort(
              (a, b) =>
                b.count - a.count ||
                a.name.localeCompare(b.name)
            );
        };

        const insuranceJobs =
          reportableJobs.filter(
            (job: any) =>
              job.insurance.carrier ||
              [
                "alacrity",
                "hancock",
                "accuserve",
                "heritage",
                "unique"
              ].includes(
                String(
                  job.insurance.assignment_source || ""
                ).toLowerCase()
              )
          );

        const aaSourceJobs = reportableJobs.filter(
          (job: any) =>
            !insuranceJobs.includes(job) &&
            [
              "Instant Estimator",
              "Voice Intake",
              "SMS Intake",
              "Universal Outreach"
            ].includes(job.entry.channel)
        );

        const unknownSourceJobs = reportableJobs.filter(
          (job: any) =>
            !insuranceJobs.includes(job) &&
            !aaSourceJobs.includes(job)
        );

        const opportunities =
          reportableJobs.length;

        const estimates =
          countOutcome("estimate");

        const contracts =
          countOutcome("contract");

        const signed =
          countOutcome("signed");

        const production =
          countOutcome("production");

        const invoiced =
          countOutcome("invoiced");

        const paid =
          countOutcome("paid");

        return reply.send({
          ok: true,

          source:
            "contractor-navigator-business-performance-v2",

          tenant: {
            id: numberValue(tenant.id),
            slug: tenant.slug,
            name: tenant.name
          },

          generated_at:
            new Date().toISOString(),

          range,

          reporting_contract: {
            population:
              "reportable_business_opportunities_not_raw_activity_count",

            owner_activity:
              "excluded",

            acquisition:
              "who_or_what_generated_the_opportunity_when_supported_by_evidence",

            entry_channel:
              "how_the_record_entered_navigator_or_actual_assistant",

            actual_assistant:
              "durable_customer_facing_participation_and_downstream_chronology_not_causation",

            insurance:
              "assignment_source_and_carrier_preserved_independently",

            unknown:
              "preserved_when_evidence_does_not_support_classification",

            financial_interpretation:
              "not_claimed"
          },

          population: {
            raw_customer_records: jobs.length,
            reportable_opportunities:
              reportableJobs.length,
            activity_only_records:
              activityOnlyJobs.length
          },

          funnel: {
            opportunities,
            tarp_roof_conversions:
              Number(
                tarpRoofConversionResult.rows[0]?.tarp_roof_conversions || 0
              ),
            tarp_roof_conversion_job_ids:
              (
                tarpRoofConversionResult.rows[0]
                  ?.tarp_roof_conversion_job_ids || []
              ).map((id: any) => numberValue(id)),
            estimates_sent: estimates,
            estimate_rate:
              percent(estimates, opportunities),

            contracts_sent: contracts,
            contract_rate:
              percent(contracts, opportunities),

            signed,
            signed_rate:
              percent(signed, opportunities),

            production,
            invoiced,
            paid
          },

          acquisition: {
            by_source: groupBy(
              reportableJobs,
              (job) => job.acquisition.source
            ),

            by_entry_channel: groupBy(
              reportableJobs,
              (job) => job.entry.channel
            ),

            source_categories: [
              {
                name: "AA Sources",
                count: aaSourceJobs.length,
                job_ids: aaSourceJobs.map(
                  (job: any) => job.navigator_job_id
                ),
                work_scheduled:
                  aaSourceJobs.filter(
                    (job: any) =>
                      job.outcomes.work_scheduled
                  ).length
              },
              {
                name: "Insurance / Carrier / TPA Sources",
                count: insuranceJobs.length,
                job_ids: insuranceJobs.map(
                  (job: any) => job.navigator_job_id
                ),
                work_scheduled:
                  insuranceJobs.filter(
                    (job: any) =>
                      job.outcomes.work_scheduled
                  ).length
              },
              {
                name: "Unknown / Other",
                count: unknownSourceJobs.length,
                job_ids: unknownSourceJobs.map(
                  (job: any) => job.navigator_job_id
                ),
                work_scheduled:
                  unknownSourceJobs.filter(
                    (job: any) =>
                      job.outcomes.work_scheduled
                  ).length
              }
            ]
          },

          actual_assistant: {
            engaged_opportunities:
              engagedJobs.length,

            work_scheduled:
              aaWorkScheduled,

            engagement_rate:
              percent(
                engagedJobs.length,
                opportunities
              ),

            buying_signals_after_engagement:
              aaAfter(
                "buying_signal_after_engagement"
              ),

            estimates_after_engagement:
              aaAfter(
                "estimate_after_engagement"
              ),

            contracts_after_engagement:
              aaAfter(
                "contract_after_engagement"
              ),

            signed_after_engagement:
              aaAfter(
                "signed_after_engagement"
              ),

            interpretation:
              "events_occurred_at_or_after_documented_customer_facing_aa_engagement_not_causation"
          },

          insurance: {
            jobs: insuranceJobs.length,

            by_assignment_source: groupBy(
              insuranceJobs,
              (job) =>
                job.insurance.assignment_source ||
                "Unknown"
            ),

            by_carrier: groupBy(
              insuranceJobs,
              (job) =>
                job.insurance.carrier ||
                "Unknown"
            ),
            by_sales_source: groupBy(
              reportableJobs,
              (job) =>
                job.acquisition.source ||
                "Unknown"
            )
          },

          supporting_jobs: {
            reportable: reportableJobs,
            activity_only: activityOnlyJobs
          }
        });
      } catch (error: any) {
        req.log.error(
          {
            error:
              error?.message || String(error)
          },
          "business-performance-v2 failed"
        );

        return reply.code(500).send({
          ok: false,
          error:
            "business_performance_v2_failed"
        });
      }
    }
  );
}
