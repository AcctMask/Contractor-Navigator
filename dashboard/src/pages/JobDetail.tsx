import { useEffect, useState, type CSSProperties } from "react"
import { Link, useParams } from "react-router-dom"

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787"
const TENANT = "g2g-roofing"

export default function JobDetail() {
  const { id } = useParams()

  const [job, setJob] = useState<any>(null)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")

  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    address1: "",
    city: "",
    state: "",
    zip: "",
    carrier: "",
    claim_number: "",
    policy_holder: "",
    adjuster_name: "",
    adjuster_phone: "",
    adjuster_email: "",
    damage_location: "",
    damage_summary: "",
  })

  function setField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function loadJob() {
    if (!id) return

    const res = await fetch(`${API_BASE}/admin/${TENANT}/jobs/${id}`)
    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data?.error || "Failed to load job")
      return
    }

    setJob(data.job)

    setForm({
      customer_name: data.job.customer_name || "",
      customer_phone: data.job.customer_phone || "",
      customer_email: data.job.customer_email || "",
      address1: data.job.address1 || "",
      city: data.job.city || "",
      state: data.job.state || "",
      zip: data.job.zip || "",
      carrier: data.job.carrier || "",
      claim_number: data.job.claim_number || "",
      policy_holder: data.job.policy_holder || "",
      adjuster_name: data.job.adjuster_name || "",
      adjuster_phone: data.job.adjuster_phone || "",
      adjuster_email: data.job.adjuster_email || "",
      damage_location: data.job.damage_location || "",
      damage_summary: data.job.damage_summary || "",
    })
  }

  async function saveJob() {
    if (!id) return

    setStatus("Saving...")

    const res = await fetch(`${API_BASE}/admin/job/${TENANT}/${id}/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(form),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setStatus("")
      setError(data?.error || "Save failed")
      return
    }

    setStatus("Saved successfully")
    await loadJob()
  }

  useEffect(() => {
    loadJob()
  }, [id])

  return (
    <div style={page}>
      <Link to="/job-admin" style={link}>← Back</Link>

      <h1 style={{ color: "white" }}>Job #{id}</h1>

      {status && <p style={success}>{status}</p>}
      {error && <p style={danger}>{error}</p>}

      <section style={card}>
        <h2>Edit Customer / Claim Data</h2>

        <div style={grid}>
          <Field label="Customer Name" value={form.customer_name} onChange={(v: string) => setField("customer_name", v)} />
          <Field label="Phone" value={form.customer_phone} onChange={(v: string) => setField("customer_phone", v)} />
          <Field label="Email" value={form.customer_email} onChange={(v: string) => setField("customer_email", v)} />

          <Field label="Address" value={form.address1} onChange={(v: string) => setField("address1", v)} />
          <Field label="City" value={form.city} onChange={(v: string) => setField("city", v)} />
          <Field label="State" value={form.state} onChange={(v: string) => setField("state", v)} />
          <Field label="Zip" value={form.zip} onChange={(v: string) => setField("zip", v)} />

          <Field label="Carrier" value={form.carrier} onChange={(v: string) => setField("carrier", v)} />
          <Field label="Claim #" value={form.claim_number} onChange={(v: string) => setField("claim_number", v)} />
          <Field label="Policy Holder" value={form.policy_holder} onChange={(v: string) => setField("policy_holder", v)} />

          <Field label="Adjuster Name" value={form.adjuster_name} onChange={(v: string) => setField("adjuster_name", v)} />
          <Field label="Adjuster Phone" value={form.adjuster_phone} onChange={(v: string) => setField("adjuster_phone", v)} />
          <Field label="Adjuster Email" value={form.adjuster_email} onChange={(v: string) => setField("adjuster_email", v)} />

          <Field label="Damage Location" value={form.damage_location} onChange={(v: string) => setField("damage_location", v)} />
        </div>

        <label style={label}>Damage Summary</label>
        <textarea
          value={form.damage_summary}
          onChange={(e) => setField("damage_summary", e.target.value)}
          style={textarea}
        />

        <button onClick={saveJob} style={button}>
          Save Changes
        </button>
      </section>

      <section style={card}>
        <h2>Current Data</h2>
        {job ? (
          <>
            <p><strong>Customer:</strong> {job.customer_name}</p>
            <p><strong>Carrier:</strong> {job.carrier}</p>
            <p><strong>Claim #:</strong> {job.claim_number}</p>
          </>
        ) : (
          <p>Loading...</p>
        )}
      </section>
    </div>
  )
}

function Field({ label, value, onChange }: any) {
  return (
    <div>
      <label style={label}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={input} />
    </div>
  )
}

const page: CSSProperties = { padding: 20 }
const card: CSSProperties = { background: "#111827", color: "white", padding: 20, marginBottom: 20, borderRadius: 10 }
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }
const input: CSSProperties = { width: "100%", padding: 8 }
const textarea: CSSProperties = { width: "100%", padding: 8, minHeight: 80 }
const label: CSSProperties = { display: "block", marginBottom: 4 }
const button: CSSProperties = { marginTop: 10, padding: 10 }
const link: CSSProperties = { color: "#93c5fd" }
const success: CSSProperties = { color: "#22c55e" }
const danger: CSSProperties = { color: "#ef4444" }
