import { useState } from "react"
import { Link } from "react-router-dom"

const API_BASE = "http://localhost:8787"
const TENANT_SLUG = "g2g-roofing"

type SearchResult = {
  id: number
  address1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  stage?: string | null
  customer_name?: string | null
  customer_phone?: string | null
}

type JobDetails = {
  id: number
  stage?: string | null
  crm_substatus?: string | null
  address1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  customer_email?: string | null
  bot_paused?: boolean | null
  dnc?: boolean | null
}

function formatAddress(job?: {
  address1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}) {
  if (!job) return "—"
  return [job.address1, job.city, job.state, job.zip].filter(Boolean).join(", ") || "—"
}

export default function JobAdminPage() {
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [jobIdInput, setJobIdInput] = useState("")
  const [job, setJob] = useState<JobDetails | null>(null)

  const [stage, setStage] = useState("lead")
  const [crmSubstatus, setCrmSubstatus] = useState("")
  const [botPaused, setBotPaused] = useState(false)
  const [dnc, setDnc] = useState(false)

  const [searchStatus, setSearchStatus] = useState("")
  const [loadStatus, setLoadStatus] = useState("")
  const [saveStatus, setSaveStatus] = useState("")
  const [error, setError] = useState("")

  const [loading, setLoading] = useState(false)
  const [loadingJob, setLoadingJob] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSearch() {
    setError("")
    setSearchStatus("Searching...")
    setLoading(true)
    setResults([])

    try {
      const q = search.trim()

      if (!q) {
        throw new Error("Search is required")
      }

      const res = await fetch(`${API_BASE}/jobs/search?q=${encodeURIComponent(q)}`)
      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error || "Search failed")
      }

      setResults(Array.isArray(json.results) ? json.results : [])
      setSearchStatus(
        Array.isArray(json.results) && json.results.length
          ? `Found ${json.results.length} result(s)`
          : "No matching jobs found"
      )
    } catch (err: any) {
      setSearchStatus("Search failed")
      setError(err?.message || "Search failed")
    } finally {
      setLoading(false)
    }
  }

  async function loadJobById(id: number | string) {
    setError("")
    setLoadStatus("Loading job...")
    setLoadingJob(true)

    try {
      const numericId = Number(id)

      if (!numericId) {
        throw new Error("Job ID is required")
      }

      const res = await fetch(`${API_BASE}/jobs/${numericId}`)
      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error || "Load failed")
      }

      const loadedJob = json.job as JobDetails
      setJob(loadedJob)
      setJobIdInput(String(loadedJob.id))
      setStage(loadedJob.stage || "lead")
      setCrmSubstatus(loadedJob.crm_substatus || "")
      setBotPaused(!!loadedJob.bot_paused)
      setDnc(!!loadedJob.dnc)
      setLoadStatus("Job loaded")
    } catch (err: any) {
      setLoadStatus("Load failed")
      setError(err?.message || "Load failed")
      setJob(null)
    } finally {
      setLoadingJob(false)
    }
  }

  async function handleLoadJob() {
    await loadJobById(jobIdInput)
  }

  async function handleSaveStage() {
    if (!job?.id) {
      setError("Load a job first")
      return
    }

    setError("")
    setSaveStatus("Saving...")
    setSaving(true)

    try {
      const res = await fetch(`${API_BASE}/admin/${TENANT_SLUG}/job/${job.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stage,
          crm_substatus: crmSubstatus,
          bot_paused: botPaused,
          dnc,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error || "Save failed")
      }

      setSaveStatus("Stage saved")
      await loadJobById(job.id)
    } catch (err: any) {
      setSaveStatus("Save failed")
      setError(err?.message || "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        display: "grid",
        gap: "24px",
      }}
    >
      <section style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ marginTop: 0, fontSize: "42px", lineHeight: 1.1 }}>Job Admin</h1>
            <p style={{ marginTop: "12px", fontSize: "18px", opacity: 0.88 }}>
              Search by job ID, customer name, phone number, or property address.
            </p>
          </div>

          <div style={{ alignSelf: "flex-start" }}>
            <Link to="/" style={secondaryLinkStyle}>
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Search Jobs</h2>

        <div style={{ display: "grid", gap: "14px" }}>
          <div>
            <label style={labelStyle}>Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Steve Pashoian, 7272154507, 123 Main, or 27"
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={handleSearch} style={buttonStyle} disabled={loading}>
              {loading ? "Searching..." : "Search Jobs"}
            </button>
            <span style={{ opacity: 0.85 }}>{searchStatus}</span>
          </div>
        </div>

        {results.length ? (
          <div style={{ display: "grid", gap: "12px", marginTop: "18px" }}>
            {results.map((result) => (
              <div key={result.id} style={rowStyle}>
                <div style={{ fontWeight: 700, fontSize: "18px" }}>
                  {result.customer_name || "Unnamed Customer"}
                </div>
                <div style={{ opacity: 0.9 }}>Job ID: {result.id}</div>
                <div style={{ opacity: 0.9 }}>Phone: {result.customer_phone || "—"}</div>
                <div style={{ opacity: 0.9 }}>Address: {formatAddress(result)}</div>
                <div style={{ opacity: 0.75 }}>Stage: {result.stage || "—"}</div>

                <div style={{ marginTop: "12px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    onClick={() => loadJobById(result.id)}
                    style={buttonStyle}
                    disabled={loadingJob}
                  >
                    Load This Job
                  </button>

                  <Link to={`/job/${result.id}`} style={secondaryLinkStyle}>
                    Open Full Job View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Load Job</h2>

        <div style={{ display: "grid", gap: "14px" }}>
          <div>
            <label style={labelStyle}>Job ID</label>
            <input
              value={jobIdInput}
              onChange={(e) => setJobIdInput(e.target.value)}
              placeholder="27"
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={handleLoadJob} style={buttonStyle} disabled={loadingJob}>
              {loadingJob ? "Loading..." : "Load Job"}
            </button>
            <span style={{ opacity: 0.85 }}>{loadStatus}</span>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Job Summary</h2>

        {job ? (
          <>
            <div style={{ lineHeight: 1.7, fontSize: "18px" }}>
              <div><strong>Customer:</strong> {job.customer_name || "—"}</div>
              <div><strong>Email:</strong> {job.customer_email || "—"}</div>
              <div><strong>Phone:</strong> {job.customer_phone || "—"}</div>
              <div><strong>Address:</strong> {formatAddress(job)}</div>
              <div><strong>Stage:</strong> {job.stage || "—"}</div>
              <div><strong>CRM Substatus:</strong> {job.crm_substatus || "—"}</div>
              <div><strong>Bot Paused:</strong> {job.bot_paused ? "Yes" : "No"}</div>
              <div><strong>DNC:</strong> {job.dnc ? "Yes" : "No"}</div>
            </div>

            <div style={{ marginTop: 16, display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <Link to={`/job/${job.id}`} style={secondaryLinkStyle}>
                Open Full Job View →
              </Link>
            </div>
          </>
        ) : (
          <p>No job loaded yet.</p>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Manual Stage Control</h2>

        <div style={{ display: "grid", gap: "14px" }}>
          <div>
            <label style={labelStyle}>Stage</label>
            <select value={stage} onChange={(e) => setStage(e.target.value)} style={inputStyle}>
              <option value="lead">lead</option>
              <option value="estimate_sent">estimate_sent</option>
              <option value="contract_sent">contract_sent</option>
              <option value="won">won</option>
              <option value="lost">lost</option>
              <option value="production">production</option>
              <option value="completed">completed</option>
              <option value="dnc">dnc</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>CRM Substatus</label>
            <input
              value={crmSubstatus}
              onChange={(e) => setCrmSubstatus(e.target.value)}
              placeholder="message_received"
              style={inputStyle}
            />
          </div>

          <label style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={botPaused}
              onChange={(e) => setBotPaused(e.target.checked)}
            />
            Pause bot for this job
          </label>

          <label style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={dnc}
              onChange={(e) => setDnc(e.target.checked)}
            />
            Mark customer DNC
          </label>

          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={handleSaveStage} style={buttonStyle} disabled={saving || !job}>
              {saving ? "Saving..." : "Save Stage"}
            </button>
            <span style={{ opacity: 0.85 }}>{saveStatus}</span>
          </div>
        </div>
      </section>

      {error ? <div style={errorStyle}>{error}</div> : null}
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(81, 133, 255, 0.25)",
  borderRadius: "24px",
  padding: "24px",
}

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "8px",
  fontWeight: 700,
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  color: "#e8eefc",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: "14px",
  padding: "14px 16px",
  fontSize: "16px",
  outline: "none",
}

const buttonStyle: React.CSSProperties = {
  color: "#fff",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  border: "none",
  padding: "12px 18px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: 700,
}

const secondaryLinkStyle: React.CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "10px 16px",
  borderRadius: "14px",
  display: "inline-block",
  fontWeight: 700,
}

const rowStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "16px",
  padding: "14px 16px",
}

const errorStyle: React.CSSProperties = {
  background: "rgba(150, 30, 30, 0.22)",
  border: "1px solid rgba(255, 120, 120, 0.35)",
  color: "#ffd1d1",
  borderRadius: "14px",
  padding: "12px 14px",
}
