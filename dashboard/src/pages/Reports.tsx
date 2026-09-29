import { useEffect, useMemo, useState } from "react"
import { getTenantSlug } from "../lib/tenant"

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://contractor-navigator.onrender.com"

type Range = "7d" | "30d" | "all"

type CountRow = {
  count: number
}

type StageRow = CountRow & {
  stage: string
  jobs?: SupportingJob[]
}

type JobTypeRow = CountRow & {
  job_type: string
}

type AttributionRow = CountRow & {
  lead_source: string
  lead_source_detail: string
  marketing_campaign: string
  carrier: string
}

type OpportunityJourneyRow = CountRow & {
  acquisition_source: string
  acquisition_evidence: string
  entry_channel: string
  marketing_campaign: string
  aa_engaged: boolean
}

type ActualAssistantPerformance = {
  documented_engagement_jobs?: number
  jobs_with_documented_engagement?: number
  opportunities_with_documented_engagement?: number
  engaged_opportunities?: number

  buying_signals_after_engagement?: number
  jobs_with_buying_signal_after_engagement?: number

  estimates_sent_after_engagement?: number
  contracts_sent_after_engagement?: number
  contracts_signed_after_engagement?: number
  signed_package_received_after_engagement?: number
}

type Funnel = {
  opportunities?: number
  estimates_sent?: number
  estimate_rate?: number
  contracts_sent?: number
  contract_rate?: number
  signed_package_received?: number
  package_received_rate?: number
}

type InsurancePerformanceRow = CountRow & {
  carrier: string
  tpa_or_source_detail: string
  job_type: string
  current_stage: string
}

type SupportingJob = {
  navigator_job_id: number
  job_label: string
  created_at: string
  current_stage: string
  job_type: string | null
  lead_source: string | null
  lead_source_detail: string | null
  marketing_campaign: string | null
  carrier: string | null
  current_stage_entered_at: string | null
  days_in_current_stage: number | null
}

type AgingJob = {
  navigator_job_id: number
  job_label: string
  current_stage: string
  current_stage_entered_at: string | null
  days_in_current_stage: number | null
  job_type: string | null
  lead_source: string | null
  lead_source_detail: string | null
  marketing_campaign: string | null
  carrier: string | null
}

type SalesPerformanceResponse = {
  ok?: boolean
  error?: string
  operational_summary?: {
    semantics?: {
      selected_range?: string
      selected_period_population?: string
      current_pipeline?: string
      current_stage_aging?: string
      unknown_stage_since?: string
      historical_cycle_time?: string
      financial_interpretation?: string
    }
    created_during_period?: {
      count?: number
    }
    current_pipeline?: {
      by_stage?: StageRow[]
    }
    work_mix?: {
      population?: string
      by_job_type?: JobTypeRow[]
    }
    opportunity_journey?: {
      population?: string
      semantics?: {
        acquisition_source?: string
        acquisition_evidence?: string
        entry_channel?: string
        aa_engaged?: string
        unknown?: string
      }
      dimensions_preserved_independently?: string[]
      rows?: OpportunityJourneyRow[]
    }
    attribution?: {
      population?: string
      dimensions_preserved_independently?: string[]
      combinations?: AttributionRow[]
    }
    actual_assistant_performance?: ActualAssistantPerformance
    buying_signals?: {
      authority?: string
      population?: string
      interpretation?: string
      jobs_with_buying_signal?: number
    }
    insurance_performance?: {
      population?: string
      dimensions_preserved_independently?: string[]
      tpa_semantics?: string
      rows?: InsurancePerformanceRow[]
    }
    supporting_jobs?: {
      population?: string
      drill_down?: string
      jobs?: SupportingJob[]
    }
    current_stage_aging?: {
      authority?: string
      interpretation?: string
      jobs?: AgingJob[]
    }
  }
  funnel?: Funnel
}

export default function ReportsPage() {
  const [range, setRange] = useState<Range>("30d")
  const [data, setData] =
    useState<SalesPerformanceResponse | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [showSupportingJobs, setShowSupportingJobs] =
    useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError("")

      try {
        const url =
          `${API_BASE}/reporting/sales-performance.json` +
          `?tenant=${encodeURIComponent(getTenantSlug())}` +
          `&range=${encodeURIComponent(range)}`

        const response = await fetch(url)
        const json =
          (await response.json()) as SalesPerformanceResponse

        if (!response.ok || json.ok === false) {
          throw new Error(
            json.error || "Failed to load business performance"
          )
        }

        if (!cancelled) {
          setData(json)
        }
      } catch (err) {
        if (!cancelled) {
          setData(null)
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load business performance"
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [range])

  const summary = data?.operational_summary


  const opportunityJourney =
    summary?.opportunity_journey?.rows || []

  const insurance =
    summary?.insurance_performance?.rows || []

  const supportingJobs =
    summary?.supporting_jobs?.jobs || []

  const funnel = data?.funnel || {}

  const aa =
    summary?.actual_assistant_performance || {}

  const acquisitionSources = useMemo(() => {
    const grouped = new Map<string, number>()

    for (const row of opportunityJourney) {
      addGroupedCount(
        grouped,
        row.acquisition_source,
        Number(row.count || 0)
      )
    }

    return groupedRows(grouped)
  }, [opportunityJourney])

  const entryChannels = useMemo(() => {
    const grouped = new Map<string, number>()

    for (const row of opportunityJourney) {
      addGroupedCount(
        grouped,
        row.entry_channel,
        Number(row.count || 0)
      )
    }

    return groupedRows(grouped)
  }, [opportunityJourney])

  const acquisitionEvidence = useMemo(() => {
    const grouped = new Map<string, number>()

    for (const row of opportunityJourney) {
      addGroupedCount(
        grouped,
        row.acquisition_evidence,
        Number(row.count || 0)
      )
    }

    return groupedRows(grouped)
  }, [opportunityJourney])

  const aaEngagedFromJourney = useMemo(() => {
    return opportunityJourney.reduce(
      (total, row) =>
        total +
        (row.aa_engaged ? Number(row.count || 0) : 0),
      0
    )
  }, [opportunityJourney])

  const insuranceByCarrier = useMemo(() => {
    const grouped = new Map<
      string,
      {
        carrier: string
        count: number
        tpas: Map<string, number>
        jobTypes: Map<string, number>
        stages: Map<string, number>
      }
    >()

    for (const row of insurance) {
      const rawCarrier =
        cleanValue(row.carrier) || "Unknown"
      const key = rawCarrier.toLowerCase()

      const current =
        grouped.get(key) || {
          carrier: canonicalDisplayValue(rawCarrier),
          count: 0,
          tpas: new Map<string, number>(),
          jobTypes: new Map<string, number>(),
          stages: new Map<string, number>()
        }

      const count = Number(row.count || 0)
      current.count += count

      addGroupedCount(
        current.tpas,
        row.tpa_or_source_detail,
        count
      )

      addGroupedCount(
        current.jobTypes,
        row.job_type,
        count
      )

      addGroupedCount(
        current.stages,
        row.current_stage,
        count
      )

      grouped.set(key, current)
    }

    return Array.from(grouped.values()).sort(
      (a, b) =>
        b.count - a.count ||
        a.carrier.localeCompare(b.carrier)
    )
  }, [insurance])

  const aaEngaged =
    Number(
      aa.documented_engagement_jobs ??
      aa.jobs_with_documented_engagement ??
      aa.opportunities_with_documented_engagement ??
      aa.engaged_opportunities ??
      aaEngagedFromJourney ??
      0
    )

  const aaBuyingSignals =
    Number(
      aa.buying_signals_after_engagement ??
      aa.jobs_with_buying_signal_after_engagement ??
      0
    )

  const aaEstimates =
    Number(aa.estimates_sent_after_engagement ?? 0)

  const aaContracts =
    Number(aa.contracts_sent_after_engagement ?? 0)

  const aaSigned =
    Number(
      aa.contracts_signed_after_engagement ??
      aa.signed_package_received_after_engagement ??
      0
    )

  return (
    <div style={page}>
      <div style={headingRow}>
        <div>
          <h1 style={{ marginBottom: 6 }}>
            How&apos;s Business?
          </h1>
          <p style={muted}>
            Business acquisition and performance evidence from
            Navigator — where business came from, documented engagement,
            insurance assignment performance, and the supporting records
            behind the report.
          </p>
        </div>
      </div>

      <div style={buttonRow}>
        {(["7d", "30d", "all"] as Range[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRange(value)}
            style={
              range === value
                ? activeButton
                : button
            }
          >
            {rangeLabel(value)}
          </button>
        ))}
      </div>

      {loading && (
        <section style={card}>
          <p style={muted}>
            Loading business performance…
          </p>
        </section>
      )}

      {error && (
        <section style={errorCard}>
          <strong>Reports could not load.</strong>
          <div style={{ marginTop: 8 }}>{error}</div>
        </section>
      )}

      {!loading && !error && summary && (
        <>
          <section style={card}>
            <SectionHeading
              title="Business Funnel"
              subtitle={
                range === "all"
                  ? "All available Navigator opportunity and conversion evidence."
                  : `Navigator opportunity and conversion evidence for work created ${rangeLabel(range).toLowerCase()}.`
              }
            />

            <div style={aaMetricRow}>
              <div style={compactMetric}>
                <span style={smallMuted}>Opportunities</span>
                <strong style={compactMetricValue}>
                  {Number(funnel.opportunities || 0)}
                </strong>
              </div>

              <div style={compactMetric}>
                <span style={smallMuted}>Estimates Sent</span>
                <strong style={compactMetricValue}>
                  {Number(funnel.estimates_sent || 0)}
                </strong>
                <span style={smallMuted}>
                  {Number(funnel.estimate_rate || 0)}% of opportunities
                </span>
              </div>

              <div style={compactMetric}>
                <span style={smallMuted}>Contracts Sent</span>
                <strong style={compactMetricValue}>
                  {Number(funnel.contracts_sent || 0)}
                </strong>
                <span style={smallMuted}>
                  {Number(funnel.contract_rate || 0)}% of opportunities
                </span>
              </div>

              <div style={compactMetric}>
                <span style={smallMuted}>Signed Contracts</span>
                <strong style={compactMetricValue}>
                  {Number(funnel.signed_package_received || 0)}
                </strong>
                <span style={smallMuted}>
                  {Number(funnel.package_received_rate || 0)}% of opportunities
                </span>
              </div>
            </div>
          </section>

          <section style={card}>
            <SectionHeading
              title="Where Did Our Business Come From?"
              subtitle={
                range === "all"
                  ? "All available Navigator acquisition evidence. Source, entry channel, and evidence remain independent."
                  : `Navigator acquisition evidence for work created ${rangeLabel(range).toLowerCase()}.`
              }
            />

            <div style={threeColumnGrid}>
              <div style={compactBreakdown}>
                <strong>Acquisition Source</strong>
                <p style={smallMuted}>
                  Who or what generated the opportunity when supported by evidence.
                </p>
                <SimpleRows
                  rows={acquisitionSources}
                  empty="No acquisition-source evidence recorded for this period."
                />
              </div>

              <div style={compactBreakdown}>
                <strong>Entry Channel</strong>
                <p style={smallMuted}>
                  How the opportunity entered Navigator or Actual Assistant.
                </p>
                <SimpleRows
                  rows={entryChannels}
                  empty="No entry-channel evidence recorded for this period."
                />
              </div>

              <div style={compactBreakdown}>
                <strong>Acquisition Evidence</strong>
                <p style={smallMuted}>
                  Evidence supporting the acquisition source, including estimator or outreach evidence where recorded.
                </p>
                <SimpleRows
                  rows={acquisitionEvidence}
                  empty="No additional acquisition evidence recorded for this period."
                />
              </div>
            </div>
          </section>

          <section style={card}>
            <SectionHeading
              title="Actual Assistant Performance"
              subtitle="Documented Navigator chronology. Events occurring after AA engagement are shown as chronology, not claimed causation."
            />

            <div style={aaMetricRow}>
              <div style={compactMetric}>
                <span style={smallMuted}>AA-Engaged Opportunities</span>
                <strong style={compactMetricValue}>{aaEngaged}</strong>
              </div>

              <div style={compactMetric}>
                <span style={smallMuted}>Buying Signals After AA Engagement</span>
                <strong style={compactMetricValue}>{aaBuyingSignals}</strong>
              </div>

              <div style={compactMetric}>
                <span style={smallMuted}>Estimates After AA Engagement</span>
                <strong style={compactMetricValue}>{aaEstimates}</strong>
              </div>

              <div style={compactMetric}>
                <span style={smallMuted}>Contracts After AA Engagement</span>
                <strong style={compactMetricValue}>{aaContracts}</strong>
              </div>

              <div style={compactMetric}>
                <span style={smallMuted}>Signed After AA Engagement</span>
                <strong style={compactMetricValue}>{aaSigned}</strong>
              </div>
            </div>
          </section>

          <section style={card}>
            <SectionHeading
              title="Insurance / Assignment Performance"
              subtitle="Carrier is the primary management view. TPA/source, job type, and current stage remain independent dimensions."
            />

            {insuranceByCarrier.length === 0 ? (
              <p style={muted}>
                No insurance / assignment evidence recorded for this period.
              </p>
            ) : (
              <div style={carrierGrid}>
                {insuranceByCarrier.map((row) => (
                  <div
                    key={row.carrier.toLowerCase()}
                    style={carrierCard}
                  >
                    <div style={carrierHeading}>
                      <strong>{row.carrier}</strong>
                      <strong style={number}>{row.count}</strong>
                    </div>

                    <Breakdown
                      label="TPA / Source"
                      values={row.tpas}
                    />

                    <Breakdown
                      label="Job Type"
                      values={row.jobTypes}
                    />

                    <Breakdown
                      label="Current Stage"
                      values={row.stages}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={card}>
            <div style={supportingJobsHeading}>
              <SectionHeading
                title="Supporting Jobs"
                subtitle="Open the underlying Navigator records only when you need to inspect the detail behind this report."
              />

              <button
                type="button"
                onClick={() =>
                  setShowSupportingJobs(
                    (current) => !current
                  )
                }
                style={button}
              >
                {showSupportingJobs
                  ? "Hide Supporting Jobs"
                  : `View Supporting Jobs (${
                      supportingJobs.length
                    })`}
              </button>
            </div>

            {showSupportingJobs && (
              <>
                {supportingJobs.length === 0 ? (
                  <p style={muted}>
                    No supporting jobs for this period.
                  </p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <div style={supportingJobsTable}>
                      <strong>Job</strong>
                      <strong>Type</strong>
                      <strong>Source / TPA</strong>
                      <strong>Carrier</strong>
                      <strong>Stage</strong>
                      <strong style={number}>
                        Days
                      </strong>

                      {supportingJobs.map((job) => (
                        <div
                          key={job.navigator_job_id}
                          style={{ display: "contents" }}
                        >
                          <a
                            href={`/job/${job.navigator_job_id}`}
                            style={jobLink}
                          >
                            {job.job_label}
                          </a>

                          <span>
                            {humanizeNullable(job.job_type)}
                          </span>

                          <span>
                            {humanizeNullable(
                              job.lead_source_detail ||
                                job.lead_source
                            )}
                          </span>

                          <span>
                            {humanizeNullable(job.carrier)}
                          </span>

                          <span>
                            {humanize(job.current_stage)}
                          </span>

                          <strong style={number}>
                            {job.days_in_current_stage ??
                              "Unknown"}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <section style={noteCard}>
            <strong>Reporting boundary</strong>
            <p style={{ ...muted, marginBottom: 0 }}>
              Navigator reports operational truth here.
              Financial results and profitability remain Financial
              Operations authority. Historical cycle time is not
              claimed where authoritative transition history does
              not exist.
            </p>
          </section>
        </>
      )}
    </div>
  )
}

function SectionHeading({
  title,
  subtitle
}: {
  title: string
  subtitle: string
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      <p style={{ ...muted, marginBottom: 0 }}>
        {subtitle}
      </p>
    </div>
  )
}

function SimpleRows({
  rows,
  empty,
  preserveOrder = false
}: {
  rows: Array<{
    label: string
    value: number
    onClick?: () => void
  }>
  empty: string
  preserveOrder?: boolean
}) {
  const visible = rows
    .filter((row) => row.value > 0)

  if (!preserveOrder) {
    visible.sort(
      (a, b) =>
        b.value - a.value ||
        a.label.localeCompare(b.label)
    )
  }

  if (visible.length === 0) {
    return <p style={muted}>{empty}</p>
  }

  return (
    <div>
      {visible.map((row) => (
        <div
          key={row.label}
          style={{
            ...simpleRow,
            ...(row.onClick
              ? { cursor: "pointer" }
              : {})
          }}
          role={row.onClick ? "button" : undefined}
          tabIndex={row.onClick ? 0 : undefined}
          onClick={row.onClick}
          onKeyDown={
            row.onClick
              ? (event) => {
                  if (
                    event.key === "Enter" ||
                    event.key === " "
                  ) {
                    event.preventDefault()
                    row.onClick?.()
                  }
                }
              : undefined
          }
        >
          <span
            style={
              row.onClick
                ? { textDecoration: "underline" }
                : undefined
            }
          >
            {row.label}
          </span>

          <strong style={number}>
            {row.value}
          </strong>
        </div>
      ))}
    </div>
  )
}

function canonicalDisplayValue(value: unknown) {
  const cleaned = cleanValue(value) || "Unknown"
  const key = cleaned.toLowerCase()

  if (key === "tarp") return "Tarp"
  if (key === "estimator") return "Estimator"
  if (key === "voice_intake") return "Voice Intake"

  return humanize(cleaned)
}

function addGroupedCount(
  map: Map<string, number>,
  value: unknown,
  count: number
) {
  const raw = cleanValue(value) || "Unknown"
  const key = raw.toLowerCase()

  map.set(
    key,
    (map.get(key) || 0) + count
  )
}

function groupedRows(map: Map<string, number>) {
  return Array.from(map.entries())
    .map(([key, value]) => ({
      label: canonicalDisplayValue(key),
      value
    }))
    .sort(
      (a, b) =>
        b.value - a.value ||
        a.label.localeCompare(b.label)
    )
}


function Breakdown({
  label,
  values
}: {
  label: string
  values: Map<string, number>
}) {
  const rows = groupedRows(values)

  return (
    <div style={breakdownBlock}>
      <div style={breakdownLabel}>{label}</div>

      {rows.map((row) => (
        <div
          key={`${label}-${row.label}`}
          style={breakdownRow}
        >
          <span>{row.label}</span>
          <strong style={number}>
            {row.value}
          </strong>
        </div>
      ))}
    </div>
  )
}

function rangeLabel(range: Range) {
  if (range === "7d") return "Last 7 Days"
  if (range === "30d") return "Last 30 Days"
  return "All Time"
}

function cleanValue(value: unknown) {
  return String(value || "").trim()
}

function humanizeNullable(value: unknown) {
  const cleaned = cleanValue(value)

  if (!cleaned || cleaned.toLowerCase() === "unknown") {
    return "Unknown"
  }

  return humanize(cleaned)
}

function humanize(value: unknown) {
  const cleaned =
    cleanValue(value) || "Unknown"

  return cleaned
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    )
}

const page = {
  maxWidth: "1280px",
  margin: "0 auto",
  color: "white",
  padding: "24px"
} as const

const headingRow = {
  display: "flex",
  justifyContent: "space-between",
  gap: "20px",
  alignItems: "flex-start"
} as const

const buttonRow = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  margin: "20px 0"
} as const

const button = {
  padding: "10px 14px",
  borderRadius: "12px",
  border:
    "1px solid rgba(148, 163, 184, 0.25)",
  background: "rgba(30, 41, 59, 0.9)",
  color: "white",
  cursor: "pointer"
} as const

const activeButton = {
  ...button,
  background: "#3b82f6"
} as const

const threeColumnGrid = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "18px"
} as const


const card = {
  background: "rgba(15, 23, 42, 0.92)",
  border:
    "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: "18px",
  padding: "20px",
  marginBottom: "18px"
} as const

const supportingJobsTable = {
  display: "grid",
  gridTemplateColumns:
    "minmax(180px, 1.5fr) minmax(130px, 1fr) minmax(150px, 1.2fr) minmax(130px, 1fr) minmax(120px, 1fr) 70px",
  gap: "10px 16px",
  alignItems: "center",
  minWidth: "900px"
} as const

const jobLink = {
  color: "#a9cbff",
  fontWeight: 700,
  textDecoration: "none"
} as const

const simpleRow = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  padding: "10px 0",
  borderBottom:
    "1px solid rgba(148, 163, 184, 0.16)"
} as const

const carrierGrid = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "14px"
} as const

const carrierCard = {
  background: "rgba(30, 41, 59, 0.58)",
  border:
    "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: "14px",
  padding: "16px"
} as const

const carrierHeading = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  fontSize: "17px",
  marginBottom: "12px"
} as const

const breakdownBlock = {
  marginTop: "12px"
} as const

const breakdownLabel = {
  opacity: 0.65,
  fontSize: "12px",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: "5px"
} as const

const breakdownRow = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  padding: "4px 0",
  fontSize: "13px"
} as const

const aaMetricRow = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "18px",
  alignItems: "start"
} as const

const compactMetric = {
  display: "flex",
  flexDirection: "column",
  gap: "6px"
} as const

const compactMetricValue = {
  fontSize: "34px",
  lineHeight: 1,
  fontWeight: 800
} as const

const compactBreakdown = {
  minWidth: 0
} as const

const supportingJobsHeading = {
  display: "flex",
  justifyContent: "space-between",
  gap: "18px",
  alignItems: "flex-start",
  flexWrap: "wrap"
} as const

const noteCard = {
  ...card,
  background: "rgba(30, 41, 59, 0.65)"
} as const

const errorCard = {
  ...card,
  color: "#fecaca",
  border:
    "1px solid rgba(248, 113, 113, 0.4)"
} as const

const muted = {
  opacity: 0.74
} as const

const smallMuted = {
  opacity: 0.66,
  fontSize: "13px",
  marginTop: "4px"
} as const

const number = {
  textAlign: "right"
} as const
