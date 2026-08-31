import { useEffect, useRef, useState, type CSSProperties } from "react"
import { Link, useParams } from "react-router-dom"
import { getMe, getToken, type AuthUser } from "../lib/auth"
import { getTenantSlug } from "../lib/tenant"

const API_BASE = import.meta.env.VITE_API_BASE || "https://contractor-navigator.onrender.com"
const STAGES = [
  "intake_pending", "lead", "callback", "inspection", "roof_repair", "roof_replacement", "wa_sent", "tarp",
  "estimate_sent", "contract_sent", "pre_production", "in_production",
  "completed", "tarp_complete", "invoiced", "paid", "disqualified", "dnc",
]

function stageDisplayLabel(stage: string) {
  return stage === "callback"
    ? "Estimate Needed"
    : stage
}

const ACTUAL_ASSISTANT_STAGES = [
  { value: "demo_requested", label: "Demo Requested" },
  { value: "prospect", label: "Prospect" },
  { value: "demo_scheduled", label: "Demo Scheduled" },
  { value: "demo_completed_follow_up", label: "Demo Completed Follow-Up" },
  { value: "proposal_sent", label: "Proposal Sent" },
  { value: "agreement_sent", label: "Purchase Made" },
  { value: "company_dna", label: "Company DNA" },
  { value: "provisioning", label: "Provisioning" },
  { value: "active_tenant", label: "Active Tenant" },
  { value: "buying_signals", label: "Buying Signals" },
  { value: "not_moving_forward", label: "Not Moving Forward" },
]

export default function JobDetail() {
  const { id } = useParams()

  const [job, setJob] = useState<any>(null)
  const [assets, setAssets] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [files, setFiles] = useState<FileList | null>(null)
  const [fileDescriptions, setFileDescriptions] = useState<Record<number, string>>({})
  const [editingAssetId, setEditingAssetId] = useState<number | string | null>(null)
  const [editingAssetNote, setEditingAssetNote] = useState("")
  const [editingAssetCategory, setEditingAssetCategory] = useState("Documents")
  const [uploadCategory, setUploadCategory] = useState("Documents")
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState("")
  const uploadInFlightRef = useRef(false)
  const [showAllPhotos, setShowAllPhotos] = useState(false)
  const [showAllDocuments, setShowAllDocuments] = useState(false)
  const [photoSequences, setPhotoSequences] = useState<Record<string, string>>({})
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<Record<string, string>>({})
  const [photoRotations, setPhotoRotations] = useState<Record<string, number>>({})
  const [photoLocations, setPhotoLocations] = useState<Record<string, string>>({})
  const [savingPhotoSequence, setSavingPhotoSequence] = useState(false)
  const [generatingPhotoReport, setGeneratingPhotoReport] = useState(false)
  const [downloadingPhotos, setDownloadingPhotos] = useState(false)
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
  const [subcontractors, setSubcontractors] = useState<any[]>([])
  const [crewAssignments, setCrewAssignments] = useState<any[]>([])
  const [selectedSubcontractorId, setSelectedSubcontractorId] = useState("")

  async function loadJob() {
    if (!id) return

    const token = getToken()
    const res = await fetch(`${API_BASE}/admin/job/${getTenantSlug()}/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
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
    setCrewAssignments(Array.isArray(data.crew_assignments) ? data.crew_assignments : [])

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
        "voice_ai_transcript",
        "voice_followup_sms_sent",
        "job_manually_updated",
        "manual_stage_updated",
        "ai_followup_workflow_started",
        "ai_followup_workflow_restarted",
        "calendar_stage_event_created",
        "calendar_stage_event_rescheduled",
        "calendar_event_rescheduled",
        "job_archived",
        "document_package_sent",
        "document_package_signed",
      ].includes(String(event.kind || "").toLowerCase())
    )

    setNotes(jobTimelineNotes)
  }

  async function loadSubcontractors() {
    const token = getToken()

    const res = await fetch(`${API_BASE}/admin/${getTenantSlug()}/subcontractors`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      errorToast(data?.error || "Failed to load subcontractors")
      return
    }

    setSubcontractors(
      Array.isArray(data.subcontractors) ? data.subcontractors : []
    )
  }

  async function assignSubcontractor() {
    if (!id) return

    if (!selectedSubcontractorId) {
      errorToast("Select a subcontractor")
      return
    }

    const token = getToken()

    const res = await fetch(
      `${API_BASE}/admin/job/${getTenantSlug()}/${id}/assign-subcontractor`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          app_user_id: Number(selectedSubcontractorId),
        }),
      }
    )

    const data = await res.json()

    if (!res.ok || !data.ok) {
      errorToast(data?.error || "Assignment failed")
      return
    }

    successToast("Subcontractor assigned")
    setSelectedSubcontractorId("")
    await loadJob()
  }

  async function loadPhotoPreviews(photoAssets: any[]) {
    const token = getToken()

    const missingPhotos = photoAssets.filter(
      (asset) => !photoPreviewUrls[String(asset.id)]
    )

    if (missingPhotos.length === 0) return

    const loaded = await Promise.all(
      missingPhotos.map(async (asset) => {
        try {
          const assetUrl = asset.download_url
            ? `${API_BASE}${asset.download_url}`
            : asset.url

          if (!assetUrl) return null

          const res = await fetch(assetUrl, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          })

          if (!res.ok) return null

          const blob = await res.blob()

          if (!blob.type.startsWith("image/")) return null

          return [String(asset.id), URL.createObjectURL(blob)] as const
        } catch {
          return null
        }
      })
    )

    const validEntries = loaded.filter(
      (entry): entry is readonly [string, string] => Boolean(entry)
    )

    if (validEntries.length === 0) return

    setPhotoPreviewUrls((current) => {
      const next = { ...current }

      validEntries.forEach(([assetId, url]) => {
        next[assetId] = url
      })

      return next
    })
  }

  async function loadAssets() {
    if (!id) return

    const token = getToken()
    const res = await fetch(`${API_BASE}/assets/${getTenantSlug()}/job/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data?.error || "Failed to load files/notes")
      return
    }

    const loadedAssets = data.assets || []
    setAssets(loadedAssets)

    if (Array.isArray(data.photo_sequence)) {
      const restoredSequence: Record<string, string> = {}

      data.photo_sequence.forEach(
        (photoId: number | string, index: number) => {
          restoredSequence[String(photoId)] = String(index + 1)
        }
      )

      setPhotoSequences(restoredSequence)
    }

    const recentPhotos = loadedAssets
      .filter(
        (asset: any) =>
          asset.asset_type === "photo" ||
          String(asset.mime_type || "").startsWith("image/")
      )
      .slice(0, 3)

    await loadPhotoPreviews(recentPhotos)
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

    const res = await fetch(`${API_BASE}/calendar/${getTenantSlug()}/events`)
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

    const res = await fetch(`${API_BASE}/calendar/${getTenantSlug()}/events/${event.id}`, {
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
    if (kind.includes("staff_note")) return meta.author ? `Staff Note — ${meta.author}` : "Staff Note"
    if (kind.includes("voice_ai_transcript")) return "Voice AI Transcript"
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

    const res = await fetch(`${API_BASE}/admin/job/${getTenantSlug()}/${id}/update`, {
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

    const res = await fetch(`${API_BASE}/admin/job/${getTenantSlug()}/${id}/archive`, {
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

    const res = await fetch(`${API_BASE}/admin/${getTenantSlug()}/jobs/${id}/stage`, {
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

    const res = await fetch(`${API_BASE}/admin/job/${getTenantSlug()}/${id}/update`, {
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

    const res = await fetch(`${API_BASE}/assets/${getTenantSlug()}/job/${id}/send-sms`, {
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

    const token = getToken()
    const res = await fetch(`${API_BASE}/assets/${getTenantSlug()}/job/${id}/notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        message: noteText,
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

    const res = await fetch(`${API_BASE}/assets/${getTenantSlug()}/job/${id}/notes/${noteId}`, {
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
    if (uploadInFlightRef.current) {
      return
    }

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

    uploadInFlightRef.current = true
    setIsUploading(true)

    const initialUploadProgress =
      `Uploading ${selectedFiles.length} file(s), ${totalMb.toFixed(1)} MB total...`

    setError("")
    setStatus(initialUploadProgress)
    setUploadProgress(initialUploadProgress)

    try {
      const token = getToken()
      let uploadedCount = 0

      for (const [index, file] of selectedFiles.entries()) {
        const formData = new FormData()
        formData.append("asset_category", uploadCategory)
        formData.append("note", fileDescriptions[index]?.trim() || "")
        formData.append("file", file)

        const currentUploadProgress =
        `Uploading file ${index + 1} of ${selectedFiles.length}: ${file.name}`

      setStatus(currentUploadProgress)
      setUploadProgress(currentUploadProgress)

        const res = await fetch(
          `${API_BASE}/assets/${getTenantSlug()}/job/${id}/upload`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: formData,
          }
        )

        const text = await res.text()
        let data: any = {}

        try {
          data = text ? JSON.parse(text) : {}
        } catch {
          data = {
            error:
              text ||
              "Upload failed without a readable server response",
          }
        }

        if (!res.ok || !data.ok) {
          setStatus("")
          errorToast(
            data?.error ||
              `Upload failed for ${file.name} with status ${res.status}`
          )
          return
        }

        uploadedCount += data.uploaded?.length || 0
      }

      setFiles(null)
      setFileDescriptions({})
      successToast(`Uploaded ${uploadedCount} file(s) successfully`)
      await loadAssets()
    } catch (err: any) {
      setStatus("")
      errorToast(err?.message || "Upload failed. Large files may require a stronger upload path.")
    } finally {
      uploadInFlightRef.current = false
      setIsUploading(false)
      setUploadProgress("")
      setStatus("")
    }
  }

  async function savePhotoSequence() {
    if (!id) return

    const photos = assets.filter(
      (asset: any) =>
        asset.asset_type === "photo" ||
        String(asset.mime_type || "").startsWith("image/")
    )

    const requested: Array<{
      asset: any
      sequence: number
    }> = []

    for (const asset of photos) {
      const raw = String(
        photoSequences[String(asset.id)] || ""
      ).trim()

      if (!raw) continue

      const sequence = Number(raw)

      if (!Number.isInteger(sequence) || sequence <= 0) {
        errorToast(
          `Photo Sequence must be a positive whole number. Check ${asset.note || asset.original_name || "the selected photo"}.`
        )
        return
      }

      requested.push({ asset, sequence })
    }

    if (requested.length === 0) {
      errorToast("Enter a Photo Sequence for at least one photo")
      return
    }

    const duplicateSequences = requested
      .map((item) => item.sequence)
      .filter(
        (sequence, index, all) =>
          all.indexOf(sequence) !== index
      )

    if (duplicateSequences.length > 0) {
      const duplicates = Array.from(
        new Set(duplicateSequences)
      ).sort((a, b) => a - b)

      errorToast(
        `Duplicate Photo Sequence number${duplicates.length === 1 ? "" : "s"}: ${duplicates.join(", ")}`
      )
      return
    }

    requested.sort((a, b) => a.sequence - b.sequence)

    setSavingPhotoSequence(true)

    try {
      const token = getToken()

      const res = await fetch(
        `${API_BASE}/assets/${getTenantSlug()}/job/${id}/photo-sequence`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            photo_ids: requested.map((item) =>
              Number(item.asset.id)
            ),
          }),
        }
      )

      const data = await res.json()

      if (!res.ok || !data.ok) {
        errorToast(data?.error || "Photo sequence save failed")
        return
      }

      successToast(
        `Saved photo sequence with ${requested.length} photo${requested.length === 1 ? "" : "s"}`
      )
    } catch (err: any) {
      errorToast(err?.message || "Photo sequence save failed")
    } finally {
      setSavingPhotoSequence(false)
    }
  }

  async function generatePhotoReport() {
    if (!id) return

    const photos = assets.filter(
      (asset: any) =>
        asset.asset_type === "photo" ||
        String(asset.mime_type || "").startsWith("image/")
    )

    const requested: Array<{
      asset: any
      sequence: number
    }> = []

    for (const asset of photos) {
      const raw = String(photoSequences[String(asset.id)] || "").trim()

      if (!raw) continue

      const sequence = Number(raw)

      if (!Number.isInteger(sequence) || sequence <= 0) {
        errorToast(
          `Photo Sequence must be a positive whole number. Check ${asset.note || asset.original_name || "the selected photo"}.`
        )
        return
      }

      requested.push({ asset, sequence })
    }

    if (requested.length === 0) {
      errorToast("Enter a Photo Sequence for at least one photo")
      return
    }

    const duplicateSequences = requested
      .map((item) => item.sequence)
      .filter(
        (sequence, index, all) =>
          all.indexOf(sequence) !== index
      )

    if (duplicateSequences.length > 0) {
      const duplicates = Array.from(
        new Set(duplicateSequences)
      ).sort((a, b) => a - b)

      errorToast(
        `Duplicate Photo Sequence number${duplicates.length === 1 ? "" : "s"}: ${duplicates.join(", ")}`
      )
      return
    }

    requested.sort((a, b) => a.sequence - b.sequence)

    setGeneratingPhotoReport(true)

    try {
      const token = getToken()

      const res = await fetch(
        `${API_BASE}/assets/${getTenantSlug()}/job/${id}/photo-report`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            photo_ids: requested.map((item) =>
              Number(item.asset.id)
            ),
            photo_edits: requested.map((item) => ({
              photo_id: Number(item.asset.id),
              rotation: photoRotations[String(item.asset.id)] || 0,
              location: photoLocations[String(item.asset.id)] || "",
            })),
          }),
        }
      )

      const data = await res.json()

      if (!res.ok || !data.ok) {
        errorToast(data?.error || "Photo report generation failed")
        return
      }

      successToast(
        `Photo report generated with ${requested.length} photo${requested.length === 1 ? "" : "s"} and saved to Documents`
      )

      setPhotoSequences({})
      setPhotoRotations({})
      setPhotoLocations({})
      await loadAssets()
    } catch (err: any) {
      errorToast(err?.message || "Photo report generation failed")
    } finally {
      setGeneratingPhotoReport(false)
    }
  }

  async function downloadSequencedPhotos() {
    if (!id) return

    setDownloadingPhotos(true)

    try {
      const token = getToken()
      const tenantSlug =
        getTenantSlug()

      const res = await fetch(
        `${API_BASE}/assets/${tenantSlug}/job/${id}/photo-download`,
        {
          headers: {
            Authorization:
              `Bearer ${token}`,
          },
        }
      )

      if (!res.ok) {
        let message =
          "Photo download failed"

        try {
          const data =
            await res.json()

          message =
            data?.error ||
            message
        } catch {
          // Preserve generic error for non-JSON responses.
        }

        errorToast(message)
        return
      }

      const contentType =
        String(
          res.headers.get(
            "Content-Type"
          ) || ""
        ).toLowerCase()

      if (
        contentType.includes(
          "application/json"
        )
      ) {
        const data =
          await res.json()

        if (
          !data?.ok ||
          data?.mode !==
            "individual" ||
          !Array.isArray(data?.files) ||
          data.files.length === 0
        ) {
          errorToast(
            data?.error ||
            "Photo download failed"
          )
          return
        }

        for (
          let index = 0;
          index < data.files.length;
          index += 1
        ) {
          const file =
            data.files[index]

          const assetId =
            Number(file?.asset_id)

          const filename =
            String(
              file?.filename ||
              `Photo_${index + 1}.jpg`
            )

          if (
            !Number.isInteger(assetId) ||
            assetId <= 0
          ) {
            throw new Error(
              "Navigator returned an invalid photo download"
            )
          }

          const fileRes =
            await fetch(
              `${API_BASE}/assets/${tenantSlug}/file/${assetId}`,
              {
                headers: {
                  Authorization:
                    `Bearer ${token}`,
                },
              }
            )

          if (!fileRes.ok) {
            throw new Error(
              `Photo ${index + 1} download failed`
            )
          }

          const blob =
            await fileRes.blob()

          const objectUrl =
            URL.createObjectURL(blob)

          const link =
            document.createElement("a")

          link.href =
            objectUrl

          link.download =
            filename

          document.body.appendChild(
            link
          )

          link.click()
          link.remove()

          window.setTimeout(
            () =>
              URL.revokeObjectURL(
                objectUrl
              ),
            1500
          )

          if (
            index <
            data.files.length - 1
          ) {
            await new Promise(
              (resolve) =>
                window.setTimeout(
                  resolve,
                  200
                )
            )
          }
        }

        successToast(
          `Downloaded ${data.files.length} sequenced photo${data.files.length === 1 ? "" : "s"}`
        )

        return
      }

      const blob =
        await res.blob()

      const disposition =
        res.headers.get(
          "Content-Disposition"
        ) || ""

      const filenameMatch =
        disposition.match(
          /filename="?([^"]+)"?/i
        )

      const filename =
        filenameMatch?.[1] ||
        `Job_${id}_Photos.zip`

      const objectUrl =
        URL.createObjectURL(blob)

      const link =
        document.createElement("a")

      link.href =
        objectUrl

      link.download =
        filename

      document.body.appendChild(
        link
      )

      link.click()
      link.remove()

      window.setTimeout(
        () =>
          URL.revokeObjectURL(
            objectUrl
          ),
        1500
      )

      successToast(
        "Sequenced photos downloaded as ZIP"
      )
    } catch (err: any) {
      errorToast(
        err?.message ||
        "Photo download failed"
      )
    } finally {
      setDownloadingPhotos(false)
    }
  }

  async function openFile(asset: any) {
    const viewingWindow = window.open("", "_blank")

    if (!viewingWindow) {
      errorToast("Allow pop-ups for Navigator to view files")
      return
    }

    viewingWindow.document.title = "Opening file..."
    viewingWindow.document.body.innerHTML =
      '<p style="font-family: sans-serif; padding: 24px;">Opening file...</p>'

    try {
      const token = getToken()
      const assetUrl = asset.download_url
        ? `${API_BASE}${asset.download_url}`
        : asset.url

      if (!assetUrl) {
        viewingWindow.close()
        errorToast("File URL is unavailable")
        return
      }

      const res = await fetch(assetUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        let message = "Open file failed"

        try {
          const data = await res.json()
          message = data?.error || message
        } catch {
          // Preserve the generic error when the response is not JSON.
        }

        viewingWindow.close()
        errorToast(message)
        return
      }

      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)

      viewingWindow.location.replace(objectUrl)

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000)
    } catch (err: any) {
      viewingWindow.close()
      errorToast(err?.message || "Open file failed")
    }
  }

  async function saveAssetMetadata(assetId: number | string) {
    if (!id) return

    const token = getToken()
    const res = await fetch(
      `${API_BASE}/assets/${getTenantSlug()}/job/${id}/file/${assetId}/metadata`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          note: editingAssetNote,
          asset_category: editingAssetCategory,
        }),
      }
    )

    const data = await res.json()

    if (!res.ok || !data.ok) {
      errorToast(data?.error || "Update file details failed")
      return
    }

    setEditingAssetId(null)
    setEditingAssetNote("")
    setEditingAssetCategory("Documents")
    successToast("File details updated")
    await loadAssets()
  }

  async function deleteFile(assetId: number | string) {
    if (!id) return
    if (!window.confirm("Delete this file/photo?")) return

    const res = await fetch(`${API_BASE}/assets/${getTenantSlug()}/job/${id}/file/${assetId}`, {
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
    getMe()
      .then((user) => {
        setCurrentUser(user)

        if (
          user &&
          ["platform_owner", "tenant_admin", "admin", "manager"].includes(user.role)
        ) {
          void loadSubcontractors()
        }
      })
      .catch(() => setCurrentUser(null))
  }, [])

  useEffect(() => {
    loadJob()
  }, [id])

  useEffect(() => {
    if (!showAllPhotos) return

    const photos = assets.filter(
      (asset: any) =>
        asset.asset_type === "photo" ||
        String(asset.mime_type || "").startsWith("image/")
    )

    void loadPhotoPreviews(photos)
  }, [showAllPhotos, assets])

  useEffect(() => {
    if (!currentUser) {
      return
    }

    loadAssets()

    if (currentUser.role !== "subcontractor") {
      loadCalendarEvents()
    }
  }, [id, currentUser])

  if (currentUser?.role === "subcontractor") {
    return (
      <div style={page}>
        <Link to="/field" style={linkStyle}>
          ← Back to My Assigned Jobs
        </Link>

        <h1 style={{ color: "white" }}>Job #{id}</h1>

        {error ? <p style={danger}>{error}</p> : null}

        {!job ? (
          <section style={card}>
            <p>Loading assigned job...</p>
          </section>
        ) : (
          <>
            <section style={card}>
              <h2>Job Details</h2>

              <p>
                <strong>Customer:</strong> {job.customer_name || "—"}
              </p>

              <p>
                <strong>Address:</strong>{" "}
                {[job.address1, job.city, job.state, job.zip]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </p>

              <p>
                <strong>Job Type:</strong> {job.job_type || "—"}
              </p>

              <p>
                <strong>Current Stage:</strong> {job.stage || "—"}
              </p>

              <p>
                <strong>Assignment:</strong>{" "}
                {job.assignment_subject || "—"}
              </p>

              <p style={{ whiteSpace: "pre-wrap" }}>
                <strong>Assignment Notes:</strong>{" "}
                {job.assignment_notes || "—"}
              </p>

              <p>
                <strong>Damage Location:</strong>{" "}
                {job.damage_location || "—"}
              </p>

              <p style={{ whiteSpace: "pre-wrap" }}>
                <strong>Damage Summary:</strong>{" "}
                {job.damage_summary || "—"}
              </p>
            </section>

            <section style={card}>
              <h2>Add Job Note</h2>

              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note for the office..."
                style={textarea}
              />

              <button onClick={addNote} style={button}>
                Add Note
              </button>
            </section>

            <section style={card}>
              <h2>Job Activity</h2>

              {notes.length === 0 ? (
                <p>No activity available.</p>
              ) : (
                notes
                  .sort(
                    (a, b) =>
                      new Date(b.created_at).getTime() -
                      new Date(a.created_at).getTime()
                  )
                  .map((note) => (
                    <div
                      key={`${note.kind || "note"}-${note.id}`}
                      style={row}
                    >
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

                        <p
                          style={{
                            whiteSpace: "pre-wrap",
                            lineHeight: 1.45,
                          }}
                        >
                          {note.message || note.note || ""}
                        </p>
                      </div>
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
                      <strong>
                        {asset.original_name ||
                          asset.file_name ||
                          "File"}
                      </strong>

                      <p>
                        <strong>Category:</strong>{" "}
                        {asset.asset_category || "Documents"}
                      </p>

                      <p>
                        {asset.mime_type || "file"} —{" "}
                        {asset.size_bytes
                          ? `${Math.round(
                              Number(asset.size_bytes) / 1024
                            )} KB`
                          : "unknown size"}
                      </p>

                      <button
                        onClick={() => openFile(asset)}
                        style={button}
                      >
                        Open File
                      </button>
                    </div>
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </div>
    )
  }

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
                  <p><strong>DOL:</strong> {job.date_of_loss || "—"}</p>
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

              <label style={label}>Job Type</label>
              <input
                value={form.job_type || ""}
                onChange={(e) => setField("job_type", e.target.value)}
                style={input}
                placeholder="Enter job type"
              />

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
                <option value="Accuserve">Accuserve</option>
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

              <label style={label}>DOL</label>
              <input
                type="date"
                value={form.date_of_loss ? String(form.date_of_loss).slice(0, 10) : ""}
                onChange={(e) => setField("date_of_loss", e.target.value)}
                style={input}
              />

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

      {currentUser &&
      ["platform_owner", "tenant_admin", "admin", "manager"].includes(currentUser.role) ? (
        <section style={card}>
          <h2>Subcontractor Assignment</h2>

          <div style={grid2}>
            <div>
              <label style={label}>Assign Subcontractor</label>
              <select
                value={selectedSubcontractorId}
                onChange={(e) => setSelectedSubcontractorId(e.target.value)}
                style={input}
              >
                <option value="">Select subcontractor...</option>
                {subcontractors.map((subcontractor) => (
                  <option key={subcontractor.id} value={subcontractor.id}>
                    {subcontractor.full_name} — {subcontractor.email}
                  </option>
                ))}
              </select>

              <button onClick={assignSubcontractor} style={button}>
                Assign Subcontractor
              </button>
            </div>

            <div>
              <h3 style={{ marginTop: 0 }}>Current Assignments</h3>

              {crewAssignments.length === 0 ? (
                <p>No subcontractor assignments.</p>
              ) : (
                crewAssignments.map((assignment) => (
                  <div key={assignment.id} style={row}>
                    <div>
                      <div style={{ fontWeight: 800 }}>
                        {assignment.crew_name || "Unnamed Subcontractor"}
                      </div>
                      <div style={{ opacity: 0.8, marginTop: 4 }}>
                        Status: {assignment.status || "PENDING"}
                      </div>
                      <div style={{ opacity: 0.7, marginTop: 4 }}>
                        Assigned by: {assignment.assigned_by || "—"}
                      </div>
                      <div style={{ opacity: 0.7, marginTop: 4 }}>
                        Assigned:{" "}
                        {assignment.assigned_at
                          ? new Date(assignment.assigned_at).toLocaleString()
                          : "—"}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      ) : null}

      <section style={card}>
        <h2>Stage / Bot Controls</h2>

        <div style={grid2}>
          <div>
            <label style={label}>Stage</label>
            <select value={stage} onChange={(e) => setStage(e.target.value)} style={input}>
              {getTenantSlug() === "actual-assistant-llc"
                ? ACTUAL_ASSISTANT_STAGES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))
                : STAGES.map((item) => (
                    <option key={item} value={item}>
                      {stageDisplayLabel(item)}
                    </option>
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

                  <p
                    style={{
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.45,
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                      maxWidth: "100%",
                    }}
                  >
                    {note.message || note.note || ""}
                  </p>
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
          disabled={isUploading}
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
          disabled={isUploading}
          onChange={(e) => {
            const selected = e.target.files
            setFiles(selected)

            if (!selected) {
              setFileDescriptions({})
              return
            }

            const initialDescriptions: Record<number, string> = {}

            Array.from(selected).forEach((_, index) => {
              initialDescriptions[index] = ""
            })

            setFileDescriptions(initialDescriptions)
          }}
          style={input}
        />

        {files && files.length > 0 ? (
          <div style={{ marginBottom: 14 }}>
            {Array.from(files).map((file, index) => (
              <div
                key={`${file.name}-${file.lastModified}-${index}`}
                style={{
                  background: "#1f2937",
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 10,
                }}
              >
                <strong>{file.name}</strong>

                <label style={{ ...label, marginTop: 10 }}>
                  Document Description
                </label>

                <textarea
                  value={fileDescriptions[index] || ""}
                  onChange={(e) =>
                    setFileDescriptions((current) => ({
                      ...current,
                      [index]: e.target.value,
                    }))
                  }
                  style={textarea}
                  placeholder="Example: Living room ceiling water damage above fireplace"
                />
              </div>
            ))}

            <p>
              {files.length} file(s) selected for {uploadCategory}
            </p>
          </div>
        ) : null}

        <button
          onClick={uploadFiles}
          disabled={isUploading}
          style={{
            ...button,
            opacity: isUploading ? 0.72 : 1,
            cursor: isUploading ? "wait" : "pointer",
          }}
        >
          {isUploading ? "⏳ Uploading..." : "Upload Selected Files"}
        </button>

        {isUploading && uploadProgress ? (
          <p
            style={{
              ...success,
              marginTop: 10,
              marginBottom: 0,
              fontWeight: 800,
            }}
          >
            ⏳ {uploadProgress}
          </p>
        ) : null}
      </section>

      {(() => {
        const photos = assets.filter(
          (asset: any) =>
            asset.asset_type === "photo" ||
            String(asset.mime_type || "").startsWith("image/")
        )

        const documents = assets.filter(
          (asset: any) =>
            !(
              asset.asset_type === "photo" ||
              String(asset.mime_type || "").startsWith("image/")
            )
        )

        const formatUploadDate = (value: any) => {
          if (!value) return "Unknown upload time"

          const date = new Date(value)

          if (Number.isNaN(date.getTime())) {
            return "Unknown upload time"
          }

          return date.toLocaleString()
        }

        const beginDescriptionEdit = (asset: any) => {
          setEditingAssetId(asset.id)
          setEditingAssetNote(asset.note || "")
          setEditingAssetCategory(asset.asset_category || "Documents")
        }

        const renderPhoto = (asset: any, workspace = false) => (
          <div key={asset.id} style={photoCard}>
            {workspace ? (
              <div style={photoSequenceRow}>
                <label
                  htmlFor={`photo-sequence-${asset.id}`}
                  style={{ fontWeight: 800 }}
                >
                  Photo Sequence
                </label>

                <input
                  id={`photo-sequence-${asset.id}`}
                  type="number"
                  min="1"
                  step="1"
                  value={photoSequences[String(asset.id)] || ""}
                  onChange={(e) => {
                    const value = e.target.value

                    setPhotoSequences((current) => ({
                      ...current,
                      [String(asset.id)]: value,
                    }))
                  }}
                  placeholder="Blank = exclude"
                  style={photoSequenceInput}
                />
              </div>
            ) : null}

            {workspace ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setPhotoRotations((current) => ({
                      ...current,
                      [String(asset.id)]:
                        ((current[String(asset.id)] || 0) + 270) % 360,
                    }))
                  }
                  style={secondaryButton}
                >
                  Rotate Left
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setPhotoRotations((current) => ({
                      ...current,
                      [String(asset.id)]:
                        ((current[String(asset.id)] || 0) + 90) % 360,
                    }))
                  }
                  style={secondaryButton}
                >
                  Rotate Right
                </button>

                <label
                  htmlFor={`photo-location-${asset.id}`}
                  style={{ fontWeight: 800 }}
                >
                  Location in Photo
                </label>

                <select
                  id={`photo-location-${asset.id}`}
                  value={photoLocations[String(asset.id)] || ""}
                  onChange={(e) =>
                    setPhotoLocations((current) => ({
                      ...current,
                      [String(asset.id)]: e.target.value,
                    }))
                  }
                  style={{
                    ...input,
                    width: "auto",
                    minWidth: 170,
                    margin: 0,
                  }}
                >
                  <option value="">Not specified</option>
                  <option value="Upper left">Upper left</option>
                  <option value="Upper right">Upper right</option>
                  <option value="Center">Center</option>
                  <option value="Lower left">Lower left</option>
                  <option value="Lower right">Lower right</option>
                </select>

                {(photoRotations[String(asset.id)] ||
                  photoLocations[String(asset.id)]) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoRotations((current) => ({
                        ...current,
                        [String(asset.id)]: 0,
                      }))
                      setPhotoLocations((current) => ({
                        ...current,
                        [String(asset.id)]: "",
                      }))
                    }}
                    style={secondaryButton}
                  >
                    Reset Photo Options
                  </button>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => openFile(asset)}
              style={photoPreviewButton}
              title="Open full size"
            >
              {photoPreviewUrls[String(asset.id)] ? (
                <img
                  src={photoPreviewUrls[String(asset.id)]}
                  alt={
                    asset.note ||
                    asset.original_name ||
                    asset.file_name ||
                    "Job photo"
                  }
                  style={{
                    ...photoPreviewImage,
                    transform: `rotate(${photoRotations[String(asset.id)] || 0}deg)`,
                    transition: "transform 160ms ease",
                  }}
                />
              ) : (
                <div style={photoPreviewPlaceholder}>
                  Loading photo...
                </div>
              )}
            </button>

            {String(editingAssetId) === String(asset.id) ? (
              <>
                <label style={{ ...label, marginTop: 12 }}>
                  Description
                </label>

                <textarea
                  value={editingAssetNote}
                  onChange={(e) => setEditingAssetNote(e.target.value)}
                  style={textarea}
                  placeholder="Enter a description for this photo"
                />

                <div style={buttonRow}>
                  <button
                    onClick={() => saveAssetMetadata(asset.id)}
                    style={button}
                  >
                    Save Description
                  </button>

                  <button
                    onClick={() => {
                      setEditingAssetId(null)
                      setEditingAssetNote("")
                      setEditingAssetCategory("Documents")
                    }}
                    style={secondaryButton}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={photoDescription}>
                  <strong>Description:</strong>{" "}
                  {asset.note || "No description"}
                </p>

                <p style={photoMeta}>
                  <strong>Category:</strong>{" "}
                  {asset.asset_category || "Documents"}
                </p>

                <p style={photoMeta}>
                  <strong>Uploaded by:</strong>{" "}
                  {asset.uploaded_by || "Unknown"} —{" "}
                  {formatUploadDate(asset.created_at)}
                </p>

                <div style={buttonRow}>
                  {workspace ? (
                    <button
                      onClick={() => beginDescriptionEdit(asset)}
                      style={button}
                    >
                      Edit Description
                    </button>
                  ) : null}

                  <button
                    onClick={() => openFile(asset)}
                    style={button}
                  >
                    Open Full Size
                  </button>
                </div>
              </>
            )}
          </div>
        )

        const renderDocument = (asset: any) => (
          <div key={asset.id} style={documentRow}>
            <div style={{ flex: 1 }}>
              {String(editingAssetId) === String(asset.id) ? (
                <>
                  <label style={label}>Document Description</label>
                  <textarea
                    value={editingAssetNote}
                    onChange={(e) => setEditingAssetNote(e.target.value)}
                    style={textarea}
                    placeholder="Enter a description for this file"
                  />

                  <label style={label}>Category</label>
                  <select
                    value={editingAssetCategory}
                    onChange={(e) =>
                      setEditingAssetCategory(e.target.value)
                    }
                    style={input}
                  >
                    <option value="Documents">Documents</option>
                    <option value="Roof">Roof</option>
                    <option value="Tarp">Tarp</option>
                    <option value="Repairs">Repairs</option>
                  </select>

                  <div style={buttonRow}>
                    <button
                      onClick={() => saveAssetMetadata(asset.id)}
                      style={button}
                    >
                      Save Details
                    </button>

                    <button
                      onClick={() => {
                        setEditingAssetId(null)
                        setEditingAssetNote("")
                        setEditingAssetCategory("Documents")
                      }}
                      style={secondaryButton}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <strong>
                    {asset.note ||
                      asset.original_name ||
                      asset.file_name ||
                      "Document"}
                  </strong>

                  {asset.note ? (
                    <p style={photoMeta}>
                      <strong>Original file:</strong>{" "}
                      {asset.original_name ||
                        asset.file_name ||
                        "Document"}
                    </p>
                  ) : null}

                  <p style={photoMeta}>
                    <strong>Category:</strong>{" "}
                    {asset.asset_category || "Documents"}
                  </p>

                  <p style={photoMeta}>
                    <strong>Uploaded by:</strong>{" "}
                    {asset.uploaded_by || "Unknown"} —{" "}
                    {formatUploadDate(asset.created_at)}
                  </p>

                  <div style={buttonRow}>
                    <button
                      onClick={() => openFile(asset)}
                      style={button}
                    >
                      Open Document
                    </button>

                    {showAllDocuments ? (
                      <button
                        onClick={() => beginDescriptionEdit(asset)}
                        style={button}
                      >
                        Edit Description / Category
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>

            {showAllDocuments ? (
              <button
                onClick={() => deleteFile(asset.id)}
                style={dangerButton}
              >
                Delete File
              </button>
            ) : null}
          </div>
        )

        return (
          <>
            <section style={card}>
              <div style={sectionHeader}>
                <div>
                  <h2 style={{ marginBottom: 4 }}>Photos</h2>
                  <div style={sectionCount}>
                    {photos.length} photo{photos.length === 1 ? "" : "s"}
                  </div>
                </div>

                {photos.length > 0 ? (
                  <button
                    onClick={() => setShowAllPhotos((current) => !current)}
                    style={button}
                  >
                    {showAllPhotos ? "Show Recent Photos" : "View All Photos"}
                  </button>
                ) : null}
              </div>

              {photos.length === 0 ? (
                <p>No photos uploaded yet.</p>
              ) : showAllPhotos ? (
                <>
                  <p style={{ opacity: 0.8 }}>
                    Enter a Photo Sequence only for photos you want in the
                    photo report. Leave it blank to exclude a photo.
                  </p>

                  <div style={{ ...buttonRow, marginBottom: 16 }}>
                    <button
                      onClick={savePhotoSequence}
                      disabled={savingPhotoSequence}
                      style={{
                        ...button,
                        fontWeight: 900,
                        opacity: savingPhotoSequence ? 0.65 : 1,
                      }}
                    >
                      {savingPhotoSequence
                        ? "Saving Sequence..."
                        : "Save Sequencing"}
                    </button>

                    <button
                      onClick={generatePhotoReport}
                      disabled={generatingPhotoReport}
                      style={{
                        ...button,
                        fontWeight: 900,
                        opacity: generatingPhotoReport ? 0.65 : 1,
                      }}
                    >
                      {generatingPhotoReport
                        ? "Generating Photo Report..."
                        : "Generate Photo Report"}
                    </button>

                    <button
                      onClick={downloadSequencedPhotos}
                      disabled={downloadingPhotos}
                      style={{
                        ...button,
                        fontWeight: 900,
                        opacity: downloadingPhotos ? 0.65 : 1,
                      }}
                    >
                      {downloadingPhotos
                        ? "Downloading Photos..."
                        : "Download Photos"}
                    </button>
                  </div>

                  <div style={photoGrid}>
                    {photos.map((asset: any) =>
                      renderPhoto(asset, true)
                    )}
                  </div>
                </>
              ) : (
                <div style={recentPhotoGrid}>
                  {photos
                    .slice(0, 3)
                    .map((asset: any) => renderPhoto(asset, false))}
                </div>
              )}
            </section>

            <section style={card}>
              <div style={sectionHeader}>
                <div>
                  <h2 style={{ marginBottom: 4 }}>Documents</h2>
                  <div style={sectionCount}>
                    {documents.length} document
                    {documents.length === 1 ? "" : "s"}
                  </div>
                </div>

                {documents.length > 3 || showAllDocuments ? (
                  <button
                    onClick={() =>
                      setShowAllDocuments((current) => !current)
                    }
                    style={button}
                  >
                    {showAllDocuments
                      ? "Show Recent Documents"
                      : "View All Documents"}
                  </button>
                ) : null}
              </div>

              {documents.length === 0 ? (
                <p>No documents uploaded yet.</p>
              ) : (
                (showAllDocuments
                  ? documents
                  : documents.slice(0, 3)
                ).map((asset: any) => renderDocument(asset))
              )}
            </section>
          </>
        )
      })()}
    </div>
  )
}

const page: CSSProperties = { padding: 20, maxWidth: 1100, margin: "0 auto" }
const card: CSSProperties = { background: "#111827", color: "white", borderRadius: 14, padding: 20, marginBottom: 20 }
const sectionHeader: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }
const row: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 20, background: "#1f2937", borderRadius: 10, padding: 14, marginBottom: 10 }

const photoGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 18,
  alignItems: "start",
}

const recentPhotoGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 14,
  alignItems: "start",
}

const photoCard: CSSProperties = {
  background: "#1f2937",
  borderRadius: 12,
  padding: 12,
  minWidth: 0,
}

const photoPreviewButton: CSSProperties = {
  display: "block",
  width: "100%",
  border: "none",
  padding: 0,
  background: "#0b1220",
  borderRadius: 10,
  overflow: "hidden",
  cursor: "pointer",
}

const photoPreviewImage: CSSProperties = {
  display: "block",
  width: "100%",
  height: 280,
  objectFit: "contain",
  background: "#0b1220",
}

const photoPreviewPlaceholder: CSSProperties = {
  height: 280,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#cbd5e1",
}

const photoSequenceRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 10,
}

const photoSequenceInput: CSSProperties = {
  width: 140,
  padding: 9,
  fontSize: 15,
}

const photoDescription: CSSProperties = {
  whiteSpace: "pre-wrap",
  lineHeight: 1.45,
  marginBottom: 8,
}

const photoMeta: CSSProperties = {
  margin: "6px 0",
  opacity: 0.9,
}

const documentRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 20,
  background: "#1f2937",
  borderRadius: 10,
  padding: 14,
  marginBottom: 10,
}

const sectionCount: CSSProperties = {
  fontSize: 13,
  opacity: 0.72,
}

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
