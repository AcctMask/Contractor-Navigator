import React, { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE?.replace(/\/$/, "") ||
  "https://contractor-navigator.onrender.com"

const TENANT_SLUG =
  (import.meta as any).env?.VITE_TENANT_SLUG || "g2g-roofing"

type Job = {
  id: number
  tenant_id?: number | null
  customer_name?: string | null
  customer_phone?: string | null
  customer_email?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  stage?: string | null
  crm_substatus?: string | null
  lead_source?: string | null
  lead_source_detail?: string | null
  carrier?: string | null
  claim_number?: string | null
  policy_holder?: string | null
  adjuster_name?: string | null
  adjuster_phone?: string | null
  adjuster_email?: string | null
  damage_location?: string | null
  damage_summary?: string | null
  bot_paused?: boolean | null
  last_human_note?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type TimelineItem = {
  id?: number
  kind?: string | null
  message?: string | null
  created_at?: string | null
  meta?: any
}

type ContactItem = {
  id?: number
  full_name?: string | null
  name?: string | null
  phone?: string | null
  email?: string | null
  contact_role?: string | null
  is_primary?: boolean | null
  created_at?: string | null
}

type FileItem = {
  id?: number
  kind?: string | null
  note?: string | null
  original_name?: string | null
  file_name?: string | null
  url?: string | null
  path?: string | null
  created_at?: string | null
}

function fmtDate(value?: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

function sectionCardStyle(): React.CSSProperties {
  return {
    background: "#173072",
    borderRadius: 24,
    padding: 20,
    color: "white",
    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
  }
}

function labelStyle(): React.CSSProperties {
  return {
    display: "block",
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 6,
    color: "#d7e5ff",
  }
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    outline: "none",
    fontSize: 15,
    boxSizing: "border-box",
  }
}

function buttonStyle(primary = false): React.CSSProperties {
  return {
    padding: "12px 18px",
    borderRadius: 14,
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 15,
    background: primary ? "#5da8ff" : "rgba(255,255,255,0.12)",
    color: "white",
  }
}

export default function JobDetail() {
  const { id } = useParams()
  const jobId = useMemo(() => Number(id), [id])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addingNote, setAddingNote] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [job, setJob] = useState<Job | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [files, setFiles] = useState<FileItem[]>([])

  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    stage: "lead",
    crm_substatus: "",
    lead_source: "",
    lead_source_detail: "",
    carrier: "",
    claim_number: "",
    policy_holder: "",
    adjuster_name: "",
    adjuster_phone: "",
    adjuster_email: "",
    damage_location: "",
    damage_summary: "",
    last_human_note: "",
  })

  const [noteForm, setNoteForm] = useState({
    note: "",
    author: "Steve",
  })

  const [uploadKind, setUploadKind] = useState("photo")
  const [uploadNote, setUploadNote] = useState("")
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  async function loadJob() {
    if (!jobId || Number.isNaN(jobId)) {
      setError("Invalid job id.")
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError("")
      setSuccess("")

      const res = await fetch(
        `${API_BASE}/admin/job/${TENANT_SLUG}/${jobId}`
      )
      const data = await res.json()

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Failed to load job ${jobId}`)
      }

      const nextJob: Job = data.job || null
      setJob(nextJob)
      setTimeline(Array.isArray(data.timeline) ? data.timeline : [])
      setContacts(Array.isArray(data.contacts) ? data.contacts : [])
      setFiles(Array.isArray(data.files) ? data.files : [])

      setForm({
        customer_name: nextJob?.customer_name || "",
        customer_phone: nextJob?.customer_phone || "",
        customer_email: nextJob?.customer_email || "",
        address: nextJob?.address || "",
        city: nextJob?.city || "",
        state: nextJob?.state || "",
        zip: nextJob?.zip || "",
        stage: nextJob?.stage || "lead",
        crm_substatus: nextJob?.crm_substatus || "",
        lead_source: nextJob?.lead_source || "",
        lead_source_detail: nextJob?.lead_source_detail || "",
        carrier: nextJob?.carrier || "",
        claim_number: nextJob?.claim_number || "",
        policy_holder: nextJob?.policy_holder || "",
        adjuster_name: nextJob?.adjuster_name || "",
        adjuster_phone: nextJob?.adjuster_phone || "",
        adjuster_email: nextJob?.adjuster_email || "",
        damage_location: nextJob?.damage_location || "",
        damage_summary: nextJob?.damage_summary || "",
        last_human_note: nextJob?.last_human_note || "",
      })
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadJob()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  async function saveChanges() {
    try {
      setSaving(true)
      setError("")
      setSuccess("")

      const res = await fetch(
        `${API_BASE}/admin/job/${TENANT_SLUG}/${jobId}/update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }
      )

      const data = await res.json()

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to save job changes")
      }

      setSuccess("Job updated.")
      await loadJob()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  async function addNote() {
    if (!noteForm.note.trim()) {
      setError("Enter a note first.")
      return
    }

    try {
      setAddingNote(true)
      setError("")
      setSuccess("")

      const res = await fetch(
        `${API_BASE}/admin/job/${TENANT_SLUG}/${jobId}/note`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            note: noteForm.note.trim(),
            author: noteForm.author.trim() || "Steve",
          }),
        }
      )

      const data = await res.json()

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to add note")
      }

      setNoteForm((prev) => ({ ...prev, note: "" }))
      setSuccess("Note added.")
      await loadJob()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setAddingNote(false)
    }
  }

  async function uploadSelectedFile() {
    if (!uploadFile) {
      setError("Choose a file first.")
      return
    }

    try {
      setUploading(true)
      setError("")
      setSuccess("")

      const fd = new FormData()
      fd.append("file", uploadFile)
      fd.append("kind", uploadKind)
      fd.append("note", uploadNote)

      const res = await fetch(
        `${API_BASE}/admin/job/${TENANT_SLUG}/${jobId}/upload`,
        {
          method: "POST",
          body: fd,
        }
      )

      const data = await res.json()

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Upload failed")
      }

      setUploadFile(null)
      setUploadNote("")
      setSuccess("File uploaded.")
      await loadJob()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#05215f",
          color: "white",
          padding: 32,
          fontFamily: "Inter, Arial, sans-serif",
        }}
      >
        Loading job…
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#05215f",
        color: "white",
        padding: 24,
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}>
          <Link
            to="/job-admin"
            style={{
              color: "#dce9ff",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            ← Back to Jobs
          </Link>
        </div>

        <h1 style={{ fontSize: 52, lineHeight: 1.05, margin: "0 0 18px 0" }}>
          {(job?.customer_name || "Unnamed Job") + ` · Job #${jobId}`}
        </h1>

        {error ? (
          <div
            style={{
              marginBottom: 14,
              background: "rgba(255,80,80,0.16)",
              color: "#ffd9d9",
              borderRadius: 14,
              padding: 12,
            }}
          >
            {error}
          </div>
        ) : null}

        {success ? (
          <div
            style={{
              marginBottom: 14,
              background: "rgba(80,180,120,0.18)",
              color: "#dbffe7",
              borderRadius: 14,
              padding: 12,
            }}
          >
            {success}
          </div>
        ) : null}

        <div style={{ ...sectionCardStyle(), marginBottom: 20 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 18,
            }}
          >
            <div><strong>Address:</strong> {[job?.address, job?.city, job?.state, job?.zip].filter(Boolean).join(", ") || "—"}</div>
            <div><strong>Stage:</strong> {job?.stage || "—"}</div>
            <div><strong>CRM Substatus:</strong> {job?.crm_substatus || "—"}</div>
            <div><strong>Phone:</strong> {job?.customer_phone || "—"}</div>

            <div><strong>Email:</strong> {job?.customer_email || "—"}</div>
            <div><strong>Lead Source:</strong> {job?.lead_source || "—"}</div>
            <div><strong>Lead Source Detail:</strong> {job?.lead_source_detail || "—"}</div>
            <div><strong>Carrier:</strong> {job?.carrier || "—"}</div>

            <div><strong>Claim #:</strong> {job?.claim_number || "—"}</div>
            <div><strong>Policy Holder:</strong> {job?.policy_holder || "—"}</div>
            <div><strong>Adjuster:</strong> {job?.adjuster_name || "—"}</div>
            <div><strong>Adjuster Phone:</strong> {job?.adjuster_phone || "—"}</div>

            <div><strong>Adjuster Email:</strong> {job?.adjuster_email || "—"}</div>
            <div><strong>Damage Location:</strong> {job?.damage_location || "—"}</div>
            <div style={{ gridColumn: "span 2" }}>
              <strong>Damage Summary:</strong> {job?.damage_summary || "—"}
            </div>

            <div><strong>Bot Paused:</strong> {job?.bot_paused ? "Yes" : "No"}</div>
            <div><strong>Updated:</strong> {fmtDate(job?.updated_at)}</div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 18,
            marginBottom: 18,
          }}
        >
          <div style={sectionCardStyle()}>
            <h2 style={{ marginTop: 0, fontSize: 34 }}>Edit Job / Customer</h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 14,
              }}
            >
              <div>
                <label style={labelStyle()}>Customer Name</label>
                <input
                  style={inputStyle()}
                  value={form.customer_name}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, customer_name: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>Phone</label>
                <input
                  style={inputStyle()}
                  value={form.customer_phone}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, customer_phone: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>Email</label>
                <input
                  style={inputStyle()}
                  value={form.customer_email}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, customer_email: e.target.value }))
                  }
                />
              </div>

              <div style={{ gridColumn: "span 3" }}>
                <label style={labelStyle()}>Address</label>
                <input
                  style={inputStyle()}
                  value={form.address}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, address: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>City</label>
                <input
                  style={inputStyle()}
                  value={form.city}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, city: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>State</label>
                <input
                  style={inputStyle()}
                  value={form.state}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, state: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>ZIP</label>
                <input
                  style={inputStyle()}
                  value={form.zip}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, zip: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>Stage</label>
                <input
                  style={inputStyle()}
                  value={form.stage}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, stage: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>CRM Substatus</label>
                <input
                  style={inputStyle()}
                  value={form.crm_substatus}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, crm_substatus: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>Lead Source</label>
                <input
                  style={inputStyle()}
                  value={form.lead_source}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, lead_source: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>Lead Source Detail</label>
                <input
                  style={inputStyle()}
                  value={form.lead_source_detail}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, lead_source_detail: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>Carrier</label>
                <input
                  style={inputStyle()}
                  value={form.carrier}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, carrier: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>Claim #</label>
                <input
                  style={inputStyle()}
                  value={form.claim_number}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, claim_number: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>Policy Holder</label>
                <input
                  style={inputStyle()}
                  value={form.policy_holder}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, policy_holder: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>Adjuster</label>
                <input
                  style={inputStyle()}
                  value={form.adjuster_name}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, adjuster_name: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>Adjuster Phone</label>
                <input
                  style={inputStyle()}
                  value={form.adjuster_phone}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, adjuster_phone: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>Adjuster Email</label>
                <input
                  style={inputStyle()}
                  value={form.adjuster_email}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, adjuster_email: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>Damage Location</label>
                <input
                  style={inputStyle()}
                  value={form.damage_location}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, damage_location: e.target.value }))
                  }
                />
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <label style={labelStyle()}>Last Human Note</label>
                <input
                  style={inputStyle()}
                  value={form.last_human_note}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, last_human_note: e.target.value }))
                  }
                />
              </div>

              <div style={{ gridColumn: "span 3" }}>
                <label style={labelStyle()}>Damage Summary</label>
                <textarea
                  style={{ ...inputStyle(), minHeight: 110, resize: "vertical" }}
                  value={form.damage_summary}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, damage_summary: e.target.value }))
                  }
                />
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                style={buttonStyle(true)}
                onClick={saveChanges}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 18 }}>
            <div style={sectionCardStyle()}>
              <h2 style={{ marginTop: 0, fontSize: 34 }}>Add Note</h2>

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle()}>Author</label>
                <input
                  style={inputStyle()}
                  value={noteForm.author}
                  onChange={(e) =>
                    setNoteForm((p) => ({ ...p, author: e.target.value }))
                  }
                />
              </div>

              <div>
                <label style={labelStyle()}>Note</label>
                <textarea
                  style={{ ...inputStyle(), minHeight: 150, resize: "vertical" }}
                  value={noteForm.note}
                  onChange={(e) =>
                    setNoteForm((p) => ({ ...p, note: e.target.value }))
                  }
                />
              </div>

              <div style={{ marginTop: 16 }}>
                <button
                  type="button"
                  style={buttonStyle(true)}
                  onClick={addNote}
                  disabled={addingNote}
                >
                  {addingNote ? "Adding..." : "Add Note"}
                </button>
              </div>
            </div>

            <div style={sectionCardStyle()}>
              <h2 style={{ marginTop: 0, fontSize: 34 }}>Upload File</h2>

              <div style={{ marginBottom: 12 }}>
                <select
                  style={inputStyle()}
                  value={uploadKind}
                  onChange={(e) => setUploadKind(e.target.value)}
                >
                  <option value="photo">photo</option>
                  <option value="document">document</option>
                  <option value="contract">contract</option>
                  <option value="inspection">inspection</option>
                  <option value="other">other</option>
                </select>
              </div>

              <div style={{ marginBottom: 12 }}>
                <input
                  type="file"
                  style={inputStyle()}
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <input
                  style={inputStyle()}
                  placeholder="note"
                  value={uploadNote}
                  onChange={(e) => setUploadNote(e.target.value)}
                />
              </div>

              <button
                type="button"
                style={buttonStyle(true)}
                onClick={uploadSelectedFile}
                disabled={uploading}
              >
                {uploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 18,
          }}
        >
          <div style={sectionCardStyle()}>
            <h2 style={{ marginTop: 0, fontSize: 34 }}>Contacts</h2>
            {contacts.length === 0 ? (
              <div style={{ opacity: 0.9 }}>No saved contacts yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {contacts.map((c, idx) => (
                  <div
                    key={c.id ?? idx}
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      borderRadius: 16,
                      padding: 14,
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>
                      {c.full_name || c.name || "Unnamed Contact"}
                    </div>
                    <div>Role: {c.contact_role || "—"}</div>
                    <div>Phone: {c.phone || "—"}</div>
                    <div>Email: {c.email || "—"}</div>
                    <div>Primary: {c.is_primary ? "Yes" : "No"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={sectionCardStyle()}>
            <h2 style={{ marginTop: 0, fontSize: 34 }}>Files</h2>
            {files.length === 0 ? (
              <div style={{ opacity: 0.9 }}>No files yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {files.map((f, idx) => (
                  <div
                    key={f.id ?? idx}
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      borderRadius: 16,
                      padding: 14,
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>
                      {f.original_name || f.file_name || "File"}
                    </div>
                    <div>Kind: {f.kind || "—"}</div>
                    <div>Note: {f.note || "—"}</div>
                    <div>Added: {fmtDate(f.created_at)}</div>
                    {f.url || f.path ? (
                      <div style={{ marginTop: 8 }}>
                        <a
                          href={f.url || f.path || "#"}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#a9cbff", fontWeight: 700 }}
                        >
                          Open file
                        </a>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ ...sectionCardStyle(), marginTop: 18 }}>
          <h2 style={{ marginTop: 0, fontSize: 34 }}>Timeline</h2>
          {timeline.length === 0 ? (
            <div style={{ opacity: 0.9 }}>No timeline yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {timeline.map((item, idx) => (
                <div
                  key={item.id ?? idx}
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    borderRadius: 16,
                    padding: 14,
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>
                    {item.kind || "event"}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>
                    {item.message || "—"}
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 13,
                      color: "#d6e5ff",
                    }}
                  >
                    {fmtDate(item.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
