import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"

const API_BASE = "http://localhost:8787"
const TENANT = "g2g-roofing"

type JobRecord = {
  id: number | string
  stage?: string | null
  crm_substatus?: string | null
  address1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  bot_paused?: boolean | null
  dnc?: boolean | null
  customer_name?: string | null
  customer_phone?: string | null
  customer_email?: string | null
  claim_number?: string | null
  assignment_notes?: string | null
  last_human_note?: string | null
  lead_source?: string | null
  lead_source_detail?: string | null
  marketing_campaign?: string | null
  carrier?: string | null
  policy_holder?: string | null
  adjuster_name?: string | null
  adjuster_phone?: string | null
  adjuster_email?: string | null
  assignment_subject?: string | null
  damage_location?: string | null
  damage_summary?: string | null
  crm_flow_key?: string | null
}

type TimelineItem = {
  id?: number
  kind?: string
  message?: string
  meta?: any
  created_at?: string
}

type ContactItem = {
  id?: number
  contact_role?: string | null
  full_name?: string | null
  phone?: string | null
  email?: string | null
  is_primary?: boolean | null
}

type AdminJobResponse = {
  ok: boolean
  tenant_id?: number
  job?: JobRecord
  contacts?: ContactItem[]
  timeline?: TimelineItem[]
}

type ConversationItem = {
  id?: number
  kind?: string
  message?: string
  created_at?: string
}

type ConversationResponse = {
  ok: boolean
  conversation?: ConversationItem[]
}

type ControlResponse = {
  ok: boolean
  job?: {
    id: string
    tenant_id: string
    customer_id: string | null
    stage?: string | null
    crm_substatus?: string | null
    crm_flow_key?: string | null
    bot_paused?: boolean | null
    address1?: string | null
    city?: string | null
    state?: string | null
    zip?: string | null
    customer_name?: string | null
    customer_phone?: string | null
    is_dnc?: boolean
  }
}

function formatAddress(job?: JobRecord | null) {
  if (!job) return "—"
  return [job.address1, job.city, job.state, job.zip].filter(Boolean).join(", ") || "—"
}

function formatDate(value?: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

function prettyKind(value?: string | null) {
  if (!value) return "Activity"
  return value.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
}

export default function JobDetailPage() {
  const { id } = useParams()
  const jobId = id ? Number(id) : null

  const [job, setJob] = useState<JobRecord | null>(null)
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [conversation, setConversation] = useState<ConversationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [status, setStatus] = useState("")

  const [isDnc, setIsDnc] = useState(false)

  const [note, setNote] = useState("")
  const [savingNote, setSavingNote] = useState(false)

  const [contactName, setContactName] = useState("")
  const [contactPhone, setContactPhone] = useState("")
  const [contactEmail, setContactEmail] = useState("")
  const [contactRole, setContactRole] = useState("secondary")
  const [savingContact, setSavingContact] = useState(false)

  const [stage, setStage] = useState("")
  const [savingStage, setSavingStage] = useState(false)

  const [claimNumber, setClaimNumber] = useState("")
  const [assignmentNotes, setAssignmentNotes] = useState("")
  const [carrier, setCarrier] = useState("")
  const [policyHolder, setPolicyHolder] = useState("")
  const [adjusterName, setAdjusterName] = useState("")
  const [adjusterPhone, setAdjusterPhone] = useState("")
  const [adjusterEmail, setAdjusterEmail] = useState("")
  const [assignmentSubject, setAssignmentSubject] = useState("")
  const [damageLocation, setDamageLocation] = useState("")
  const [damageSummary, setDamageSummary] = useState("")
  const [savingClaim, setSavingClaim] = useState(false)

  async function loadAll() {
    if (!jobId) {
      setError("Invalid job ID")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")

    try {
      const [adminRes, convoRes, controlRes] = await Promise.all([
        fetch(`${API_BASE}/admin/job/${TENANT}/${jobId}`),
        fetch(`${API_BASE}/ai/conversation/${TENANT}/${jobId}`),
        fetch(`${API_BASE}/admin/${TENANT}/jobs/${jobId}/control`),
      ])

      const adminJson: AdminJobResponse = await adminRes.json()
      const convoJson: ConversationResponse = await convoRes.json()
      const controlJson: ControlResponse = await controlRes.json()

      if (!adminRes.ok || !adminJson.ok || !adminJson.job) {
        throw new Error((adminJson as any)?.error || "Failed to load job")
      }

      const loadedJob = adminJson.job
      const controlJob = controlJson?.job

      setJob({
        ...loadedJob,
        stage: controlJob?.stage ?? loadedJob.stage,
        crm_substatus: controlJob?.crm_substatus ?? loadedJob.crm_substatus,
        crm_flow_key: controlJob?.crm_flow_key ?? loadedJob.crm_flow_key,
        bot_paused:
          typeof controlJob?.bot_paused === "boolean"
            ? controlJob.bot_paused
            : loadedJob.bot_paused,
      })

      setIsDnc(!!controlJob?.is_dnc)

      setContacts(Array.isArray(adminJson.contacts) ? adminJson.contacts : [])
      setTimeline(Array.isArray(adminJson.timeline) ? adminJson.timeline : [])
      setConversation(Array.isArray(convoJson.conversation) ? convoJson.conversation : [])

      setStage((controlJob?.stage as string) || loadedJob.stage || "")
      setClaimNumber(loadedJob.claim_number || "")
      setAssignmentNotes(loadedJob.assignment_notes || "")
      setCarrier(loadedJob.carrier || "")
      setPolicyHolder(loadedJob.policy_holder || "")
      setAdjusterName(loadedJob.adjuster_name || "")
      setAdjusterPhone(loadedJob.adjuster_phone || "")
      setAdjusterEmail(loadedJob.adjuster_email || "")
      setAssignmentSubject(loadedJob.assignment_subject || "")
      setDamageLocation(loadedJob.damage_location || "")
      setDamageSummary(loadedJob.damage_summary || "")
    } catch (err: any) {
      setError(err?.message || "Failed to load job")
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveNote() {
    if (!jobId || !note.trim()) return

    setSavingNote(true)
    setStatus("")
    setError("")

    try {
      const res = await fetch(`${API_BASE}/admin/job/${TENANT}/${jobId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: note.trim(),
          author: "team",
        }),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(json?.error || "Failed to save note")
      }

      setNote("")
      setStatus("Note saved")
      await loadAll()
    } catch (err: any) {
      setError(err?.message || "Failed to save note")
    } finally {
      setSavingNote(false)
    }
  }

  async function handleSaveContact() {
    if (!jobId) return

    if (!contactName.trim() && !contactPhone.trim() && !contactEmail.trim()) {
      setError("Enter at least a name, phone, or email for the contact")
      return
    }

    setSavingContact(true)
    setStatus("")
    setError("")

    try {
      const res = await fetch(`${API_BASE}/admin/job/${TENANT}/${jobId}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: contactName.trim() || null,
          phone: contactPhone.trim() || null,
          email: contactEmail.trim() || null,
          contact_role: contactRole,
          is_primary: false,
        }),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(json?.error || "Failed to save contact")
      }

      setContactName("")
      setContactPhone("")
      setContactEmail("")
      setContactRole("secondary")
      setStatus("Contact saved")
      await loadAll()
    } catch (err: any) {
      setError(err?.message || "Failed to save contact")
    } finally {
      setSavingContact(false)
    }
  }

  async function handleUpdateStage() {
    if (!jobId || !stage) return

    setSavingStage(true)
    setStatus("")
    setError("")

    try {
      const res = await fetch(`${API_BASE}/admin/${TENANT}/jobs/${jobId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          crm_substatus: job?.crm_substatus || null,
          bot_paused: job?.bot_paused ?? null,
        }),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(json?.error || "Failed to update stage")
      }

      setStatus("Stage updated")
      await loadAll()
    } catch (err: any) {
      setError(err?.message || "Failed to update stage")
    } finally {
      setSavingStage(false)
    }
  }

  async function handleToggleDnc() {
    if (!jobId) return

    setStatus("")
    setError("")

    try {
      const res = await fetch(`${API_BASE}/admin/${TENANT}/jobs/${jobId}/dnc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_dnc: !isDnc,
          note: isDnc ? "Removed DNC from full job view" : "Marked DNC from full job view",
        }),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(json?.error || "Failed to update DNC")
      }

      setStatus(isDnc ? "DNC removed" : "Customer marked DNC")
      await loadAll()
    } catch (err: any) {
      setError(err?.message || "Failed to update DNC")
    }
  }

  async function handleSaveClaim() {
    if (!jobId) return

    setSavingClaim(true)
    setStatus("")
    setError("")

    try {
      const res = await fetch(`${API_BASE}/admin/job/${TENANT}/${jobId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_number: claimNumber || null,
          assignment_notes: assignmentNotes || null,
          carrier: carrier || null,
          policy_holder: policyHolder || null,
          adjuster_name: adjusterName || null,
          adjuster_phone: adjusterPhone || null,
          adjuster_email: adjusterEmail || null,
          assignment_subject: assignmentSubject || null,
          damage_location: damageLocation || null,
          damage_summary: damageSummary || null,
        }),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(json?.error || "Failed to save claim data")
      }

      setStatus("Claim data saved")
      await loadAll()
    } catch (err: any) {
      setError(err?.message || "Failed to save claim data")
    } finally {
      setSavingClaim(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [jobId])

  const mergedHistory = useMemo(() => {
    const convoMapped = conversation.map((item, idx) => ({
      key: `convo-${item.id ?? idx}`,
      kind: item.kind || "conversation",
      message: item.message || "",
      created_at: item.created_at || "",
    }))

    const timelineMapped = timeline.map((item, idx) => ({
      key: `timeline-${item.id ?? idx}`,
      kind: item.kind || "timeline",
      message: item.message || "",
      created_at: item.created_at || "",
    }))

    return [...timelineMapped, ...convoMapped].sort((a, b) => {
      const ad = new Date(a.created_at).getTime()
      const bd = new Date(b.created_at).getTime()
      return bd - ad
    })
  }, [timeline, conversation])

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>Loading...</div>
      </div>
    )
  }

  if (error && !job) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={errorStyle}>{error}</div>
          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link to="/job-admin" style={secondaryLinkStyle}>
              ← Back to Jobs
            </Link>
            <Link to="/" style={secondaryLinkStyle}>
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link to="/job-admin" style={secondaryLinkStyle}>
              ← Back to Jobs
            </Link>
            <Link to="/" style={secondaryLinkStyle}>
              Dashboard
            </Link>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={buttonStyle} onClick={handleToggleDnc}>
              {isDnc ? "Remove DNC" : "Mark DNC"}
            </button>
            <button style={mutedButtonStyle} type="button">
              Send Text
            </button>
            <button style={mutedButtonStyle} type="button">
              Send Email
            </button>
          </div>
        </div>

        {status ? <div style={successStyle}>{status}</div> : null}
        {error ? <div style={errorStyle}>{error}</div> : null}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <section style={cardStyle}>
            <h1 style={{ marginTop: 0, fontSize: 44 }}>
              {job?.customer_name || `Job #${job?.id}`}
            </h1>
            <div style={{ fontSize: 18, opacity: 0.82, marginBottom: 18 }}>
              Operator console for this job
            </div>

            <div style={infoGridStyle}>
              <div style={labelCell}>Job ID</div>
              <div>{job?.id ?? "—"}</div>

              <div style={labelCell}>Stage</div>
              <div>{job?.stage || "—"}</div>

              <div style={labelCell}>CRM Substatus</div>
              <div>{job?.crm_substatus || "—"}</div>

              <div style={labelCell}>CRM Flow Key</div>
              <div>{job?.crm_flow_key || "—"}</div>

              <div style={labelCell}>Customer</div>
              <div>{job?.customer_name || "—"}</div>

              <div style={labelCell}>Phone</div>
              <div>{job?.customer_phone || "—"}</div>

              <div style={labelCell}>Email</div>
              <div>{job?.customer_email || "—"}</div>

              <div style={labelCell}>Address</div>
              <div>{formatAddress(job)}</div>

              <div style={labelCell}>Claim Number</div>
              <div>{job?.claim_number || "—"}</div>

              <div style={labelCell}>Carrier</div>
              <div>{job?.carrier || "—"}</div>

              <div style={labelCell}>Policy Holder</div>
              <div>{job?.policy_holder || "—"}</div>

              <div style={labelCell}>Adjuster</div>
              <div>{job?.adjuster_name || "—"}</div>

              <div style={labelCell}>Adjuster Phone</div>
              <div>{job?.adjuster_phone || "—"}</div>

              <div style={labelCell}>Adjuster Email</div>
              <div>{job?.adjuster_email || "—"}</div>

              <div style={labelCell}>Lead Source</div>
              <div>{job?.lead_source || "—"}</div>

              <div style={labelCell}>Source Detail</div>
              <div>{job?.lead_source_detail || "—"}</div>

              <div style={labelCell}>Campaign</div>
              <div>{job?.marketing_campaign || "—"}</div>

              <div style={labelCell}>Bot Paused</div>
              <div>{job?.bot_paused ? "Yes" : "No"}</div>

              <div style={labelCell}>DNC</div>
              <div>{isDnc ? "Yes" : "No"}</div>

              <div style={labelCell}>Last Human Note</div>
              <div>{job?.last_human_note || "—"}</div>
            </div>

            <hr style={dividerStyle} />

            <h2>Stage Control</h2>
            <div style={{ display: "grid", gap: 12 }}>
              <select value={stage} onChange={(e) => setStage(e.target.value)} style={inputStyle}>
                <option value="lead">lead</option>
                <option value="work_auth_sent">work_auth_sent</option>
                <option value="estimate_sent">estimate_sent</option>
                <option value="contract_sent">contract_sent</option>
                <option value="job_final_paid">job_final_paid</option>
                <option value="won">won</option>
                <option value="lost">lost</option>
                <option value="production">production</option>
                <option value="completed">completed</option>
                <option value="dnc">dnc</option>
              </select>
              <div>
                <button onClick={handleUpdateStage} style={buttonStyle} disabled={savingStage}>
                  {savingStage ? "Updating..." : "Update Stage"}
                </button>
              </div>
            </div>
          </section>

          <section style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Add Note</h2>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a manual note for this job..."
              style={textareaStyle}
            />
            <div style={{ marginTop: 12 }}>
              <button onClick={handleSaveNote} style={buttonStyle} disabled={savingNote}>
                {savingNote ? "Saving..." : "Save Note"}
              </button>
            </div>

            <hr style={dividerStyle} />

            <h2>Additional Contact</h2>
            <div style={{ display: "grid", gap: 12 }}>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Full name"
                style={inputStyle}
              />
              <input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="Phone"
                style={inputStyle}
              />
              <input
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Email"
                style={inputStyle}
              />
              <select
                value={contactRole}
                onChange={(e) => setContactRole(e.target.value)}
                style={inputStyle}
              >
                <option value="secondary">secondary</option>
                <option value="billing">billing</option>
                <option value="adjuster">adjuster</option>
                <option value="office">office</option>
              </select>
              <div>
                <button onClick={handleSaveContact} style={buttonStyle} disabled={savingContact}>
                  {savingContact ? "Saving..." : "Save Contact"}
                </button>
              </div>
            </div>

            <hr style={dividerStyle} />

            <h2>Claim / Assignment</h2>
            <div style={{ display: "grid", gap: 12 }}>
              <input
                value={claimNumber}
                onChange={(e) => setClaimNumber(e.target.value)}
                placeholder="Claim number"
                style={inputStyle}
              />
              <input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="Carrier"
                style={inputStyle}
              />
              <input
                value={policyHolder}
                onChange={(e) => setPolicyHolder(e.target.value)}
                placeholder="Policy holder"
                style={inputStyle}
              />
              <input
                value={adjusterName}
                onChange={(e) => setAdjusterName(e.target.value)}
                placeholder="Adjuster name"
                style={inputStyle}
              />
              <input
                value={adjusterPhone}
                onChange={(e) => setAdjusterPhone(e.target.value)}
                placeholder="Adjuster phone"
                style={inputStyle}
              />
              <input
                value={adjusterEmail}
                onChange={(e) => setAdjusterEmail(e.target.value)}
                placeholder="Adjuster email"
                style={inputStyle}
              />
              <input
                value={assignmentSubject}
                onChange={(e) => setAssignmentSubject(e.target.value)}
                placeholder="Assignment subject"
                style={inputStyle}
              />
              <input
                value={damageLocation}
                onChange={(e) => setDamageLocation(e.target.value)}
                placeholder="Damage location"
                style={inputStyle}
              />
              <textarea
                value={assignmentNotes}
                onChange={(e) => setAssignmentNotes(e.target.value)}
                placeholder="Assignment notes / adjuster notes / scope notes"
                style={textareaStyle}
              />
              <textarea
                value={damageSummary}
                onChange={(e) => setDamageSummary(e.target.value)}
                placeholder="Damage summary"
                style={textareaStyle}
              />
              <div>
                <button onClick={handleSaveClaim} style={buttonStyle} disabled={savingClaim}>
                  {savingClaim ? "Saving..." : "Save Claim Data"}
                </button>
              </div>
            </div>
          </section>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 20 }}>
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Saved Contacts</h2>
            {contacts.length ? (
              <div style={{ display: "grid", gap: 12 }}>
                {contacts.map((contact, idx) => (
                  <div key={`${contact.id ?? idx}`} style={rowStyle}>
                    <div><strong>{contact.full_name || "Unnamed Contact"}</strong></div>
                    <div>Role: {contact.contact_role || "—"}</div>
                    <div>Phone: {contact.phone || "—"}</div>
                    <div>Email: {contact.email || "—"}</div>
                    <div>Primary: {contact.is_primary ? "Yes" : "No"}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div>No additional contacts saved yet.</div>
            )}
          </section>

          <section style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Full History</h2>
            <div style={{ color: "#a8bddf", marginBottom: 14 }}>
              Timeline events + AI conversation, newest first
            </div>

            {mergedHistory.length ? (
              <div style={{ display: "grid", gap: 12 }}>
                {mergedHistory.map((item) => (
                  <div key={item.key} style={historyCardStyle}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        opacity: 0.8,
                        textTransform: "uppercase",
                      }}
                    >
                      {prettyKind(item.kind)}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, marginTop: 6 }}>
                      {item.message || "—"}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                      {formatDate(item.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div>No history yet.</div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background:
    "linear-gradient(135deg, rgba(0,25,70,1) 0%, rgba(2,18,47,1) 45%, rgba(8,42,102,1) 100%)",
  color: "#e8eefc",
  padding: 28,
}

const cardStyle: React.CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(81, 133, 255, 0.25)",
  borderRadius: 24,
  padding: 24,
}

const rowStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 14,
}

const historyCardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 16,
}

const buttonStyle: React.CSSProperties = {
  color: "#fff",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  border: "none",
  padding: "12px 18px",
  borderRadius: 14,
  cursor: "pointer",
  fontWeight: 700,
}

const mutedButtonStyle: React.CSSProperties = {
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "12px 18px",
  borderRadius: 14,
  cursor: "pointer",
  fontWeight: 700,
}

const secondaryLinkStyle: React.CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "10px 16px",
  borderRadius: 14,
  display: "inline-block",
  fontWeight: 700,
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  color: "#e8eefc",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: "14px 16px",
  fontSize: 16,
  outline: "none",
}

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 110,
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  color: "#e8eefc",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: "14px 16px",
  fontSize: 16,
  outline: "none",
  resize: "vertical",
}

const infoGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "170px 1fr",
  rowGap: 12,
  columnGap: 12,
  fontSize: 18,
}

const labelCell: React.CSSProperties = {
  opacity: 0.78,
  fontWeight: 700,
}

const dividerStyle: React.CSSProperties = {
  border: 0,
  borderTop: "1px solid rgba(255,255,255,0.10)",
  margin: "22px 0",
}

const successStyle: React.CSSProperties = {
  background: "rgba(30, 122, 84, 0.20)",
  border: "1px solid rgba(101, 216, 169, 0.25)",
  color: "#d8ffec",
  borderRadius: 14,
  padding: "12px 14px",
}

const errorStyle: React.CSSProperties = {
  background: "rgba(150, 30, 30, 0.22)",
  border: "1px solid rgba(255, 120, 120, 0.35)",
  color: "#ffd1d1",
  borderRadius: 14,
  padding: "12px 14px",
}
