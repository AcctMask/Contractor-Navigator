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

type OutcomeRow = CountRow & {
  current_stage: string
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
    attribution?: {
      population?: string
      dimensions_preserved_independently?: string[]
      combinations?: AttributionRow[]
    }
    period_outcomes?: {
      population?: string
      interpretation?: string
      by_current_stage?: OutcomeRow[]
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
}

export default function ReportsPage() {
  const [range, setRange] = useState<Range>("30d")
  const [data, setData] =
    useState<SalesPerformanceResponse | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

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

  const created =
    Number(summary?.created_during_period?.count || 0)

  const pipeline =
    summary?.current_pipeline?.by_stage || []

  const workMix =
    summary?.work_mix?.by_job_type || []

  const attribution =
    summary?.attribution?.combinations || []

  const outcomes =
    summary?.period_outcomes?.by_current_stage || []

  const insurance =
    summary?.insurance_performance?.rows || []

  const supportingJobs =
    summary?.supporting_jobs?.jobs || []

  const aging =
    summary?.current_stage_aging?.jobs || []

  const activePipelineTotal = useMemo(
    () =>
      pipeline.reduce(
        (sum, row) => sum + Number(row.count || 0),
        0
      ),
    [pipeline]
  )

  const sourceSummary = useMemo(() => {
    const grouped = new Map<
      string,
      {
        source: string
        count: number
        details: Set<string>
      }
    >()

    for (const row of attribution) {
      const source =
        cleanValue(row.lead_source) || "Unknown"

      const current =
        grouped.get(source) || {
          source,
          count: 0,
          details: new Set<string>()
        }

      current.count += Number(row.count || 0)

      const detail =
        cleanValue(row.lead_source_detail)

      if (detail && detail.toLowerCase() !== "unknown") {
        current.details.add(detail)
      }

      grouped.set(source, current)
    }

    return Array.from(grouped.values())
      .map((row) => ({
        source: row.source,
        count: row.count,
        details: Array.from(row.details)
      }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.source.localeCompare(b.source)
      )
  }, [attribution])

  return (
    <div style={page}>
      <div style={headingRow}>
        <div>
          <h1 style={{ marginBottom: 6 }}>
            How&apos;s Business?
          </h1>
          <p style={muted}>
            Navigator operational performance — work coming in,
            what kind it is, where it came from, where it sits now,
            and what may deserve attention.
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
          <div style={metricGrid}>
            <MetricCard
              label={
                range === "all"
                  ? "Recorded Business Work"
                  : "New Work"
              }
              value={created}
              detail={
                range === "all"
                  ? "All available legitimate business-population records"
                  : `Created ${rangeLabel(range).toLowerCase()}`
              }
            />

            <MetricCard
              label="Current Pipeline"
              value={activePipelineTotal}
              detail="Current snapshot — not work that entered a stage during this period"
            />

            <MetricCard
              label="Work Types"
              value={
                workMix.filter(
                  (row) => Number(row.count || 0) > 0
                ).length
              }
              detail="Distinct recorded job types in the selected population"
            />

            <MetricCard
              label="Needs Attention"
              value={aging.length}
              detail="Jobs with authoritative Stage Since data; age alone does not mean a bottleneck"
            />
          </div>

          <div style={twoColumnGrid}>
            <section style={card}>
              <SectionHeading
                title="What Work Came In?"
                subtitle={
                  range === "all"
                    ? "All available recorded business work by job type."
                    : `Jobs created ${rangeLabel(range).toLowerCase()}, grouped by job type.`
                }
              />

              <SimpleRows
                rows={workMix.map((row) => ({
                  label: humanize(row.job_type),
                  value: Number(row.count || 0)
                }))}
                empty="No recorded work for this period."
              />
            </section>

            <section style={card}>
              <SectionHeading
                title="Where Is The Work Now?"
                subtitle="Current pipeline snapshot. These are current stages, not stage entries during the selected period."
              />

              <SimpleRows
                rows={pipeline.map((row) => ({
                  label: humanize(row.stage),
                  value: Number(row.count || 0)
                }))}
                empty="No current pipeline data."
              />
            </section>
          </div>

          <section style={card}>
            <SectionHeading
              title="Who Is Sending The Work?"
              subtitle="Lead source remains distinct from source detail, campaign, and carrier."
            />

            {sourceSummary.length === 0 ? (
              <p style={muted}>No attribution data yet.</p>
            ) : (
              <div>
                {sourceSummary.map((row) => (
                  <div
                    key={row.source}
                    style={sourceRow}
                  >
                    <div>
                      <strong>
                        {humanize(row.source)}
                      </strong>

                      {row.details.length > 0 && (
                        <div style={smallMuted}>
                          {row.details
                            .map(humanize)
                            .join(" • ")}
                        </div>
                      )}
                    </div>

                    <strong style={number}>
                      {row.count}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div style={twoColumnGrid}>
            <section style={card}>
              <SectionHeading
                title="What Became Of The Work?"
                subtitle="Current outcome snapshot for work in the selected population. This does not claim when a stage transition occurred."
              />

              <SimpleRows
                rows={outcomes.map((row) => ({
                  label: humanize(row.current_stage),
                  value: Number(row.count || 0)
                }))}
                empty="No outcome data for this period."
              />
            </section>

            <section style={card}>
              <SectionHeading
                title="Insurance / Assignment Performance"
                subtitle="Carrier, TPA/source detail, job type, and current stage remain separate dimensions."
              />

              {insurance.length === 0 ? (
                <p style={muted}>
                  No insurance-attributed work recorded for this period.
                </p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <div style={insuranceTable}>
                    <strong>Carrier</strong>
                    <strong>TPA / Source</strong>
                    <strong>Job Type</strong>
                    <strong>Stage</strong>
                    <strong style={number}>Count</strong>

                    {insurance.map((row, index) => (
                      <div
                        key={[
                          row.carrier,
                          row.tpa_or_source_detail,
                          row.job_type,
                          row.current_stage,
                          index
                        ].join("|")}
                        style={{ display: "contents" }}
                      >
                        <span>{humanize(row.carrier)}</span>
                        <span>{humanize(row.tpa_or_source_detail)}</span>
                        <span>{humanize(row.job_type)}</span>
                        <span>{humanize(row.current_stage)}</span>
                        <strong style={number}>
                          {Number(row.count || 0)}
                        </strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>

          <section style={card}>
            <SectionHeading
              title="Stage Age / Attention"
              subtitle="Uses Navigator's authoritative current Stage Since timestamp. Longer age is a review signal, not automatically a bottleneck."
            />

            {aging.length === 0 ? (
              <p style={muted}>
                No jobs currently have authoritative Stage Since
                data available for this view.
              </p>
            ) : (
              <div style={agingTable}>
                <div style={agingHeader}>
                  <strong>Job</strong>
                  <strong>Stage</strong>
                  <strong>Type</strong>
                  <strong>Source</strong>
                  <strong style={number}>
                    Days
                  </strong>
                </div>

                {aging.map((job) => (
                  <div
                    key={job.navigator_job_id}
                    style={agingRow}
                  >
                    <div>
                      <a
                        href={`/job/${job.navigator_job_id}`}
                        style={jobLink}
                      >
                        {job.job_label}
                      </a>
                      <div style={smallMuted}>
                        Job #{job.navigator_job_id}
                      </div>
                    </div>

                    <span>
                      {humanize(job.current_stage)}
                    </span>

                    <span>
                      {humanizeNullable(job.job_type)}
                    </span>

                    <span>
                      {humanizeNullable(
                        job.lead_source_detail ||
                          job.lead_source
                      )}
                    </span>

                    <strong style={number}>
                      {job.days_in_current_stage ??
                        "Unknown"}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={card}>
            <SectionHeading
              title="Supporting Jobs"
              subtitle="The underlying Navigator jobs for the selected period. Open any job for full operational detail."
            />

            {supportingJobs.length === 0 ? (
              <p style={muted}>No supporting jobs for this period.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <div style={supportingJobsTable}>
                  <strong>Job</strong>
                  <strong>Type</strong>
                  <strong>Source / TPA</strong>
                  <strong>Carrier</strong>
                  <strong>Stage</strong>
                  <strong style={number}>Days</strong>

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
                      <span>{humanizeNullable(job.job_type)}</span>
                      <span>
                        {humanizeNullable(
                          job.lead_source_detail ||
                            job.lead_source
                        )}
                      </span>
                      <span>{humanizeNullable(job.carrier)}</span>
                      <span>{humanize(job.current_stage)}</span>
                      <strong style={number}>
                        {job.days_in_current_stage ?? "Unknown"}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
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

function MetricCard({
  label,
  value,
  detail
}: {
  label: string
  value: number
  detail: string
}) {
  return (
    <section style={metricCard}>
      <div style={metricLabel}>{label}</div>
      <div style={metricValue}>{value}</div>
      <div style={smallMuted}>{detail}</div>
    </section>
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
  empty
}: {
  rows: Array<{
    label: string
    value: number
  }>
  empty: string
}) {
  const visible = rows
    .filter((row) => row.value > 0)
    .sort(
      (a, b) =>
        b.value - a.value ||
        a.label.localeCompare(b.label)
    )

  if (visible.length === 0) {
    return <p style={muted}>{empty}</p>
  }

  return (
    <div>
      {visible.map((row) => (
        <div key={row.label} style={simpleRow}>
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

const metricGrid = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(210px, 1fr))",
  gap: "14px",
  marginBottom: "18px"
} as const

const twoColumnGrid = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(360px, 1fr))",
  gap: "18px",
  marginBottom: "18px"
} as const

const card = {
  background: "rgba(15, 23, 42, 0.92)",
  border:
    "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: "18px",
  padding: "20px",
  marginBottom: "18px"
} as const

const metricCard = {
  ...card,
  marginBottom: 0,
  minHeight: "120px"
} as const

const metricLabel = {
  opacity: 0.76,
  fontSize: "14px",
  fontWeight: 700
} as const

const metricValue = {
  fontSize: "36px",
  lineHeight: 1.1,
  fontWeight: 800,
  margin: "8px 0"
} as const

const insuranceTable = {
  display: "grid",
  gridTemplateColumns:
    "minmax(140px, 1.2fr) minmax(140px, 1.2fr) minmax(130px, 1fr) minmax(120px, 1fr) 70px",
  gap: "10px 16px",
  alignItems: "center",
  minWidth: "760px"
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

const sourceRow = {
  display: "flex",
  justifyContent: "space-between",
  gap: "18px",
  alignItems: "flex-start",
  padding: "12px 0",
  borderBottom:
    "1px solid rgba(148, 163, 184, 0.16)"
} as const

const agingTable = {
  overflowX: "auto"
} as const

const agingHeader = {
  display: "grid",
  gridTemplateColumns:
    "minmax(180px, 1.5fr) minmax(130px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr) 70px",
  gap: "14px",
  minWidth: "800px",
  padding: "10px 0",
  opacity: 0.72,
  fontSize: "13px",
  borderBottom:
    "1px solid rgba(148, 163, 184, 0.28)"
} as const

const agingRow = {
  display: "grid",
  gridTemplateColumns:
    "minmax(180px, 1.5fr) minmax(130px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr) 70px",
  gap: "14px",
  minWidth: "800px",
  padding: "12px 0",
  alignItems: "start",
  borderBottom:
    "1px solid rgba(148, 163, 184, 0.16)"
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
