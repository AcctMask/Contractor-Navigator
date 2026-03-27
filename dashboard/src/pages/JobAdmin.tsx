import { useMemo, useState } from "react"
import type { CSSProperties } from "react"
import { Link, useNavigate } from "react-router-dom"

const API_BASE = import.meta.env.VITE_API_BASE 
const TENANT_SLUG = "g2g-roofing"

type SearchRow = {
  id: number | string
  address1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  stage?: string | null
  customer_name?: string | null
  customer_phone?: string | null
}

type JobRow = {
  id: number | string
  stage?: string | null
  crm_substatus?: string | null
  address1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  bot_paused?: boolean | null
  customer_name?: string | null
  customer_phone?: string | null
  customer_email?: string | null
  lead_source?: string | null
  lead_source_detail?: string | null
  carrier?: string | null
  claim_number?: string | null
}

function formatAddress(job?: Partial<SearchRow | JobRow> | null) {
  if (!job) return "—"
  const parts = [job.address1, job.city, job.state, job.zip].filter(Boolean)
  return parts.length ? parts.join(", ") : "—"
}

export default function JobAdminPage() {
  const navigate = useNavigate()

  const [q, setQ] = useState("")
  const [jobId, setJobId] = useState("")
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [loadingJob, setLoadingJob] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [jobError, setJobError] = useState("")
  const [results, setResults] = useState<SearchRow[]>([])
  const [job, setJob] = useState<JobRow | null>(null)

  const summaryTitle = useMemo(() => {
    if (!job) return "No job loaded"
    return `${job.customer_name || "Unknown Customer"} · Job ${job.id}`
  }, [job])

  async function handleSearch() {
    setLoadingSearch(true)
    setSearchError("")
    setResults([])

    try {
      const term = String(q || "").trim()

      if (!term) {
        setResults([])
        return
      }

      const res = await fetch(
        `${API_BASE}/jobs/search?q=${encodeURIComponent(term)}`,
        { method: "GET" }
      )
      const json = await res.json()

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Search failed")
      }

      setResults(Array.isArray(json.results) ? json.results : [])
    } catch (err: any) {
      setSearchError(err?.message || "Search failed")
    } finally {
      setLoadingSearch(false)
    }
  }

  async function loadJobById(inputId?: string | number) {
    setLoadingJob(true)
    setJobError("")
    setJob(null)

    try {
      const raw = String(inputId ?? jobId ?? "").trim()
      const numericId = Number(raw)

      if (!Number.isFinite(numericId) || numericId <= 0) {
        throw new Error("Valid Job ID required")
      }

      const res = await fetch(
        `${API_BASE}/admin/job/${TENANT_SLUG}/${numericId}`,
        { method: "GET" }
      )
      const json = await res.json()

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Load failed")
      }

      if (!json.job) {
        throw new Error("Job not found")
      }

      setJob(json.job)
      setJobId(String(numericId))

      navigate(`/job/${numericId}`)
    } catch (err: any) {
      setJobError(err?.message || "Load failed")
    } finally {
      setLoadingJob(false)
    }
  }

  function openDetail(id: string | number) {
    navigate(`/job/${id}`)
  }

  return (
    <div style={pageStyle}>
      <div style={wrapStyle}>
        <div style={topBarStyle}>
          <h1 style={{ margin: 0, fontSize: 56, lineHeight: 1 }}>Job Admin</h1>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link to="/" style={navLinkStyle}>
              Dashboard
            </Link>
            <Link to="/command-center" style={navLinkStyle}>
              Command Center
            </Link>
          </div>
        </div>

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Search Jobs</h2>
          <label style={labelStyle}>Search</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Steve Pashoian, 7272154507, 123 Main, or 27"
            style={inputStyle}
          />

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16 }}>
            <button onClick={handleSearch} style={buttonStyle} disabled={loadingSearch}>
              {loadingSearch ? "Searching..." : "Search Jobs"}
            </button>
            {searchError ? <span style={errorTextStyle}>{searchError}</span> : null}
          </div>

          {results.length ? (
            <div style={{ marginTop: 22, display: "grid", gap: 14 }}>
              {results.map((row) => (
                <div key={String(row.id)} style={resultRowStyle}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={resultTitleStyle}>
                      {row.customer_name || "Unknown Customer"} · Job {row.id}
                    </div>
                    <div style={mutedStyle}>{formatAddress(row)}</div>
                    <div style={mutedStyle}>
                      Stage: {row.stage || "—"} · Phone: {row.customer_phone || "—"}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <button
                      style={secondaryButtonStyle}
                      onClick={() => loadJobById(row.id)}
                    >
                      Load
                    </button>
                    <button
                      style={buttonStyle}
                      onClick={() => openDetail(row.id)}
                    >
                      Open Detail
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Load Job</h2>
          <label style={labelStyle}>Job ID</label>
          <input
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            placeholder="30"
            style={inputStyle}
          />

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16 }}>
            <button
              onClick={() => loadJobById()}
              style={buttonStyle}
              disabled={loadingJob}
            >
              {loadingJob ? "Loading..." : "Load Job"}
            </button>
            {jobError ? <span style={errorTextStyle}>{jobError}</span> : null}
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Job Summary</h2>

          {job ? (
            <div style={{ display: "grid", gap: 16 }}>
              <div style={summaryHeaderStyle}>{summaryTitle}</div>

              <div style={summaryGridStyle}>
                <div style={summaryBoxStyle}>
                  <div style={summaryLabelStyle}>Customer</div>
                  <div>{job.customer_name || "—"}</div>
                </div>

                <div style={summaryBoxStyle}>
                  <div style={summaryLabelStyle}>Job ID</div>
                  <div>{job.id}</div>
                </div>

                <div style={summaryBoxStyle}>
                  <div style={summaryLabelStyle}>Stage</div>
                  <div>{job.stage || "—"}</div>
                </div>

                <div style={summaryBoxStyle}>
                  <div style={summaryLabelStyle}>CRM Substatus</div>
                  <div>{job.crm_substatus || "—"}</div>
                </div>

                <div style={summaryBoxStyle}>
                  <div style={summaryLabelStyle}>Phone</div>
                  <div>{job.customer_phone || "—"}</div>
                </div>

                <div style={summaryBoxStyle}>
                  <div style={summaryLabelStyle}>Email</div>
                  <div>{job.customer_email || "—"}</div>
                </div>

                <div style={{ ...summaryBoxStyle, gridColumn: "1 / -1" }}>
                  <div style={summaryLabelStyle}>Address</div>
                  <div>{formatAddress(job)}</div>
                </div>

                <div style={summaryBoxStyle}>
                  <div style={summaryLabelStyle}>Lead Source</div>
                  <div>{job.lead_source || "—"}</div>
                </div>

                <div style={summaryBoxStyle}>
                  <div style={summaryLabelStyle}>Lead Source Detail</div>
                  <div>{job.lead_source_detail || "—"}</div>
                </div>

                <div style={summaryBoxStyle}>
                  <div style={summaryLabelStyle}>Carrier</div>
                  <div>{job.carrier || "—"}</div>
                </div>

                <div style={summaryBoxStyle}>
                  <div style={summaryLabelStyle}>Claim Number</div>
                  <div>{job.claim_number || "—"}</div>
                </div>

                <div style={summaryBoxStyle}>
                  <div style={summaryLabelStyle}>Bot Paused</div>
                  <div>{job.bot_paused ? "Yes" : "No"}</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button
                  style={buttonStyle}
                  onClick={() => openDetail(job.id)}
                >
                  Open Job Detail
                </button>
              </div>
            </div>
          ) : (
            <div style={mutedStyle}>No job loaded yet.</div>
          )}
        </section>
      </div>
    </div>
  )
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#071b4d",
  color: "#fff",
  padding: 24,
}

const wrapStyle: CSSProperties = {
  maxWidth: 1230,
  margin: "0 auto",
  display: "grid",
  gap: 24,
}

const topBarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap",
}

const cardStyle: CSSProperties = {
  background: "#102764",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 28,
  padding: 26,
}

const sectionTitleStyle: CSSProperties = {
  marginTop: 0,
  marginBottom: 18,
  fontSize: 26,
}

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 14,
  fontWeight: 700,
  marginBottom: 10,
}

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "15px 16px",
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "#1b3370",
  color: "#fff",
  fontSize: 18,
  outline: "none",
}

const buttonStyle: CSSProperties = {
  background: "#55a3ff",
  color: "#fff",
  border: "none",
  borderRadius: 16,
  padding: "12px 20px",
  fontWeight: 800,
  cursor: "pointer",
}

const secondaryButtonStyle: CSSProperties = {
  background: "#324f9e",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: "12px 20px",
  fontWeight: 800,
  cursor: "pointer",
}

const navLinkStyle: CSSProperties = {
  color: "#fff",
  textDecoration: "none",
  background: "#1a3270",
  border: "1px solid rgba(255,255,255,0.08)",
  padding: "10px 16px",
  borderRadius: 16,
  fontWeight: 700,
}

const errorTextStyle: CSSProperties = {
  color: "#ffb4b4",
  fontWeight: 700,
}

const mutedStyle: CSSProperties = {
  color: "rgba(255,255,255,0.82)",
  fontSize: 16,
}

const resultRowStyle: CSSProperties = {
  display: "flex",
  gap: 18,
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  background: "#162f6d",
  borderRadius: 22,
  padding: 16,
}

const resultTitleStyle: CSSProperties = {
  fontWeight: 800,
  fontSize: 18,
  marginBottom: 4,
}

const summaryHeaderStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 900,
}

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
}

const summaryBoxStyle: CSSProperties = {
  background: "#162f6d",
  borderRadius: 18,
  padding: 16,
}

const summaryLabelStyle: CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.7,
  opacity: 0.72,
  marginBottom: 6,
}
