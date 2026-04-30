import { useEffect, useState, type CSSProperties } from "react"
import { Link, useParams } from "react-router-dom"

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787"
const TENANT = "g2g-roofing"

const STAGES = [
  "lead", "callback", "inspection", "roof_repair", "roof_replacement", "tarp",
  "estimate_sent", "contract_sent", "pre_production", "in_production",
  "completed", "tarp_complete", "invoiced", "paid", "dnc",
]

export default function JobDetail() {
  const { id } = useParams()

  const [job, setJob] = useState<any>(null)
  const [assets, setAssets] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [files, setFiles] = useState<FileList | null>(null)
  const [noteText, setNoteText] = useState("")
  const [stage, setStage] = useState("lead")
  const [crmSubstatus, setCrmSubstatus] = useState("")
  const [botPaused, setBotPaused] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<any>({})

  async function loadJob() {
    if (!id) return

    const res = await fetch(`${API_BASE}/admin/${TENANT}/jobs/${id}`)
    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data?.error || "Failed to load job")
      return
    }

    setJob(data.job)
    setForm(data.job)
    setStage(data.job.stage || "lead")
    setCrmSubstatus(data.job.crm_substatus || "")
    setBotPaused(Boolean(data.job.bot_paused))
  }

  async function loadAssets() {
    if (!id) return

    const res = await fetch(`${API_BASE}/assets/${TENANT}/job/${id}`)
    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data?.error || "Failed to load files/notes")
      return
    }

    setAssets(data.assets || [])
    setNotes(data.notes || [])
  }

  function setField(field: string, value: string) {
    setForm((prev: any) => ({ ...prev, [field]: value }))
  }

  async function saveCustomerClaimData() {
    if (!id) return

    setError("")
    setStatus("Saving...")

    const res = await fetch(`${API_BASE}/admin/job/${TENANT}/${id}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setStatus("")
      setError(data?.error || "Save failed")
      return
    }

    setStatus("Customer / claim data saved")
    setIsEditing(false)
    await loadJob()
  }

  function cancelEdit() {
    setForm(job || {})
    setIsEditing(false)
    setError("")
    setStatus("")
  }

  async function saveStage() {
    if (!id) return

    setError("")
    setStatus("Saving stage...")

    const res = await fetch(`${API_BASE}/admin/${TENANT}/jobs/${id}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage,
        crm_substatus: crmSubstatus,
        bot_paused: botPaused,
      }),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setStatus("")
      setError(data?.error || "Save stage failed")
      return
    }

    setStatus("Stage saved")
    await loadJob()
  }

  async function addNote() {
    if (!id) return
    if (!noteText.trim()) {
      setError("Type a note first")
      return
    }

    setError("")
    setStatus("Adding note...")

    const res = await fetch(`${API_BASE}/assets/${TENANT}/job/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: noteText }),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setStatus("")
      setError(data?.error || "Add note failed")
      return
    }

    setNoteText("")
    setStatus("Note added")
    await loadAssets()
  }

  async function deleteNote(noteId: number | string) {
    if (!id) return
    if (!window.confirm("Delete this note?")) return

    const res = await fetch(`${API_BASE}/assets/${TENANT}/job/${id}/notes/${noteId}`, {
      method: "DELETE",
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data?.error || "Delete note failed")
      return
    }

    setStatus("Note deleted")
    await loadAssets()
  }

  async function uploadFiles() {
    if (!id || !files || files.length === 0) {
      setError("Choose one or more files first")
      return
    }

    setError("")
    setStatus("Uploading files...")

    const formData = new FormData()
    Array.from(files).forEach((file) => formData.append("file", file))
    const res = await fetch(`${API_BASE}/assets/${TENANT}/job/${id}/upload`, {
      method: "POST",
      body: formData,
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setStatus("")
      setError(data?.error || "Upload failed")
      return
    }

    setFiles(null)
    setStatus(`Uploaded ${data.uploaded?.length || 0} file(s)`)
    await loadAssets()
  }

  async function deleteFile(assetId: number | string) {
    if (!id) return
    if (!window.confirm("Delete this file/photo?")) return

    const res = await fetch(`${API_BASE}/assets/${TENANT}/job/${id}/file/${assetId}`, {
      method: "DELETE",
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data?.error || "Delete file failed")
      return
    }

    setStatus("File deleted")
    await loadAssets()
  }

  useEffect(() => {
    loadJob()
    loadAssets()
  }, [id])

  return (
    <div style={page}>
      <Link to="/job-admin" style={linkStyle}>← Back to Job Admin</Link>

      <h1 style={{ color: "white" }}>Job #{id}</h1>

      {status && <p style={success}>{status}</p>}
      {error && <p style={danger}>{error}</p>}

      <section style={card}>
        <div style={sectionHeader}>
          <h2>Job / Customer Details</h2>

          {!isEditing ? (
            <button onClick={() => setIsEditing(true)} style={button}>
              Edit Customer / Claim Data
            </button>
          ) : (
            <div style={buttonRow}>
              <button onClick={saveCustomerClaimData} style={button}>Save Changes</button>
              <button onClick={cancelEdit} style={button}>Cancel</button>
            </div>
          )}
        </div>

        {job ? (
          !isEditing ? (
            <>
              <p><strong>Customer:</strong> {job.customer_name || "—"}</p>
              <p><strong>Phone:</strong> {job.customer_phone || "—"}</p>
              <p><strong>Email:</strong> {job.customer_email || "—"}</p>
              <p><strong>Address:</strong> {[job.address1, job.city, job.state, job.zip].filter(Boolean).join(", ") || "—"}</p>
              <p><strong>Current Stage:</strong> {job.stage || "lead"}</p>

              <hr style={hr} />

              <h3>Claim / Insurance Info</h3>
              <p><strong>Carrier:</strong> {job.carrier || "—"}</p>
              <p><strong>Claim #:</strong> {job.claim_number || "—"}</p>
              <p><strong>Policy Holder:</strong> {job.policy_holder || "—"}</p>
              <p><strong>Adjuster:</strong> {job.adjuster_name || "—"}</p>
              <p><strong>Adjuster Phone:</strong> {job.adjuster_phone || "—"}</p>
              <p><strong>Adjuster Email:</strong> {job.adjuster_email || "—"}</p>
              <p><strong>Damage Location:</strong> {job.damage_location || "—"}</p>
              <p><strong>Damage Summary:</strong> {job.damage_summary || "—"}</p>
            </>
          ) : (
            <>
              <label style={label}>Customer Name</label>
              <input value={form.customer_name || ""} onChange={(e) => setField("customer_name", e.target.value)} style={input} />

              <label style={label}>Phone</label>
              <input value={form.customer_phone || ""} onChange={(e) => setField("customer_phone", e.target.value)} style={input} />

              <label style={label}>Email</label>
              <input value={form.customer_email || ""} onChange={(e) => setField("customer_email", e.target.value)} style={input} />

              <label style={label}>Address</label>
              <input value={form.address1 || ""} onChange={(e) => setField("address1", e.target.value)} style={input} />

              <label style={label}>City</label>
              <input value={form.city || ""} onChange={(e) => setField("city", e.target.value)} style={input} />

              <label style={label}>State</label>
              <input value={form.state || ""} onChange={(e) => setField("state", e.target.value)} style={input} />

              <label style={label}>Zip</label>
              <input value={form.zip || ""} onChange={(e) => setField("zip", e.target.value)} style={input} />

              <hr style={hr} />

              <h3>Claim / Insurance Info</h3>

              <label style={label}>Carrier</label>
              <input value={form.carrier || ""} onChange={(e) => setField("carrier", e.target.value)} style={input} />

              <label style={label}>Claim #</label>
              <input value={form.claim_number || ""} onChange={(e) => setField("claim_number", e.target.value)} style={input} />

              <label style={label}>Policy Holder</label>
              <input value={form.policy_holder || ""} onChange={(e) => setField("policy_holder", e.target.value)} style={input} />

              <label style={label}>Adjuster</label>
              <input value={form.adjuster_name || ""} onChange={(e) => setField("adjuster_name", e.target.value)} style={input} />

              <label style={label}>Adjuster Phone</label>
              <input value={form.adjuster_phone || ""} onChange={(e) => setField("adjuster_phone", e.target.value)} style={input} />

              <label style={label}>Adjuster Email</label>
              <input value={form.adjuster_email || ""} onChange={(e) => setField("adjuster_email", e.target.value)} style={input} />

              <label style={label}>Damage Location</label>
              <input value={form.damage_location || ""} onChange={(e) => setField("damage_location", e.target.value)} style={input} />

              <label style={label}>Damage Summary</label>
              <textarea value={form.damage_summary || ""} onChange={(e) => setField("damage_summary", e.target.value)} style={textarea} />
            </>
          )
        ) : (
          <p>Loading job...</p>
        )}
      </section>

      <section style={card}>
        <h2>Stage / Bot Controls</h2>

        <label style={label}>Stage</label>
        <select value={stage} onChange={(e) => setStage(e.target.value)} style={input}>
          {STAGES.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>

        <label style={label}>CRM Substatus</label>
        <input value={crmSubstatus} onChange={(e) => setCrmSubstatus(e.target.value)} style={input} />

        <label style={checkRow}>
          <input type="checkbox" checked={botPaused} onChange={(e) => setBotPaused(e.target.checked)} />
          Pause bot for this job
        </label>

        <button onClick={saveStage} style={button}>Save Stage</button>
      </section>

      <section style={card}>
        <h2>Add Note</h2>
        <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a staff note..." style={textarea} />
        <button onClick={addNote} style={button}>Add Note</button>
      </section>

      <section style={card}>
        <h2>Notes</h2>

        {notes.length === 0 ? (
          <p>No notes yet.</p>
        ) : (
          notes.map((note) => (
            <div key={note.id} style={row}>
              <div>
                <strong>{note.created_at ? new Date(note.created_at).toLocaleString() : ""}</strong>
                <p>{note.message || note.note || ""}</p>
              </div>
              <button onClick={() => deleteNote(note.id)} style={dangerButton}>Delete Note</button>
            </div>
          ))
        )}
      </section>

      <section style={card}>
        <h2>Upload Files / Photos</h2>
        <input type="file" multiple onChange={(e) => setFiles(e.target.files)} style={input} />
        <button onClick={uploadFiles} style={button}>Upload Selected Files</button>
        {files && files.length > 0 ? <p>{files.length} file(s) selected.</p> : null}
      </section>

      <section style={card}>
        <h2>Files / Photos</h2>

        {assets.length === 0 ? (
          <p>No files uploaded yet.</p>
        ) : (
          assets.map((asset) => (
            <div key={asset.id} style={row}>
              <div>
                <strong>{asset.original_name || asset.file_name || "File"}</strong>
                <p>
                  {asset.mime_type || "file"} —{" "}
                  {asset.size_bytes ? `${Math.round(Number(asset.size_bytes) / 1024)} KB` : "unknown size"}
                </p>
                {asset.download_url ? (
                  <a href={`${API_BASE}${asset.download_url}`} target="_blank" rel="noreferrer" style={linkStyle}>Open File</a>
                ) : asset.url ? (
                  <a href={asset.url} target="_blank" rel="noreferrer" style={linkStyle}>Open File</a>
                ) : null}
              </div>

              <button onClick={() => deleteFile(asset.id)} style={dangerButton}>Delete File</button>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

const page: CSSProperties = { padding: 20, maxWidth: 1100, margin: "0 auto" }
const card: CSSProperties = { background: "#111827", color: "white", borderRadius: 14, padding: 20, marginBottom: 20 }
const sectionHeader: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }
const row: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 20, background: "#1f2937", borderRadius: 10, padding: 14, marginBottom: 10 }
const input: CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", padding: 10, marginBottom: 12 }
const textarea: CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", padding: 10, minHeight: 90, marginBottom: 12 }
const label: CSSProperties = { display: "block", marginBottom: 6 }
const checkRow: CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }
const buttonRow: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap" }
const button: CSSProperties = { padding: "10px 14px", cursor: "pointer" }
const dangerButton: CSSProperties = { padding: "10px 14px", cursor: "pointer", background: "#7f1d1d", color: "white", border: "none", borderRadius: 8 }
const linkStyle: CSSProperties = { color: "#93c5fd" }
const success: CSSProperties = { color: "#86efac" }
const danger: CSSProperties = { color: "#fca5a5" }
const hr: CSSProperties = { borderColor: "#374151", margin: "18px 0" }
