import { useEffect, useState } from "react"
import { useCompanyDna } from "../context/CompanyDnaContext"
import { getTenantSlug } from "../lib/tenant"

const API_BASE = import.meta.env.VITE_API_BASE || "https://contractor-navigator.onrender.com"
type ReportRow = {
  label: string
  count: number
}

type SourceTypeRow = {
  source: string
  current_stage: string
  job_type: string
  count: number
}

type ReportData = {
  ok: boolean
  range: string
  by_source: ReportRow[]
  by_job_type: ReportRow[]
  by_source_type: SourceTypeRow[]
  by_stage: ReportRow[]
}

export default function ReportsPage() {
  const { workspace } = useCompanyDna()
  const [range, setRange] = useState("30d")
  const [data, setData] = useState<ReportData | null>(null)
  const [error, setError] = useState("")

  async function loadReports(nextRange = range) {
    setError("")
    const res = await fetch(`${API_BASE}/admin/reports/${getTenantSlug()}?range=${nextRange}`)
    const json = await res.json()

    if (!res.ok || !json.ok) {
      setError(json?.error || "Failed to load reports")
      return
    }

    setData(json)
  }

  useEffect(() => {
    loadReports(range)
  }, [range])

  const stageRows = buildStageRows(
    data?.by_stage || [],
    workspace.dashboard.pipeline_cards || []
  )

  const sourceTypeRows = buildSourceTypeRows(data?.by_source_type || [])

  return (
    <div style={page}>
      <h1>Reports</h1>
      <p style={muted}>Track where opportunities come from, what they become, and where they currently sit in the pipeline.</p>

      <div style={buttonRow}>
        {["7d", "30d", "all"].map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            style={range === r ? activeButton : button}
          >
            {r === "7d" ? "Last 7 Days" : r === "30d" ? "Last 30 Days" : "All Time"}
          </button>
        ))}
      </div>

      {error && <p style={danger}>{error}</p>}

      <div style={reportsLayout}>
        <SourceTypeCard rows={sourceTypeRows} />
        <div style={stageSection}>
          <ReportCard title="Jobs by Stage" rows={stageRows} />
        </div>
      </div>
    </div>
  )
}

type SourceTypeDisplayRow = {
  source: string
  outcomes: Array<{
    stage: string
    jobType: string
    count: number
  }>
  count: number
}

function buildSourceTypeRows(rows: SourceTypeRow[]): SourceTypeDisplayRow[] {
  const grouped = new Map<string, SourceTypeDisplayRow>()

  for (const row of rows) {
    const source = String(row.source || "unknown")
    const currentStage = String(row.current_stage || "unknown")
    const jobType = String(row.job_type || "unknown")
    const count = Number(row.count || 0)

    const current = grouped.get(source) || {
      source,
      outcomes: [],
      count: 0,
    }

    current.outcomes.push({
      stage: humanizeStage(currentStage),
      jobType: humanizeReportJobType(jobType),
      count,
    })

    current.count += count
    grouped.set(source, current)
  }

  for (const row of grouped.values()) {
    row.outcomes.sort(
      (a, b) =>
        b.count - a.count ||
        a.stage.localeCompare(b.stage) ||
        a.jobType.localeCompare(b.jobType)
    )
  }

  return Array.from(grouped.values()).sort(
    (a, b) => b.count - a.count || a.source.localeCompare(b.source)
  )
}

function SourceTypeCard({ rows }: { rows: SourceTypeDisplayRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  return (
    <section style={card}>
      <h2>Source Performance</h2>
      <p style={muted}>Total opportunities: {total}</p>

      {rows.length === 0 ? (
        <p style={muted}>No data yet.</p>
      ) : (
        <div>
          <div style={sourceTypeHeader}>
            <strong>Source</strong>
            <strong>Current Stage</strong>
            <strong>Current Job Type</strong>
            <strong style={{ textAlign: "right" }}>Total</strong>
          </div>

          {rows.map((row) => (
            <div key={row.source} style={sourceGroup}>
              {row.outcomes.map((outcome, index) => (
                <div
                  key={`${row.source}-${outcome.stage}-${outcome.jobType}`}
                  style={sourceTypeRow}
                >
                  <span>
                    {index === 0 ? humanizeReportValue(row.source) : ""}
                  </span>
                  <span>{outcome.stage}</span>
                  <span>{outcome.jobType}</span>
                  <strong style={{ textAlign: "right" }}>
                    {outcome.count}
                  </strong>
                </div>
              ))}

              <div style={sourceTotalRow}>
                <span />
                <span />
                <strong>Source Total</strong>
                <strong style={{ textAlign: "right" }}>{row.count}</strong>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function humanizeReportJobType(value: string) {
  const normalized = String(value || "unknown").trim()

  if (normalized.toUpperCase() === "VOICE_INTAKE") {
    return "Unclassified"
  }

  return humanizeReportValue(normalized)
}

function humanizeReportValue(value: string) {
  return String(value || "unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function buildStageRows(
  rows: ReportRow[],
  pipelineCards: Array<{
    label: string
    filter_type: "stage" | "stage_any" | "buying_signal"
    filter_value?: string | null
    filter_values?: string[]
  }>
): ReportRow[] {
  const counts = new Map(
    rows.map((row) => [
      String(row.label || "unknown"),
      Number(row.count || 0),
    ])
  )

  const consumedStages = new Set<string>()
  const configuredRows: ReportRow[] = []

  for (const card of pipelineCards) {
    if (card.filter_type === "buying_signal") {
      continue
    }

    if (card.filter_type === "stage") {
      const stage = String(card.filter_value || "").trim()
      if (!stage) continue

      configuredRows.push({
        label: card.label || humanizeStage(stage),
        count: counts.get(stage) || 0,
      })

      consumedStages.add(stage)
      continue
    }

    const stages = (card.filter_values || [])
      .map((stage) => String(stage || "").trim())
      .filter(Boolean)

    if (!stages.length) continue

    configuredRows.push({
      label: card.label || stages.map(humanizeStage).join(" / "),
      count: stages.reduce(
        (sum, stage) => sum + (counts.get(stage) || 0),
        0
      ),
    })

    for (const stage of stages) {
      consumedStages.add(stage)
    }
  }

  const unexpectedRows = rows
    .filter((row) => !consumedStages.has(String(row.label || "unknown")))
    .map((row) => ({
      label: humanizeStage(String(row.label || "unknown")),
      count: Number(row.count || 0),
    }))

  return [...configuredRows, ...unexpectedRows]
}

function humanizeStage(value: string) {
  return String(value || "unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function ReportCard({ title, rows }: { title: string; rows: ReportRow[] }) {
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0)

  return (
    <section style={card}>
      <h2>{title}</h2>
      <p style={muted}>Total: {total}</p>

      {rows.length === 0 ? (
        <p style={muted}>No data yet.</p>
      ) : (
        <div>
          {rows.map((row) => (
            <div key={row.label} style={rowStyle}>
              <span>{row.label || "unknown"}</span>
              <strong>{row.count}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const page = {
  maxWidth: "1200px",
  margin: "0 auto",
  color: "white",
  padding: "24px",
} as const

const reportsLayout = {
  display: "flex",
  flexDirection: "column",
  gap: "18px",
  marginTop: "20px",
} as const

const stageSection = {
  width: "100%",
} as const

const card = {
  background: "rgba(15, 23, 42, 0.92)",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: "18px",
  padding: "20px",
} as const

const sourceTypeHeader = {
  display: "grid",
  gridTemplateColumns: "minmax(150px, 1.2fr) minmax(130px, 1fr) minmax(180px, 1.2fr) 70px",
  gap: "14px",
  padding: "10px 0",
  borderBottom: "1px solid rgba(148, 163, 184, 0.28)",
  opacity: 0.8,
  fontSize: "13px",
} as const

const sourceTypeRow = {
  display: "grid",
  gridTemplateColumns: "minmax(150px, 1.2fr) minmax(130px, 1fr) minmax(180px, 1.2fr) 70px",
  gap: "14px",
  alignItems: "start",
  padding: "10px 0",
  borderBottom: "1px solid rgba(148, 163, 184, 0.16)",
} as const

const sourceGroup = {
  borderBottom: "1px solid rgba(148, 163, 184, 0.28)",
} as const

const sourceTotalRow = {
  display: "grid",
  gridTemplateColumns: "minmax(150px, 1.2fr) minmax(130px, 1fr) minmax(180px, 1.2fr) 70px",
  gap: "14px",
  padding: "8px 0 12px",
  opacity: 0.82,
  fontSize: "13px",
} as const

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  padding: "10px 0",
  borderBottom: "1px solid rgba(148, 163, 184, 0.16)",
} as const

const muted = {
  opacity: 0.75,
} as const

const buttonRow = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  marginTop: "18px",
} as const

const button = {
  padding: "10px 14px",
  borderRadius: "12px",
  border: "1px solid rgba(148, 163, 184, 0.25)",
  background: "rgba(30, 41, 59, 0.9)",
  color: "white",
  cursor: "pointer",
} as const

const activeButton = {
  ...button,
  background: "#3b82f6",
} as const

const danger = {
  color: "#fecaca",
} as const
