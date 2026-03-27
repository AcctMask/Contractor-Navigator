import { useEffect, useState } from "react"
import type { CSSProperties } from "react"
import { Link, useParams } from "react-router-dom"

const API_BASE = import.meta.env.VITE_API_BASE 
const TENANT = "g2g-roofing"

type Job = {
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
}

type Contact = {
  id: number
  full_name?: string | null
  phone?: string | null
  email?: string | null
  contact_role?: string | null
  is_primary?: boolean | null
}

type TimelineEvent = {
  id: number
  kind?: string | null
  message?: string | null
  created_at?: string | null
}

type AssetItem = {
  id: number
  asset_type: string
  original_name: string
  relative_path: string
  note?: string | null
}

function formatAddress(job?: Job | null) {
  if (!job) return "—"
  const parts = [job.address1, job.city, job.state, job.zip].filter(Boolean)
  return parts.length ? parts.join(", ") : "—"
}

function formatDate(value?: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

export default function JobDetailPage() {
  const { id } = useParams()
  const jobId = id ? Number(id) : null

  const [job, setJob] = useState<Job | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [assetType, setAssetType] = useState("photo")
  const [note, setNote] = useState("")
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(true)

  async function loadEverything() {
    if (!jobId) return

    const [jobRes, assetRes] = await Promise.all([
      fetch(`${API_BASE}/admin/job/${TENANT}/${jobId}`),
      fetch(`${API_BASE}/assets/${TENANT}/job/${jobId}`),
    ])

    const jobJson = await jobRes.json()
    const assetJson = await assetRes.json()

    if (jobJson.ok) {
      setJob(jobJson.job || null)
      setContacts(Array.isArray(jobJson.contacts) ? jobJson.contacts : [])
      setTimeline(Array.isArray(jobJson.timeline) ? jobJson.timeline : [])
    }

    if (assetJson.ok) {
      setAssets(Array.isArray(assetJson.assets) ? assetJson.assets : [])
    }
  }

  async function handleUpload() {
    if (!jobId || !selectedFile) return

    const form = new FormData()
    form.append("file", selectedFile)
    form.append("asset_type", assetType)
    form.append("note", note)
    form.append("uploaded_by", "team")

    const res = await fetch(`${API_BASE}/assets/${TENANT}/job/${jobId}/upload`, {
      method: "POST",
      body: form,
    })

    if (res.ok) {
      setStatus("Uploaded")
      setSelectedFile(null)
      setNote("")
      await loadEverything()
    } else {
      setStatus("Upload failed")
    }
  }

  useEffect(() => {
    async function init() {
      await loadEverything()
      setLoading(false)
    }
    init()
  }, [jobId])

  return (
    <div style={pageStyle}>
      <div style={wrapStyle}>
        <Link to="/job-admin" style={backLinkStyle}>← Back to Jobs</Link>

        {loading ? (
          <div style={cardStyle}>Loading...</div>
        ) : (
          <>
            <h1 style={headerStyle}>
              {job?.customer_name || "Unknown Customer"} · Job #{jobId}
            </h1>

            <section style={heroCardStyle}>
              <div style={heroGridStyle}>
                <div><strong>Address:</strong> {formatAddress(job)}</div>
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
                <div style={{ gridColumn: "1 / -1" }}>
                  <strong>Damage Summary:</strong> {job?.damage_summary || "—"}
                </div>
                <div><strong>Bot Paused:</strong> {job?.bot_paused ? "Yes" : "No"}</div>
              </div>
            </section>

            {status ? <div style={statusStyle}>{status}</div> : null}

            <div style={twoColStyle}>
              <section style={cardStyle}>
                <h2 style={sectionTitleStyle}>Upload File</h2>

                <select
                  value={assetType}
                  onChange={(e) => setAssetType(e.target.value)}
                  style={inputStyle}
                >
                  <option value="photo">photo</option>
                  <option value="inspection">inspection</option>
                  <option value="insurance_doc">insurance_doc</option>
                  <option value="contract">contract</option>
                  <option value="invoice">invoice</option>
                  <option value="other">other</option>
                </select>

                <input
                  type="file"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  style={inputStyle}
                />

                <input
                  placeholder="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={inputStyle}
                />

                <button onClick={handleUpload} style={primaryButtonStyle}>
                  Upload
                </button>
              </section>

              <section style={cardStyle}>
                <h2 style={sectionTitleStyle}>Files</h2>

                {assets.length ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    {assets.map((a) => (
                      <div key={a.id} style={fileRowStyle}>
                        <div style={{ fontWeight: 800 }}>{a.original_name}</div>
                        <div style={{ opacity: 0.8, marginBottom: 8 }}>
                          {a.asset_type}
                          {a.note ? ` · ${a.note}` : ""}
                        </div>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <a
                            href={`${API_BASE}/files/${a.relative_path}`}
                            target="_blank"
                            rel="noreferrer"
                            style={viewBtnStyle}
                          >
                            View
                          </a>
                          <a
                            href={`${API_BASE}/files/${a.relative_path}`}
                            download
                            style={downloadBtnStyle}
                          >
                            Download
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={mutedStyle}>No files yet.</div>
                )}
              </section>
            </div>

            <div style={twoColStyle}>
              <section style={cardStyle}>
                <h2 style={sectionTitleStyle}>Contacts</h2>
                {contacts.length ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    {contacts.map((c) => (
                      <div key={c.id} style={infoRowStyle}>
                        <div><strong>{c.full_name || "Unnamed Contact"}</strong></div>
                        <div>{c.contact_role || "contact"}</div>
                        <div>{c.phone || "—"}</div>
                        <div>{c.email || "—"}</div>
                        <div>{c.is_primary ? "Primary" : ""}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={mutedStyle}>No saved contacts yet.</div>
                )}
              </section>

              <section style={cardStyle}>
                <h2 style={sectionTitleStyle}>Timeline</h2>
                {timeline.length ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    {timeline.map((t) => (
                      <div key={t.id} style={infoRowStyle}>
                        <div style={{ fontWeight: 800 }}>{t.kind || "event"}</div>
                        <div>{t.message || "—"}</div>
                        <div style={mutedStyle}>{formatDate(t.created_at)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={mutedStyle}>No timeline yet.</div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#0b1d44",
  color: "#fff",
  padding: 24,
}

const wrapStyle: CSSProperties = {
  maxWidth: 1230,
  margin: "0 auto",
  display: "grid",
  gap: 22,
}

const backLinkStyle: CSSProperties = {
  color: "#fff",
  textDecoration: "none",
  fontWeight: 700,
}

const headerStyle: CSSProperties = {
  fontSize: 34,
  margin: 0,
}

const heroCardStyle: CSSProperties = {
  background: "#122c66",
  borderRadius: 20,
  padding: 22,
}

const heroGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 12,
  lineHeight: 1.5,
}

const twoColStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 20,
}

const cardStyle: CSSProperties = {
  background: "#122c66",
  borderRadius: 20,
  padding: 22,
}

const sectionTitleStyle: CSSProperties = {
  marginTop: 0,
  marginBottom: 16,
  fontSize: 22,
}

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: 12,
  borderRadius: 10,
  marginBottom: 10,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "#fff",
  color: "#111",
}

const primaryButtonStyle: CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  fontWeight: 700,
}

const statusStyle: CSSProperties = {
  background: "green",
  color: "#fff",
  padding: 10,
  borderRadius: 10,
  fontWeight: 700,
}

const fileRowStyle: CSSProperties = {
  background: "#1c3c88",
  borderRadius: 12,
  padding: 12,
}

const infoRowStyle: CSSProperties = {
  background: "#1c3c88",
  borderRadius: 12,
  padding: 12,
}

const mutedStyle: CSSProperties = {
  opacity: 0.8,
}

const viewBtnStyle: CSSProperties = {
  background: "#4aa8ff",
  padding: "6px 10px",
  borderRadius: 6,
  color: "#fff",
  textDecoration: "none",
  fontWeight: 700,
}

const downloadBtnStyle: CSSProperties = {
  background: "#22c55e",
  padding: "6px 10px",
  borderRadius: 6,
  color: "#fff",
  textDecoration: "none",
  fontWeight: 700,
}
