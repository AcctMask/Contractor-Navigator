import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787"
const TENANT = "g2g-roofing"

export default function JobDetail() {
  const { id } = useParams()

  const [form, setForm] = useState<any>({})
  const [isEditing, setIsEditing] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")

  async function loadJob() {
    if (!id) return

    const res = await fetch(`${API_BASE}/admin/${TENANT}/jobs/${id}`)
    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data?.error || "Failed to load job")
      return
    }

    setForm(data.job)
  }

  function setField(key: string, value: string) {
    setForm((prev: any) => ({ ...prev, [key]: value }))
  }

  async function saveChanges() {
    if (!id) return

    setStatus("Saving...")
    setError("")

    const res = await fetch(`${API_BASE}/admin/${TENANT}/job/${id}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data?.error || "Save failed")
      setStatus("")
      return
    }

    setStatus("Saved")
    setIsEditing(false)
    await loadJob()
  }

  useEffect(() => {
    loadJob()
  }, [id])

  return (
    <div style={page}>
      <Link to="/job-admin" style={linkStyle}>← Back</Link>

      <h1 style={{ color: "white" }}>Job #{id}</h1>

      {status && <p style={success}>{status}</p>}
      {error && <p style={danger}>{error}</p>}

      {!isEditing ? (
        <button onClick={() => setIsEditing(true)} style={button}>
          Edit Customer / Claim Data
        </button>
      ) : (
        <>
          <button onClick={saveChanges} style={button}>Save</button>
          <button onClick={() => setIsEditing(false)} style={buttonSecondary}>Cancel</button>
        </>
      )}

      <section style={card}>
        <h2>Customer Info</h2>

        <Field label="Name" value={form.customer_name} edit={isEditing} onChange={(v: string) => setField("customer_name", v)} />
        <Field label="Phone" value={form.customer_phone} edit={isEditing} onChange={(v: string) => setField("customer_phone", v)} />
        <Field label="Email" value={form.customer_email} edit={isEditing} onChange={(v: string) => setField("customer_email", v)} />
        <Field label="Address" value={form.address1} edit={isEditing} onChange={(v: string) => setField("address1", v)} />
        <Field label="City" value={form.city} edit={isEditing} onChange={(v: string) => setField("city", v)} />
        <Field label="State" value={form.state} edit={isEditing} onChange={(v: string) => setField("state", v)} />
        <Field label="Zip" value={form.zip} edit={isEditing} onChange={(v: string) => setField("zip", v)} />

        <h3 style={{ marginTop: 20 }}>Claim Info</h3>

        <Field label="Carrier" value={form.carrier} edit={isEditing} onChange={(v: string) => setField("carrier", v)} />
        <Field label="Claim #" value={form.claim_number} edit={isEditing} onChange={(v: string) => setField("claim_number", v)} />
        <Field label="Policy Holder" value={form.policy_holder} edit={isEditing} onChange={(v: string) => setField("policy_holder", v)} />
        <Field label="Adjuster Name" value={form.adjuster_name} edit={isEditing} onChange={(v: string) => setField("adjuster_name", v)} />
        <Field label="Adjuster Phone" value={form.adjuster_phone} edit={isEditing} onChange={(v: string) => setField("adjuster_phone", v)} />
        <Field label="Adjuster Email" value={form.adjuster_email} edit={isEditing} onChange={(v: string) => setField("adjuster_email", v)} />
        <Field label="Damage Location" value={form.damage_location} edit={isEditing} onChange={(v: string) => setField("damage_location", v)} />
        <Field label="Damage Summary" value={form.damage_summary} edit={isEditing} onChange={(v: string) => setField("damage_summary", v)} multiline />
      </section>
    </div>
  )
}

function Field({ label, value, edit, onChange, multiline }: any) {
  return (
    <p>
      <strong>{label}:</strong>{" "}
      {edit ? (
        multiline ? (
          <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} style={textarea} />
        ) : (
          <input value={value || ""} onChange={(e) => onChange(e.target.value)} style={input} />
        )
      ) : (
        value || "—"
      )}
    </p>
  )
}

const page = { padding: 20 }
const card = { background: "#111827", color: "white", padding: 20, borderRadius: 10, marginTop: 20 }
const input = { marginLeft: 10, padding: 6 }
const textarea = { width: "100%", marginTop: 5 }
const button = { marginTop: 10, marginRight: 10 }
const buttonSecondary = { marginTop: 10, background: "#444", color: "white" }
const linkStyle = { color: "#93c5fd" }
const success = { color: "#22c55e" }
const danger = { color: "#ef4444" }
