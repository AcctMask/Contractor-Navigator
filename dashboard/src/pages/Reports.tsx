import { useEffect, useState } from "react"

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787"
const TENANT = "g2g-roofing"

type ReportRow = {
  label: string
  count: number
}

type ReportData = {
  ok: boolean
  range: string
  by_source: ReportRow[]
  by_job_type: ReportRow[]
  by_stage: ReportRow[]
}

export default function ReportsPage() {
  const [range, setRange] = useState("30d")
  const [data, setData] = useState<ReportData | null>(null)
  const [error, setError] = useState("")

  async function loadReports(nextRange = range) {
    setError("")
    const res = await fetch(`${API_BASE}/admin/reports/${TENANT}?range=${nextRange}`)
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

  return (
    <div style={page}>
      <h1>Reports</h1>
      <p style={muted}>Track where jobs are coming from, what type they are, and where they sit in the pipeline.</p>

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

      <div style={grid}>
        <ReportCard title="Jobs by Lead Source" rows={data?.by_source || []} />
        <ReportCard title="Jobs by Type" rows={data?.by_job_type || []} />
        <ReportCard title="Jobs by Stage" rows={data?.by_stage || []} />
      </div>
    </div>
  )
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

const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "18px",
  marginTop: "20px",
} as const

const card = {
  background: "rgba(15, 23, 42, 0.92)",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: "18px",
  padding: "20px",
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
