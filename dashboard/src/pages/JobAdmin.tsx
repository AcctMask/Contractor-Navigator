import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787"
const TENANT = "g2g-roofing"

export default function JobAdmin() {
  const navigate = useNavigate()

  const [query, setQuery] = useState("")
  const [jobs, setJobs] = useState<any[]>([])
  const [error, setError] = useState("")
  const [status, setStatus] = useState("")

  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    address1: "",
    city: "",
    state: "FL",
    zip: "",
    stage: "lead",
  })

  async function searchJobs() {
    try {
      setError("")
      setStatus("Searching...")

      const res = await fetch(
        `${API_BASE}/admin/${TENANT}/job-search?q=${encodeURIComponent(query.trim())}`
      )
      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Search failed")
      }

      setJobs(data.results || [])
      setStatus(`Found ${data.results?.length || 0} job(s)`)
    } catch (err: any) {
      setStatus("")
      setError(err.message || "Search failed")
    }
  }

  async function loadAllJobs() {
    try {
      setError("")
      setStatus("Loading all jobs...")

      const res = await fetch(`${API_BASE}/admin/${TENANT}/jobs-all`)
      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Load all failed")
      }

      setJobs(data.jobs || [])
      setStatus(`Loaded ${data.jobs?.length || 0} job(s)`)
    } catch (err: any) {
      setStatus("")
      setError(err.message || "Load all failed")
    }
  }

  function openJob(jobId: number | string) {
    navigate(`/job/${jobId}`)
  }

  async function createJob() {
    try {
      setError("")
      setStatus("Creating job...")

      const res = await fetch(`${API_BASE}/admin/${TENANT}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })

      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Create failed")
      }

      setStatus(`Job created: #${data.job_id}`)

      setForm({
        customer_name: "",
        customer_phone: "",
        customer_email: "",
        address1: "",
        city: "",
        state: "FL",
        zip: "",
        stage: "lead",
      })

      loadAllJobs()
    } catch (err: any) {
      setStatus("")
      setError(err.message || "Create failed")
    }
  }

  useEffect(() => {
    loadAllJobs()
  }, [])

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ color: "white" }}>Job Admin</h1>

      {/* SEARCH */}
      <div style={card}>
        <h2>Search Jobs</h2>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, phone, address"
          style={input}
        />

        <button onClick={searchJobs} style={button}>
          Search
        </button>

        <button onClick={loadAllJobs} style={button}>
          Load All Jobs
        </button>
      </div>

      {/* CREATE */}
      <div style={card}>
        <h2>Create Job</h2>

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

        <button onClick={createJob} style={button}>
          Create Job
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

const jobRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: 10,
  padding: 10,
  background: "#222",
  borderRadius: 6,
}
