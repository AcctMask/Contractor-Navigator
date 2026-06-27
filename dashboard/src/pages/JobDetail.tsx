import { useEffect, useState, type CSSProperties } from "react"
import { Link, useParams } from "react-router-dom"
import { getMe, type AuthUser } from "../lib/auth"

const API_BASE = import.meta.env.VITE_API_BASE || "https://contractor-navigator.onrender.com"
const TENANT = "g2g-roofing"

const STAGES = [
  "intake_pending", "lead", "callback", "inspection", "roof_repair", "roof_replacement", "tarp",
  "estimate_sent", "contract_sent", "pre_production", "in_production",
  "completed", "tarp_complete", "invoiced", "paid", "disqualified", "dnc",
]

export default function JobDetail() {
  const { id } = useParams()

  const [job, setJob] = useState<any>(null)
  const [assets, setAssets] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [files, setFiles] = useState<FileList | null>(null)
  const [uploadCategory, setUploadCategory] = useState("Documents")
  const [noteText, setNoteText] = useState("")
  const [smsText, setSmsText] = useState("")
  const [stage, setStage] = useState("lead")
  const [crmSubstatus, setCrmSubstatus] = useState("")
  const [botPaused, setBotPaused] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
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
  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<any>({})
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [calendarEvents, setCalendarEvents] = useState<any[]>([])

  async function loadJob() {
    if (!id) return

    const res = await fetch(`${API_BASE}/admin/job/${TENANT}/${id}`)
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

    const jobTimelineNotes = (data.timeline || []).filter((event: any) =>
      [
        "manual_note",
        "staff_note",
        "estimate_details",
        "lead_created",
        "lead_intent_classified",
        "ai_message_sent",
        "ai_inbound_response_sent",
        "ai_message_skipped",
        "customer_reply",
        "customer_reply_alert_routed",
        "sales_intent_detected",
        "high_intent_alert_routed",
        "voice_intake_alert_routed",
        "voice_ai_response_spoken",
        "voice_followup_sms_sent",
        "job_manually_updated",
        "job_archived",
        "document_package_sent",
        "document_package_signed",
      ].includes(String(event.kind || "").toLowerCase())
    )

    setNotes(jobTimelineNotes)
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
  }

  function setField(field: string, value: string) {
    setForm((prev: any) => {
      const next = { ...prev, [field]: value }

      if (field === "address1") {
        next.address = value
      }

      return next
    })
  }

  function setCalendarField(eventId: number | string, field: string, value: string) {
    setCalendarEvents((prev) =>
      prev.map((event) => {
        if (String(event.id) !== String(eventId)) return event

        const updated = { ...event, [field]: value }

        if (field === "start_time" && value) {
          const startDate = new Date(value)
          const currentEnd = event.end_time ? new Date(event.end_time) : null
          const previousStart = event.start_time ? new Date(event.start_time) : null

          const shouldDefaultEnd =
            !event.end_time ||
            (currentEnd && previousStart && currentEnd.getTime() <= previousStart.getTime())

          if (!Number.isNaN(startDate.getTime()) && shouldDefaultEnd) {
            const endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
            updated.end_time = new Date(endDate.getTime() - endDate.getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16)
          }
        }

        return updated
      })
    )
  }

  function toDateTimeLocal(value: string | null | undefined) {
    if (!value) return ""
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ""
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  }

  async function loadCalendarEvents() {
    if (!id) return

    const res = await fetch(`${API_BASE}/calendar/${TENANT}/events`)
    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data?.error || "Failed to load calendar events")
      return
    }

    const linked = (data.events || [])
      .filter((event: any) => String(event.job_id || "") === String(id))
      .map((event: any) => ({
        ...event,
        start_time: toDateTimeLocal(event.start_time),
        end_time: toDateTimeLocal(event.end_time),
      }))

    setCalendarEvents(linked)
  }

  async function saveCalendarEvent(event: any) {
    setError("")
    setStatus("Saving calendar event...")

    const res = await fetch(`${API_BASE}/calendar/${TENANT}/events/${event.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: event.title,
        start_time: event.start_time,
        end_time: event.end_time,
        location: event.location,
        notes: event.notes,
        event_type: event.event_type,
      }),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setStatus("")
      errorToast(data?.error || "Calendar update failed")
      return
    }

    successToast("Calendar event saved")
    await loadCalendarEvents()
  }

  function getActivityLabel(item: any) {
    const kind = String(item?.kind || "").toLowerCase()
    const meta = item?.meta || {}

    if (!kind) return meta.author ? `Team Note — ${meta.author}` : "Team Note"
    if (meta.note_type === "manual_sms_sent" || meta.channel === "sms") return "Staff SMS"
    if (kind.includes("manual_sms")) return "Staff SMS"
    if (kind.includes("staff_note")) return "Staff Note"
    if (kind.includes("ai_message") || kind.includes("ai_inbound") || kind.includes("voice_ai")) return "AI Follow-Up Engine"
    if (kind.includes("customer_reply")) return "Customer Reply"
    if (kind.includes("estimate_details")) return "Estimate Details"
    if (kind.includes("lead_intent")) return "Lead Qualification"
    if (kind.includes("lead_created")) return "Lead Created"
    if (kind.includes("voice")) return "Voice Intake"
    if (kind.includes("job_manually_updated")) return "Manual Update"
    if (kind.includes("job_archived")) return "Archived"
    if (kind.includes("alert")) return "Owner Alert"
    if (kind.includes("sales_intent")) return "Sales Intent"
    if (kind.includes("manual_note") || kind.includes("staff_note"))
      return meta.author ? `Team Note — ${meta.author}` : "Team Note"

    return kind.replaceAll("_", " ").toUpperCase()
  }

  function getActivityBadgeStyle(item: any): CSSProperties {
    const label = getActivityLabel(item).toLowerCase()

    if (label.includes("ai")) return { ...badge, background: "#1d4ed8" }
    if (label.includes("customer")) return { ...badge, background: "#047857" }
    if (label.includes("team")) return { ...badge, background: "#6d28d9" }
    if (label.includes("estimate")) return { ...badge, background: "#b45309" }
    if (label.includes("alert")) return { ...badge, background: "#be123c" }
    return badge
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
      errorToast(data?.error || "Save failed")
      return
    }

    successToast("Customer / claim data saved")
    setIsEditing(false)
    await loadJob()
  }

  async function archiveCustomerFile() {
    if (!id) return

    const ok = window.confirm(
      "Archive this customer file? This will remove it from the active dashboard, pause the bot, and cancel pending follow-ups for this job."
    )

    if (!ok) return

    setError("")
    setStatus("Archiving customer file...")

    const res = await fetch(`${API_BASE}/admin/job/${TENANT}/${id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Archived from Job Detail screen" }),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setStatus("")
      errorToast(data?.error || "Archive failed")
      return
    }

    successToast("Customer file archived and follow-ups cancelled")
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
      errorToast(data?.error || "Save stage failed")
      return
    }

    successToast("Stage saved")
    await loadJob()
  }

  async function applyIntakeDecision(nextStage: string, note: string) {
    if (!id) return

    setError("")
    setStatus("Saving intake decision...")

    const res = await fetch(`${API_BASE}/admin/job/${TENANT}/${id}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: nextStage,
        note,
      }),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setStatus("")
      errorToast(data?.error || "Intake decision failed")
      return
    }

    setStage(nextStage)
    successToast("Intake decision saved")
    await loadJob()
  }

  async function sendManualSms() {
    if (!id) return
    if (!smsText.trim()) {
      errorToast("Type a text message first")
      return
    }

    setError("")
    setStatus("Sending text...")

    const res = await fetch(`${API_BASE}/assets/${TENANT}/job/${id}/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: smsText,
        author: currentUser?.full_name || currentUser?.email || "Team",
      }),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setStatus("")
      errorToast(data?.error || "Send text failed")
      return
    }

    setSmsText("")
    successToast("Text sent")
    await loadJob()
  }

  async function addNote() {
    if (!id) return
    if (!noteText.trim()) {
      errorToast("Type a note first")
      return
    }

    setError("")
    setStatus("Adding note...")

    const res = await fetch(`${API_BASE}/assets/${TENANT}/job/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: noteText,
        author: currentUser?.full_name || currentUser?.email || "Team",
      }),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setStatus("")
      errorToast(data?.error || "Add note failed")
      return
    }

    setNoteText("")
    successToast("Note added")
    await loadJob()
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
      errorToast(data?.error || "Delete note failed")
      return
    }

    successToast("Note deleted")
    await loadAssets()
  }

  async function uploadFiles() {
    if (!id || !files || files.length === 0) {
      errorToast("Choose one or more files first")
      return
    }

    const selectedFiles = Array.from(files)
    const totalBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0)
    const totalMb = totalBytes / 1024 / 1024

    if (totalMb > 100) {
      errorToast(`Selected files total ${totalMb.toFixed(1)} MB. Current upload limit is 100 MB per request.`)
      return
    }

    setError("")
    setStatus(`Uploading ${selectedFiles.length} file(s), ${totalMb.toFixed(1)} MB total...`)

    try {
      const formData = new FormData()
      formData.append("asset_category", uploadCategory)
      selectedFiles.forEach((file) => formData.append("file", file))

      const res = await fetch(`${API_BASE}/assets/${TENANT}/job/${id}/upload`, {
        method: "POST",
        body: formData,
      })

      const text = await res.text()
      let data: any = {}

      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = { error: text || "Upload failed without a readable server response" }
      }

      if (!res.ok || !data.ok) {
        setStatus("")
        errorToast(data?.error || `Upload failed with status ${res.status}`)
        return
      }

      setFiles(null)
      successToast(`Uploaded ${data.uploaded?.length || 0} file(s) successfully`)
      await loadAssets()
    } catch (err: any) {
      setStatus("")
      errorToast(err?.message || "Upload failed. Large files may require a stronger upload path.")
    }
  }

  async function deleteFile(assetId: number | string) {
    if (!id) return
    if (!window.confirm("Delete this file/photo?")) return

    const res = await fetch(`${API_BASE}/assets/${TENANT}/job/${id}/file/${assetId}`, {
      method: "DELETE",
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      errorToast(data?.error || "Delete file failed")
      return
    }

    successToast("File deleted")
    await loadAssets()
  }

  useEffect(() => {
    getMe().then(setCurrentUser).catch(() => setCurrentUser(null))
  }, [])

  useEffect(() => {
    loadJob()
    loadAssets()
    loadCalendarEvents()
  }, [id])

  return (
    <div style={page}>
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
              <button onClick={archiveCustomerFile} style={dangerButton}>Archive / Remove Customer File</button>
              <button onClick={cancelEdit} style={button}>Cancel</button>
            </div>
          )}
        </div>

        {job ? (
          !isEditing ? (
            <>
              <div style={grid2}>
                <div>
                  <h3 style={{ marginTop: 0 }}>Job / Customer Details</h3>

                  <p><strong>Customer:</strong> {job.customer_name || "—"}</p>
                  <p><strong>Phone:</strong> {job.customer_phone || "—"}</p>
                  <p><strong>Email:</strong> {job.customer_email || "—"}</p>

                  <p><strong>Secondary Contact:</strong> {job.secondary_contact_name || "—"}</p>
                  <p><strong>Secondary Type:</strong> {job.secondary_contact_type || "—"}</p>
                  <p><strong>Secondary Phone:</strong> {job.secondary_contact_phone || "—"}</p>
                  <p><strong>Secondary Email:</strong> {job.secondary_contact_email || "—"}</p>

                  <p><strong>Address:</strong> {[job.address1, job.city, job.state, job.zip].filter(Boolean).join(", ") || "—"}</p>
                  <p><strong>Source:</strong> {job.lead_source || "—"}</p>
                  <p><strong>Source Detail:</strong> {job.lead_source_detail || "—"}</p>
                  <p><strong>Job Type:</strong> {job.job_type || "—"}</p>
                  <p><strong>Current Stage:</strong> {job.stage || "lead"}</p>
                </div>

                <div>
                  <h3 style={{ marginTop: 0 }}>Claim / Insurance Info</h3>

                  <p><strong>Carrier:</strong> {job.carrier || "—"}</p>
                  <p><strong>Claim #:</strong> {job.claim_number || "—"}</p>
                  <p><strong>Policy Holder:</strong> {job.policy_holder || "—"}</p>
                  <p><strong>Adjuster:</strong> {job.adjuster_name || "—"}</p>
                  <p><strong>Adjuster Phone:</strong> {job.adjuster_phone || "—"}</p>
                  <p><strong>Adjuster Email:</strong> {job.adjuster_email || "—"}</p>
                  <p><strong>Damage Location:</strong> {job.damage_location || "—"}</p>
                  <p><strong>Damage Summary:</strong> {job.damage_summary || "—"}</p>
                </div>
              </div>

              {(job.stage === "intake_pending" || job.stage === "lead") && (
                <>
                  <hr style={hr} />

                  <div style={decisionBox}>
                    <div style={decisionTitle}>Intake Decision</div>

                    <div style={decisionHelp}>
                      Use these after a human reviews the AI voice intake.
                    </div>

                    <div style={decisionButtons}>
                      <button
                        style={primaryButton}
                        onClick={() =>
                          applyIntakeDecision(
                            "lead",
                            "Qualified from AI voice intake after manual review."
                          )
                        }
                      >
                        Qualify as Lead
                      </button>

                      <button
                        style={secondaryButton}
                        onClick={() =>
                          applyIntakeDecision(
                            "intake_pending",
                            "More information requested after AI voice intake review."
                          )
                        }
                      >
                        Request More Info
                      </button>

                      <button
                        style={dangerButton}
                        onClick={() =>
                          applyIntakeDecision(
                            "disqualified",
                            "Disqualified after AI voice intake review."
                          )
                        }
                      >
                        Disqualify
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <label style={label}>Customer Name</label>
              <input value={form.customer_name || ""} onChange={(e) => setField("customer_name", e.target.value)} style={input} />

              <label style={label}>Phone</label>
              <input value={form.customer_phone || ""} onChange={(e) => setField("customer_phone", e.target.value)} style={input} />

              <label style={label}>Email</label>
              <input value={form.customer_email || ""} onChange={(e) => setField("customer_email", e.target.value)} style={input} />

              <hr style={hr} />
              <h3>Secondary Contact</h3>

              <label style={label}>Secondary Contact Name</label>
              <input value={form.secondary_contact_name || ""} onChange={(e) => setField("secondary_contact_name", e.target.value)} style={input} />

              <label style={label}>Secondary Contact Type</label>
              <select value={form.secondary_contact_type || ""} onChange={(e) => setField("secondary_contact_type", e.target.value)} style={input}>
                <option value="">Select type...</option>
                <option value="Spouse">Spouse</option>
                <option value="Homeowner">Homeowner</option>
                <option value="Tenant">Tenant</option>
                <option value="Property Manager">Property Manager</option>
                <option value="Office">Office</option>
                <option value="Emergency Contact">Emergency Contact</option>
                <option value="Other">Other</option>
              </select>

              <label style={label}>Secondary Phone</label>
              <input value={form.secondary_contact_phone || ""} onChange={(e) => setField("secondary_contact_phone", e.target.value)} style={input} />

              <label style={label}>Secondary Email</label>
              <input value={form.secondary_contact_email || ""} onChange={(e) => setField("secondary_contact_email", e.target.value)} style={input} />

              <hr style={hr} />

              <label style={label}>Address</label>
              <input value={form.address1 || ""} onChange={(e) => setField("address1", e.target.value)} style={input} />

              <label style={label}>City</label>
              <input value={form.city || ""} onChange={(e) => setField("city", e.target.value)} style={input} />

              <label style={label}>State</label>
              <input value={form.state || ""} onChange={(e) => setField("state", e.target.value)} style={input} />

              <label style={label}>Zip</label>
              <input value={form.zip || ""} onChange={(e) => setField("zip", e.target.value)} style={input} />

              <hr style={hr} />

              <h3>Lead Source</h3>

              <label style={label}>Lead Source</label>
              <select
                value={form.lead_source || ""}
                onChange={(e) => setField("lead_source", e.target.value)}
                style={input}
              >
                <option value="">Select source...</option>
                <option value="Alacrity">Alacrity</option>
                <option value="Hancock">Hancock</option>
                <option value="Heritage">Heritage</option>
                <option value="Unique">Unique</option>
                <option value="TPA">TPA</option>
                <option value="Referral">Referral</option>
                <option value="Storm">Storm</option>
                <option value="SEO">SEO</option>
                <option value="Estimator">Estimator</option>
                <option value="GC Outreach">GC Outreach</option>
                <option value="Realtor Outreach">Realtor Outreach</option>
                <option value="Legacy Tarp Recovery">Legacy Tarp Recovery</option>
                <option value="Adjuster Outreach">Adjuster Outreach</option>
                <option value="Property Manager Outreach">Property Manager Outreach</option>
                <option value="HOA Outreach">HOA Outreach</option>
                <option value="Phone Call">Phone Call</option>
                <option value="Website">Website</option>
                <option value="Facebook">Facebook</option>
                <option value="Google">Google</option>
                <option value="Other">Other</option>
              </select>

              {form.lead_source === "Other" ? (
                <>
                  <label style={label}>Custom Lead Source</label>
                  <input
                    value={form.lead_source_detail || ""}
                    onChange={(e) => setField("lead_source_detail", e.target.value)}
                    placeholder="Enter custom source..."
                    style={input}
                  />
                </>
              ) : (
                <>
                  <label style={label}>Lead Source Detail</label>
                  <input
                    value={form.lead_source_detail || ""}
                    onChange={(e) => setField("lead_source_detail", e.target.value)}
                    placeholder="Optional detail, campaign, company, or note..."
                    style={input}
                  />
                </>
              )}

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

        <div style={grid2}>
          <div>
            <label style={label}>Stage</label>
            <select value={stage} onChange={(e) => setStage(e.target.value)} style={input}>
              {STAGES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={label}>CRM Substatus</label>
            <input value={crmSubstatus} onChange={(e) => setCrmSubstatus(e.target.value)} style={input} />

            <label style={checkRow}>
              <input type="checkbox" checked={botPaused} onChange={(e) => setBotPaused(e.target.checked)} />
              Pause bot for this job
            </label>

            <button onClick={saveStage} style={button}>Save Stage</button>

            {id ? (
              <Link
                to={`/document-pipeline?jobId=${id}`}
                style={{
                  ...button,
                  display: "inline-block",
                  marginTop: 10,
                  background: "#2563eb",
                  color: "white",
                  textDecoration: "none",
                  borderRadius: 8,
                }}
              >
                Send Proposal / Contract
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section style={card}>
        <h2>Linked Calendar Events</h2>

        {calendarEvents.length === 0 ? (
          <p>No calendar events linked to this job yet.</p>
        ) : (
          calendarEvents.map((event) => (
            <div key={event.id} style={row}>
              <div style={{ width: "100%" }}>
                <div style={grid2}>
                  <div>
                    <label style={label}>Title</label>
                    <input
                      value={event.title || ""}
                      onChange={(e) => setCalendarField(event.id, "title", e.target.value)}
                      style={input}
                    />
                  </div>

                  <div>
                    <label style={label}>Event Type</label>
                    <select
                      value={event.event_type || "general"}
                      onChange={(e) => setCalendarField(event.id, "event_type", e.target.value)}
                      style={input}
                    >
                      <option value="general">general</option>
                      <option value="callback">callback</option>
                      <option value="inspection">inspection</option>
                      <option value="production">production</option>
                      <option value="follow_up">follow_up</option>
                    </select>
                  </div>

                  <div>
                    <label style={label}>Start Time</label>
                    <input
                      type="datetime-local"
                      value={event.start_time || ""}
                      onChange={(e) => setCalendarField(event.id, "start_time", e.target.value)}
                      style={input}
                    />
                  </div>

                  <div>
                    <label style={label}>End Time</label>
                    <input
                      type="datetime-local"
                      value={event.end_time || ""}
                      onChange={(e) => setCalendarField(event.id, "end_time", e.target.value)}
                      style={input}
                    />
                  </div>
                </div>

                <label style={label}>Location</label>
                <input
                  value={event.location || ""}
                  onChange={(e) => setCalendarField(event.id, "location", e.target.value)}
                  style={input}
                />

                <label style={label}>Notes</label>
                <textarea
                  value={event.notes || ""}
                  onChange={(e) => setCalendarField(event.id, "notes", e.target.value)}
                  style={textarea}
                />

                <button onClick={() => saveCalendarEvent(event)} style={button}>
                  Save Calendar Event
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section style={card}>
        <h2>Send SMS</h2>
        <textarea
          value={smsText}
          onChange={(e) => setSmsText(e.target.value)}
          placeholder="Type a text message to the customer..."
          style={textarea}
        />
        <button onClick={sendManualSms} style={button}>Send Text</button>
      </section>

      <section style={card}>
        <h2>Add Note</h2>
        <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a staff note..." style={textarea} />
        <button onClick={addNote} style={button}>Add Note</button>
      </section>

      <section style={card}>
        <h2>Notes</h2>

        {notes.length === 0 ? (
          <p>No activity yet.</p>
        ) : (
          notes
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .map((note) => (
              <div key={`${note.kind || "note"}-${note.id}`} style={row}>
                <div>
                  <strong>
                    {note.created_at
                      ? new Date(note.created_at).toLocaleString()
                      : ""}
                  </strong>

                  <div style={{ marginTop: 8, marginBottom: 8 }}>
                    <span style={getActivityBadgeStyle(note)}>
                      {getActivityLabel(note)}
                    </span>
                  </div>

                  <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{note.message || note.note || ""}</p>
                </div>

                {note.kind ? null : (
                  <button
                    onClick={() => deleteNote(note.id)}
                    style={dangerButton}
                  >
                    Delete Note
                  </button>
                )}
              </div>
            ))
        )}
      </section>

      <section style={card}>
        <h2>Upload Files / Photos</h2>

        <label style={label}>Upload Category</label>
        <select
          value={uploadCategory}
          onChange={(e) => setUploadCategory(e.target.value)}
          style={input}
        >
          <option value="Documents">Documents</option>
          <option value="Roof">Roof</option>
          <option value="Tarp">Tarp</option>
          <option value="Repairs">Repairs</option>
        </select>

        <input
          type="file"
          multiple
          onChange={(e) => setFiles(e.target.files)}
          style={input}
        />

        <button onClick={uploadFiles} style={button}>
          Upload Selected Files
        </button>

        {files && files.length > 0 ? (
          <p>
            {files.length} file(s) selected for {uploadCategory}
          </p>
        ) : null}
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
                  <strong>Category:</strong> {asset.asset_category || "Documents"}
                </p>

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
const badge: CSSProperties = {
  display: "inline-block",
  padding: "4px 9px",
  borderRadius: 999,
  background: "#374151",
  color: "white",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: 0.3,
}
const input: CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", padding: 10, marginBottom: 12, fontSize: 16 }
const textarea: CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", padding: 10, minHeight: 90, marginBottom: 12, fontSize: 16, lineHeight: 1.45 }
const label: CSSProperties = { display: "block", marginBottom: 6 }
const checkRow: CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }
const buttonRow: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap" }
const button: CSSProperties = { padding: "10px 14px", cursor: "pointer" }

const grid2: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 16,
  alignItems: "start",
}

const dangerButton: CSSProperties = { padding: "10px 14px", cursor: "pointer", background: "#7f1d1d", color: "white", border: "none", borderRadius: 8 }
const linkStyle: CSSProperties = { color: "#93c5fd" }
const success: CSSProperties = { color: "#86efac" }
const danger: CSSProperties = { color: "#fca5a5" }
const hr: CSSProperties = { borderColor: "#374151", margin: "18px 0" }


const decisionBox: CSSProperties = {
  marginTop: 12,
  padding: 14,
  borderRadius: 14,
  background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.12)",
}

const decisionTitle: CSSProperties = {
  fontWeight: 800,
  marginBottom: 4,
}

const decisionHelp: CSSProperties = {
  fontSize: 13,
  opacity: 0.75,
  marginBottom: 10,
}

const decisionButtons: CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
}

const primaryButton: CSSProperties = {
  color: "#fff",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  border: "none",
  padding: "10px 14px",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 700,
}

const secondaryButton: CSSProperties = {
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.16)",
  padding: "10px 14px",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 700,
}
