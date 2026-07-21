import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { getToken } from "../lib/auth"
import { getTenantSlug } from "../lib/tenant"

const API_BASE = import.meta.env.VITE_API_BASE || "https://contractor-navigator.onrender.com"
export default function JobAdmin() {
  const navigate = useNavigate()

  const [query, setQuery] = useState("")
  const [jobs, setJobs] = useState<any[]>([])
  const [error, setError] = useState("")
  const [status, setStatus] = useState("")
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message })
    window.setTimeout(() => setToast(null), 2600)
  }

  function successToast(message: string) {
    setStatus(message)
    showToast("success", message)
  }

  function errorToast(message: string) {
    setStatus("")
    setError(message)
    showToast("error", message)
  }

  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    address1: "",
    city: "",
    state: "FL",
    zip: "",
    source: "manual_office_entry",
    source_detail: "",
    notes: "",
  })

  async function searchJobs() {
    try {
      setError("")
      setStatus("Searching...")

      const token = getToken()
      const res = await fetch(
        `${API_BASE}/admin/${getTenantSlug()}/job-search?q=${encodeURIComponent(query.trim())}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )
      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Search failed")
      }

      setJobs(data.results || [])
      setStatus(`Found ${data.results?.length || 0} job(s)`)
    } catch (err: any) {
      setStatus("")
      errorToast(err.message || "Search failed")
    }
  }

  async function loadAllJobs() {
    try {
      setError("")
      setStatus("Loading all jobs...")

      const token = getToken()
      const res = await fetch(`${API_BASE}/admin/${getTenantSlug()}/jobs-all`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Load all failed")
      }

      setJobs(data.jobs || [])
      setStatus(`Loaded ${data.jobs?.length || 0} job(s)`)
    } catch (err: any) {
      setStatus("")
      errorToast(err.message || "Load all failed")
    }
  }

  function openJob(jobId: number | string) {
    navigate(`/job/${jobId}`)
  }

  async function createJob() {
    try {
      setError("")
      setStatus("Creating job...")

      const token = getToken()
      const res = await fetch(
        `${API_BASE}/business-development/${getTenantSlug()}/intake`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(form),
        }
      )

      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Create failed")
      }

      successToast(
        data.action === "updated_existing_job"
          ? `Existing job updated: #${data.job_id}`
          : `Job created: #${data.job_id}`
      )

      setForm({
        customer_name: "",
        customer_phone: "",
        customer_email: "",
        address1: "",
        city: "",
        state: "FL",
        zip: "",
        source: "manual_office_entry",
        source_detail: "",
        notes: "",
      })

      loadAllJobs()
    } catch (err: any) {
      setStatus("")
      errorToast(err.message || "Create failed")
    }
  }

  useEffect(() => {
    loadAllJobs()
  }, [])

  return (
    <div style={{ padding: 20 }}>
      {toast ? (
        <div style={{
          position: "fixed",
          top: 18,
          right: 18,
          zIndex: 9999,
          padding: "12px 16px",
          borderRadius: 12,
          fontWeight: 900,
          color: "#ffffff",
          background: toast.type === "success" ? "#16a34a" : "#dc2626",
          boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
        }}>
          {toast.type === "success" ? "✓ " : "✕ "}{toast.message}
        </div>
      ) : null}
      <h1 style={{ color: "white" }}>Job Admin</h1>

      {/* SEARCH */}
      <div style={card}>
        <h2>Search Jobs</h2>

        <div style={searchRow}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone, address"
            style={{ ...input, marginBottom: 0 }}
          />

          <button onClick={searchJobs} style={{ ...button, marginTop: 0 }}>
            Search
          </button>

          <button onClick={loadAllJobs} style={{ ...button, marginTop: 0 }}>
            Load All Jobs
          </button>
        </div>
      </div>

      {/* CREATE */}
      <div style={card}>
        <h2>Create Business Opportunity</h2>
        <p style={{ color: "#cbd5e1", marginTop: -4 }}>
          Creates a new Navigator job or updates the active job already associated with the property address.
        </p>

        <div style={grid2}>
          <input
            placeholder="Customer Name"
            value={form.customer_name}
            onChange={(e) =>
              setForm({ ...form, customer_name: e.target.value })
            }
            style={input}
          />

          <input
            placeholder="Phone"
            value={form.customer_phone}
            onChange={(e) =>
              setForm({ ...form, customer_phone: e.target.value })
            }
            style={input}
          />

          <input
            placeholder="Email"
            value={form.customer_email}
            onChange={(e) =>
              setForm({ ...form, customer_email: e.target.value })
            }
            style={input}
          />

          <input
            placeholder="Address"
            value={form.address1}
            onChange={(e) =>
              setForm({ ...form, address1: e.target.value })
            }
            style={input}
          />

          <input
            placeholder="City"
            value={form.city}
            onChange={(e) =>
              setForm({ ...form, city: e.target.value })
            }
            style={input}
          />

          <input
            placeholder="Zip"
            value={form.zip}
            onChange={(e) =>
              setForm({ ...form, zip: e.target.value })
            }
            style={input}
          />

          <select
            value={form.source}
            onChange={(e) =>
              setForm({ ...form, source: e.target.value })
            }
            style={input}
          >
            <option value="manual_office_entry">
              Manual Office Entry
            </option>
            <option value="universal_outreach_reply">
              Universal Outreach Reply
            </option>
          </select>

          <input
            placeholder="Source Detail"
            value={form.source_detail}
            onChange={(e) =>
              setForm({
                ...form,
                source_detail: e.target.value,
              })
            }
            style={input}
          />
        </div>

        <textarea
          placeholder="Opportunity Notes"
          value={form.notes}
          onChange={(e) =>
            setForm({ ...form, notes: e.target.value })
          }
          style={{
            ...input,
            minHeight: 100,
            resize: "vertical",
          }}
        />

        <button onClick={createJob} style={button}>
          Process Business Opportunity
        </button>
      </div>

      {/* JOB LIST */}
      <div style={card}>
        <h2>Jobs</h2>

        {jobs.map((job) => (
          <div key={job.id} style={jobRow}>
            <div>
              <strong>#{job.id}</strong> —{" "}
              {job.customer_name || "No Name"} — {job.stage}
            </div>

            <button onClick={() => openJob(job.id)} style={button}>
              Open Job
            </button>
          </div>
        ))}
      </div>

      {status && <p style={{ color: "#86efac" }}>{status}</p>}
      {error && <p style={{ color: "#fca5a5" }}>{error}</p>}
    </div>
  )
}

const card: React.CSSProperties = {
  background: "#111",
  padding: 20,
  marginBottom: 20,
  borderRadius: 10,
}

const input: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginBottom: 10,
  padding: 10,
}

const button: React.CSSProperties = {
  marginRight: 10,
  marginTop: 5,
  padding: "10px 14px",
  cursor: "pointer",
}

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
}

const searchRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto auto",
  gap: 10,
  alignItems: "center",
}

const jobRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: 10,
  padding: 10,
  background: "#222",
  borderRadius: 6,
}
