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
}

export default function ReportsPage() {
  const [range, setRange] = useState<Range>("30d")
  const [data, setData] =
    useState<SalesPerformanceResponse | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [showSupportingJobs, setShowSupportingJobs] =
    useState(false)

  const [selectedPipelineStage, setSelectedPipelineStage] =
    useState<StageRow | null>(null)

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


  const attribution =
    summary?.attribution?.combinations || []

  const insurance =
    summary?.insurance_performance?.rows || []

  const supportingJobs =
    summary?.supporting_jobs?.jobs || []

  const acquisitionSources = useMemo(() => {
    const grouped = new Map<string, number>()

    for (const row of attribution) {
      addGroupedCount(
        grouped,
        row.lead_source,
        Number(row.count || 0)
      )
    }

    return groupedRows(grouped)
  }, [attribution])

  const entryChannels = useMemo(() => {
    const grouped = new Map<string, number>()

    for (const row of attribution) {
      addGroupedCount(
        grouped,
        row.lead_source_detail,
        Number(row.count || 0)
      )
    }

    return groupedRows(grouped)
  }, [attribution])

  const acquisitionEvidence = useMemo(() => {
    const grouped = new Map<string, number>()

    for (const row of attribution) {
      addGroupedCount(
        grouped,
        row.marketing_campaign,
        Number(row.count || 0)
      )
    }

    return groupedRows(grouped)
  }, [attribution])

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

  const buyingSignals =
    Number(
      summary?.buying_signals
        ?.jobs_with_buying_signal || 0
    )

  const actualAssistantJobs = useMemo(() => {
    return supportingJobs.filter((job) =>
      [
        job.lead_source,
        job.lead_source_detail,
        job.marketing_campaign,
        job.job_type
      ].some((value) =>
        isActualAssistantEvidence(value)
      )
    )
  }, [supportingJobs])

  const actualAssistantByType = useMemo(() => {
    const grouped = new Map<string, number>()

    for (const job of actualAssistantJobs) {
      addGroupedCount(
        grouped,
        job.job_type,
        1
      )
    }

    return groupedRows(grouped)
  }, [actualAssistantJobs])

  const actualAssistantByStage = useMemo(() => {
    const grouped = new Map<string, number>()

    for (const job of actualAssistantJobs) {
      addGroupedCount(
        grouped,
        job.current_stage,
        1
      )
    }

    return groupedRows(grouped)
  }, [actualAssistantJobs])





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
              title="Where Did Our Business Come From?"
              subtitle={
                range === "all"
                  ? "All available Navigator business attribution. Acquisition source, entry channel, and acquisition evidence remain separate dimensions."
                  : `Navigator business attribution for work created ${rangeLabel(range).toLowerCase()}.`
              }
            />

            <div style={threeColumnGrid}>
              <div style={compactBreakdown}>
                <strong>Acquisition Source</strong>
                <p style={smallMuted}>
                  Who or what originated the business relationship.
                </p>
                <SimpleRows
                  rows={acquisitionSources}
                  empty="No acquisition-source evidence recorded for this period."
                />
              </div>

              <div style={compactBreakdown}>
                <strong>Entry Channel</strong>
                <p style={smallMuted}>
                  How the opportunity entered Navigator.
                </p>
                <SimpleRows
                  rows={entryChannels}
                  empty="No entry-channel evidence recorded for this period."
                />
              </div>

              <div style={compactBreakdown}>
                <strong>Acquisition Evidence</strong>
                <p style={smallMuted}>
                  Recorded campaign or other acquisition detail where available.
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
              title="Insurance / Assignment Performance"
              subtitle="Carrier is the primary management view. TPA/source detail, job type, and current stage remain separate operational dimensions."
            />

            {insuranceByCarrier.length === 0 ? (
              <p style={muted}>
                No insurance-attributed work recorded for this period.
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
                      <strong style={number}>
                        {row.count}
                      </strong>
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
            <SectionHeading
              title="Actual Assistant Performance"
              subtitle="Navigator-native evidence only. This view does not infer causation, conversion, or financial performance."
            />

            <div style={aaMetricRow}>
              <div style={compactMetric}>
                <span style={smallMuted}>
                  Explicitly attributed work
                </span>
                <strong style={compactMetricValue}>
                  {actualAssistantJobs.length}
                </strong>
                <span style={smallMuted}>
                  Jobs containing explicit Actual Assistant attribution evidence
                </span>
              </div>

              <div style={compactMetric}>
                <span style={smallMuted}>
                  Buying Signals
                </span>
                <strong style={compactMetricValue}>
                  {buyingSignals}
                </strong>
                <span style={smallMuted}>
                  Jobs with at least one durable Navigator buying signal
                </span>
              </div>

              <div style={compactBreakdown}>
                <strong>Attributed Work Type</strong>
                <SimpleRows
                  rows={actualAssistantByType}
                  empty="No explicitly attributed AA work types."
                />
              </div>

              <div style={compactBreakdown}>
                <strong>Current Stage of Attributed Work</strong>
                <SimpleRows
                  rows={actualAssistantByStage}
                  empty="No explicitly attributed AA stages."
                />
              </div>
            </div>

            <div style={evidenceNote}>
              <strong>Conversion evidence boundary</strong>
              <p style={{ ...muted, marginBottom: 0 }}>
                Estimates, contracts, and signed contracts occurring after
                documented Actual Assistant engagement are not displayed here
                unless Navigator provides authoritative event evidence tying
                those events to the documented engagement. Current stage alone
                is not treated as proof of that sequence.
              </p>
            </div>
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
                      selectedPipelineStage
                        ? selectedPipelineStage.jobs?.length || 0
                        : supportingJobs.length
                    })`}
              </button>
            </div>

            {showSupportingJobs && (
              <>
                {selectedPipelineStage && (
                  <div style={{ marginBottom: 14 }}>
                    <strong>
                      {humanize(
                        selectedPipelineStage.stage
                      )}
                    </strong>

                    <span style={muted}>
                      {" "}— supporting Navigator jobs
                    </span>

                    <button
                      type="button"
                      style={{
                        ...button,
                        marginLeft: 12
                      }}
                      onClick={() =>
                        setSelectedPipelineStage(null)
                      }
                    >
                      Show All
                    </button>
                  </div>
                )}

                {(selectedPipelineStage
                  ? selectedPipelineStage.jobs || []
                  : supportingJobs
                ).length === 0 ? (
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

                      {(selectedPipelineStage
                        ? selectedPipelineStage.jobs || []
                        : supportingJobs
                      ).map((job) => (
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

function isActualAssistantEvidence(value: unknown) {
  const normalized = cleanValue(value).toLowerCase()

  return (
    normalized === "actual assistant" ||
    normalized === "actual_assistant" ||
    normalized === "actual-assistant" ||
    normalized === "voice_intake" ||
    normalized === "twilio_voice_intake" ||
    normalized.includes("actual assistant")
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

const evidenceNote = {
  marginTop: "18px",
  padding: "14px 16px",
  borderRadius: "14px",
  border:
    "1px solid rgba(148, 163, 184, 0.18)",
  background: "rgba(30, 41, 59, 0.45)"
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
