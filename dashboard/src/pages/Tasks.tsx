import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Calendar, dateFnsLocalizer } from "react-big-calendar"
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop"
import { format } from "date-fns/format"
import { parse } from "date-fns/parse"
import { startOfWeek } from "date-fns/startOfWeek"
import { getDay } from "date-fns/getDay"
import { enUS } from "date-fns/locale/en-US"
import "react-big-calendar/lib/css/react-big-calendar.css"
import "react-big-calendar/lib/addons/dragAndDrop/styles.css"
import { getTenantSlug } from "../lib/tenant"
import { getToken } from "../lib/auth"
import { stagePresentation } from "../lib/stagePresentation"

const API_BASE = import.meta.env.VITE_API_BASE || "https://contractor-navigator.onrender.com"
const EASTERN_TIME_ZONE = "America/New_York"

function localDateTimeToIso(value: string) {
  if (!value) return ""
  return new Date(value).toISOString()
}

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { "en-US": enUS },
})

const DraggableCalendar = withDragAndDrop(Calendar as any) as any

function dateTimeLocalValue(value: Date) {
  if (!value || Number.isNaN(value.getTime())) return ""

  const adjusted =
    new Date(value.getTime() - value.getTimezoneOffset() * 60000)

  return adjusted.toISOString().slice(0, 16)
}

const PRODUCTION_PLANNER_STAGES = [
  "inspection",
  "estimate_needed",
  "contract_signed",
  "pre_production",
  "tarp",
  "in_production",
] as const

type ProductionPlannerJob = {
  id: number
  address1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  stage?: string | null
  production_planner_explanation?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  customer_email?: string | null
  stage_since?: string | null
  crew_name?: string | null
  crew_app_user_id?: number | null
  crew_assigned_at?: string | null
}

function plannerStageLabel(stageValue?: string | null) {
  const stage = String(stageValue || "").trim().toLowerCase()

  switch (stage) {
    case "inspection":
      return "Inspection"
    case "estimate_needed":
      return "Estimate Needed"
    case "contract_signed":
      return "Contract Signed"
    case "pre_production":
      return "Pre-Production"
    case "tarp":
      return "Tarp"
    case "in_production":
      return "In Production"
    default:
      return stageValue || "Unknown"
  }
}

function plannerStageSince(value?: string | null) {
  if (!value) return "UNKNOWN"

  const entered = new Date(value)

  if (Number.isNaN(entered.getTime())) return "UNKNOWN"

  const elapsedMs = Date.now() - entered.getTime()
  const elapsedDays = Math.max(0, Math.floor(elapsedMs / 86400000))

  return `${entered.toLocaleDateString("en-US", {
    timeZone: EASTERN_TIME_ZONE,
  })} (${elapsedDays}d)`
}

type TaskItem = {
  id: number
  title: string
  stored_title: string
  start: Date
  end: Date
  job_id?: number | null
  location?: string
  notes?: string
  event_type?: string
  stage_classification?: string | null
  customer_name?: string
  job_address?: string
  automation_managed?: boolean
  automation_stage_key?: string | null
  job_stage?: string | null
}


function normalizedPlannerStage(value?: string | null) {
  return String(value || "").trim().toLowerCase()
}

function plannerRelevantEvent(
  job: ProductionPlannerJob,
  events: TaskItem[]
) {
  const currentStage = normalizedPlannerStage(job.stage)

  const candidates = events.filter(event => {
    if (Number(event.job_id) !== Number(job.id)) {
      return false
    }

    const automationStage = normalizedPlannerStage(
      event.automation_stage_key
    )

    const eventType = normalizedPlannerStage(
      event.event_type
    )

    if (
      event.automation_managed &&
      automationStage
    ) {
      return automationStage === currentStage
    }

    return eventType === currentStage
  })

  if (!candidates.length) {
    return null
  }

  return [...candidates].sort(
    (a, b) =>
      b.start.getTime() - a.start.getTime()
  )[0]
}

function plannerIsOverdue(
  job: ProductionPlannerJob,
  events: TaskItem[]
) {
  const obligation = plannerRelevantEvent(job, events)

  if (!obligation) {
    return false
  }

  return obligation.end.getTime() < Date.now()
}


function taskDisplayTitle(
  title?: string | null,
  customerName?: string | null
) {
  const storedTitle = String(title || "").trim()
  const customer = String(customerName || "").trim()

  if (!customer) {
    return storedTitle || "Untitled"
  }

  if (!storedTitle) {
    return customer
  }

  if (
    storedTitle
      .toLowerCase()
      .includes(customer.toLowerCase())
  ) {
    return storedTitle
  }

  return `${customer} — ${storedTitle}`
}

export default function TasksPage() {
  const navigate = useNavigate()

  const [events, setEvents] = useState<TaskItem[]>([])
  const [title, setTitle] = useState("")
  const [jobId, setJobId] = useState("")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [location, setLocation] = useState("")
  const [notes, setNotes] = useState("")
  const [eventType, setEventType] = useState("inspection")
  const [message, setMessage] = useState("")
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null)
  const [plannerJobs, setPlannerJobs] = useState<ProductionPlannerJob[]>([])
  const [plannerMessage, setPlannerMessage] = useState("")
  const [plannerExplanationDrafts, setPlannerExplanationDrafts] = useState<Record<number, string>>({})

  async function loadProductionPlanner() {
    try {
      setPlannerMessage("Loading Production Planner...")

      const res = await fetch(
        `${API_BASE}/admin/${getTenantSlug()}/production-planner`,
        {
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )

      const stageSincePreviewRes = await fetch(
        `${API_BASE}/admin/${getTenantSlug()}/production-planner/stage-since-preview`,
        {
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )

      const stageSincePreview = await stageSincePreviewRes.json()

      console.log(
        "========== NAVI 2.0 — SIX-STAGE STAGE-SINCE PREVIEW =========="
      )
      console.log(stageSincePreview)

      if (Array.isArray(stageSincePreview?.jobs)) {
        console.table(
          stageSincePreview.jobs.map((job: any) => ({
            job_id: job.job_id,
            customer_name: job.customer_name,
            current_stage: job.current_stage,
            current_stage_since: job.current_stage_since,
            recoverable_stage_since: job.recoverable_stage_since,
            recovery_source: job.recovery_source,
          }))
        )
      }

      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Failed to load Production Planner")
      }

      const jobs = data.jobs || []

      setPlannerJobs(jobs)
      setPlannerExplanationDrafts(
        Object.fromEntries(
          jobs.map((job: ProductionPlannerJob) => [
            Number(job.id),
            job.production_planner_explanation || "",
          ])
        )
      )
      setPlannerMessage("")
    } catch (err: any) {
      console.error("Production Planner load failed:", err)
      setPlannerMessage(
        err?.message || "Failed to load Production Planner"
      )
    }
  }

  async function savePlannerExplanation(job: ProductionPlannerJob) {
    try {
      setPlannerMessage(`Saving Production Planner update for Job ${job.id}...`)

      const nextExplanation =
        plannerExplanationDrafts[job.id] ?? ""

      const res = await fetch(
        `${API_BASE}/admin/${getTenantSlug()}/jobs/${job.id}/production-planner-explanation`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({
            explanation: nextExplanation,
          }),
        }
      )

      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(
          data?.error || "Failed to save Production Planner explanation"
        )
      }

      setPlannerMessage(
        data.changed
          ? `Production Planner updated for Job ${job.id}.`
          : `No Production Planner change for Job ${job.id}.`
      )

      await loadProductionPlanner()
    } catch (err: any) {
      console.error("Production Planner explanation save failed:", err)
      setPlannerMessage(
        err?.message || "Failed to save Production Planner explanation"
      )
    }
  }

  async function loadTasks() {
    try {
      setMessage("Loading tasks...")

      const res = await fetch(`${API_BASE}/tasks/${getTenantSlug()}/events`)
      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Failed to load events")
      }

      const mapped = (data.events || []).map((e: any) => ({
        id: Number(e.id),
        title: taskDisplayTitle(e.title, e.customer_name),
        stored_title: e.title || e.customer_name || "Untitled",
        start: new Date(e.start_time),
        end: new Date(e.end_time || e.start_time),
        job_id: e.job_id ? Number(e.job_id) : null,
        location: e.location || e.job_address || "",
        notes: e.notes || "",
        event_type: e.event_type || "",
        stage_classification: e.stage_classification || e.event_type || null,
        customer_name: e.customer_name || "",
        job_address: e.job_address || "",
        automation_managed: Boolean(e.automation_managed),
        automation_stage_key: e.automation_stage_key || null,
        job_stage: e.job_stage || null,
      }))

      setEvents(mapped)
      setSelectedTask(current =>
        current ? mapped.find((event: TaskItem) => event.id === current.id) || null : null
      )
      setMessage("")
    } catch (err: any) {
      console.error("Task load failed:", err)
      setMessage(err?.message || "Failed to load events")
    }
  }

  function preparePlannerSchedule(job: ProductionPlannerJob) {
    const stage = normalizedPlannerStage(job.stage)
    const existing = plannerRelevantEvent(job, events)

    setJobId(String(job.id))
    setEventType(stage || "general")

    setTitle(
      `${plannerStageLabel(job.stage)} — Job ${job.id}`
    )

    setLocation(
      [job.address1, job.city, job.state, job.zip]
        .filter(Boolean)
        .join(", ")
    )

    setNotes(
      job.production_planner_explanation || ""
    )

    if (existing) {
      setStartTime(
        dateTimeLocalValue(existing.start)
      )

      setEndTime(
        dateTimeLocalValue(existing.end)
      )

      setMessage(
        `Job ${job.id} already has a matching ${plannerStageLabel(
          job.stage
        )} calendar obligation. Select the existing event to drag, resize, or edit it.`
      )
    } else {
      setStartTime("")
      setEndTime("")

      setMessage(
        `Job ${job.id} loaded into the existing Calendar form. Choose the date and time, then create the event.`
      )
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    })
  }

  async function createTask() {
    try {
      setMessage("Creating event...")

      const res = await fetch(`${API_BASE}/tasks/${getTenantSlug()}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          title,
          job_id: jobId ? Number(jobId) : null,
          start_time: localDateTimeToIso(startTime),
          end_time: endTime ? localDateTimeToIso(endTime) : null,
          location,
          notes,
          event_type: eventType,
          stage_classification: eventType,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Task create failed")
      }

      setTitle("")
      setJobId("")
      setStartTime("")
      setEndTime("")
      setLocation("")
      setNotes("")
      setEventType("inspection")
      setMessage("Task created.")

      await loadTasks()
    } catch (err: any) {
      console.error("Task create failed:", err)
      setMessage(err?.message || "Task create failed")
    }
  }

  function handleSelectTask(event: TaskItem) {
    setSelectedTask(event)
  }

  function openSelectedJob() {
    if (!selectedTask?.job_id) {
      alert("This task is not linked to a job yet. Add a Job ID when creating the event.")
      return
    }

    navigate(`/job/${selectedTask.job_id}`)
  }

  async function deleteSelectedTask() {
    if (!selectedTask) return

    const confirmed = window.confirm(`Delete task: ${selectedTask.title}?`)
    if (!confirmed) return

    try {
      setMessage("Deleting task...")

      const res = await fetch(`${API_BASE}/tasks/${getTenantSlug()}/events/${selectedTask.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      })

      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Task delete failed")
      }

      setSelectedTask(null)
      setMessage("Task deleted.")
      await loadTasks()
    } catch (err: any) {
      console.error("Task delete failed:", err)
      setMessage(err?.message || "Task delete failed")
    }
  }

  function tooltip(event: TaskItem) {
    return [
      event.title,
      `Time: ${event.start.toLocaleString("en-US", { timeZone: EASTERN_TIME_ZONE })} - ${event.end.toLocaleString("en-US", { timeZone: EASTERN_TIME_ZONE })}`,
      `Location: ${event.location || "Not provided"}`,
      `Job ID: ${event.job_id || "Not linked"}`,
      `Notes: ${event.notes || "None"}`,
    ].join("\n")
  }

  async function saveTaskTiming(
    event: TaskItem,
    start: Date,
    end: Date,
    auditSource: string,
  ) {
    try {
      setMessage("Saving task change...")

      const res = await fetch(
        `${API_BASE}/tasks/${getTenantSlug()}/events/${event.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({
            title: event.stored_title,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            location: event.location || "",
            notes: event.notes || "",
            event_type: event.event_type || "general",
            stage_classification:
              event.stage_classification || event.event_type || null,
            audit_source: auditSource,
          }),
        }
      )

      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Task update failed")
      }

      setMessage("Task updated.")
      await loadTasks()
    } catch (err: any) {
      console.error("Task update failed:", err)
      setMessage(err?.message || "Task update failed")
      await loadTasks()
    }
  }

  async function saveSelectedTiming() {
    if (!selectedTask) return

    await saveTaskTiming(
      selectedTask,
      selectedTask.start,
      selectedTask.end,
      "task_manual_datetime_edit",
    )
  }

  async function handleTaskDrop({
    event,
    start,
  }: any) {
    const calendarEvent = event as TaskItem
    const droppedDate = new Date(start)

    // Dragging changes the calendar date only.
    // Preserve the event's existing local clock time and duration.
    const nextStart = new Date(calendarEvent.start)
    nextStart.setFullYear(
      droppedDate.getFullYear(),
      droppedDate.getMonth(),
      droppedDate.getDate(),
    )

    const durationMs =
      calendarEvent.end.getTime() - calendarEvent.start.getTime()
    const nextEnd = new Date(nextStart.getTime() + durationMs)

    await saveTaskTiming(
      calendarEvent,
      nextStart,
      nextEnd,
      "task_drag_drop",
    )
  }

  async function handleTaskResize({
    event,
    start,
    end,
  }: any) {
    await saveTaskTiming(
      event as TaskItem,
      new Date(start),
      new Date(end),
      "task_resize",
    )
  }

  useEffect(() => {
    loadTasks()
    loadProductionPlanner()
  }, [])

  return (
    <div style={{ padding: 20 }}>
      <style>{`
        .rbc-calendar, .rbc-calendar * {
          color: #111827;
        }
        .rbc-toolbar button {
          color: #111827;
        }
        .rbc-event {
          cursor: pointer;
        }
      `}</style>

      <h1 style={{ color: "white" }}>Tasks</h1>

      <div style={{ marginBottom: 20 }}>
        <h2 style={{ color: "white" }}>Create Calendar Event</h2>

        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
        />

        <input
          placeholder="Job ID optional, required for click-through"
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          style={inputStyle}
        />

        <input
          type="datetime-local"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          style={inputStyle}
        />

        <input
          type="datetime-local"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          style={inputStyle}
        />

        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          style={inputStyle}
        >
          <option value="inspection">inspection</option>
          <option value="callback">callback</option>
          <option value="roof_repair">roof_repair</option>
          <option value="roof_replacement">roof_replacement</option>
          <option value="tarp">tarp</option>
          <option value="production">production</option>
        </select>

        <input
          placeholder="Location / full address"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          style={inputStyle}
        />

        <textarea
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ ...inputStyle, height: 70 }}
        />

        <button onClick={createTask} style={buttonStyle}>
          Create Calendar Event
        </button>

        <button onClick={loadTasks} style={buttonStyle}>
          Refresh Calendar
        </button>

        {message && <p style={{ color: "white" }}>{message}</p>}
      </div>

      {selectedTask && (
        <div style={{ background: "#111827", color: "white", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Selected Event</h2>
          <p><strong>Title:</strong> {selectedTask.title}</p>
          <p><strong>Customer:</strong> {selectedTask.customer_name || "Not linked"}</p>
          <p><strong>Job ID:</strong> {selectedTask.job_id || "Not linked"}</p>
          <p><strong>Location:</strong> {selectedTask.location || "Not provided"}</p>
          <p><strong>Notes:</strong> {selectedTask.notes || "None"}</p>

          <label style={{ display: "block", marginTop: 12 }}>
            <strong>Start date / time</strong>
          </label>
          <input
            type="datetime-local"
            value={dateTimeLocalValue(selectedTask.start)}
            onChange={(e) =>
              setSelectedTask({
                ...selectedTask,
                start: new Date(e.target.value),
              })
            }
            style={inputStyle}
          />

          <label style={{ display: "block", marginTop: 8 }}>
            <strong>End date / time</strong>
          </label>
          <input
            type="datetime-local"
            value={dateTimeLocalValue(selectedTask.end)}
            onChange={(e) =>
              setSelectedTask({
                ...selectedTask,
                end: new Date(e.target.value),
              })
            }
            style={inputStyle}
          />

          <button onClick={saveSelectedTiming} style={buttonStyle}>
            Save Date / Time
          </button>

          <button onClick={openSelectedJob} style={buttonStyle}>
            Open Job
          </button>

          <button onClick={deleteSelectedTask} style={{ ...buttonStyle, background: "#991b1b", color: "white" }}>
            Delete Event
          </button>

          <button onClick={() => setSelectedTask(null)} style={buttonStyle}>
            Clear Selection
          </button>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div
          style={{
            background: "#111827",
            color: "white",
            borderRadius: 12,
            padding: 14,
            maxHeight: 650,
            overflowY: "auto",
          }}
        >
          <h2 style={{ marginTop: 0 }}>Production Planner</h2>

          {plannerMessage && (
            <p style={{ opacity: 0.8 }}>{plannerMessage}</p>
          )}

          {PRODUCTION_PLANNER_STAGES.map(stage => {
            const presentation = stagePresentation(stage)
            const jobs = plannerJobs.filter(
              job =>
                String(job.stage || "").trim().toLowerCase() === stage
            )

            return (
              <div key={stage} style={{ marginBottom: 16 }}>
                <div
                  style={{
                    background: presentation.backgroundColor,
                    border: `2px solid ${presentation.borderColor}`,
                    color: presentation.color,
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  {plannerStageLabel(stage)} ({jobs.length})
                </div>

                {jobs.length === 0 ? (
                  <div
                    style={{
                      padding: "6px 8px",
                      opacity: 0.65,
                      fontSize: 13,
                    }}
                  >
                    No jobs
                  </div>
                ) : (
                  jobs.map(job => {
                    const relevantEvent =
                      plannerRelevantEvent(job, events)

                    const overdue =
                      plannerIsOverdue(job, events)

                    return (
                    <div
                      key={job.id}
                      onClick={() => navigate(`/job/${job.id}`)}
                      style={{
                        background: overdue
                          ? "#6b21a8"
                          : presentation.backgroundColor,
                        border: overdue
                          ? "2px solid #a855f7"
                          : `2px solid ${presentation.borderColor}`,
                        color: overdue
                          ? "#ffffff"
                          : presentation.color,
                        borderRadius: 8,
                        padding: 10,
                        marginBottom: 6,
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>
                        {job.customer_name || `Job ${job.id}`}
                      </div>

                      <div style={{ fontSize: 13, opacity: 0.9 }}>
                        Job {job.id}
                        {job.address1 ? ` — ${job.address1}` : ""}
                      </div>

                      <div style={{ fontSize: 13, marginTop: 5 }}>
                        <strong>Stage Since:</strong>{" "}
                        {plannerStageSince(job.stage_since)}
                      </div>

                      <div
                        style={{ fontSize: 13, marginTop: 6 }}
                        onClick={e => e.stopPropagation()}
                      >
                        <strong>Why:</strong>

                        <textarea
                          value={
                            plannerExplanationDrafts[job.id] ?? ""
                          }
                          onChange={e =>
                            setPlannerExplanationDrafts(current => ({
                              ...current,
                              [job.id]: e.target.value,
                            }))
                          }
                          placeholder="Current production explanation"
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            marginTop: 4,
                            minHeight: 54,
                            resize: "vertical",
                          }}
                        />

                        <button
                          onClick={() => savePlannerExplanation(job)}
                          style={{
                            ...buttonStyle,
                            marginTop: 4,
                            padding: "6px 9px",
                          }}
                        >
                          Save Why
                        </button>
                      </div>

                      <div style={{ fontSize: 13, marginTop: 5 }}>
                        <strong>Crew/Sub:</strong>{" "}
                        {job.crew_name || "Unassigned"}
                      </div>

                      <div
                        style={{
                          fontSize: 13,
                          marginTop: 6,
                        }}
                        onClick={e => e.stopPropagation()}
                      >
                        <strong>Schedule:</strong>{" "}
                        {relevantEvent
                          ? relevantEvent.start.toLocaleString(
                              "en-US",
                              {
                                timeZone:
                                  EASTERN_TIME_ZONE,
                              }
                            )
                          : "Not scheduled"}

                        {overdue && (
                          <div
                            style={{
                              marginTop: 4,
                              fontWeight: 800,
                            }}
                          >
                            OVERDUE
                          </div>
                        )}

                        <button
                          onClick={() =>
                            preparePlannerSchedule(job)
                          }
                          style={{
                            ...buttonStyle,
                            marginTop: 5,
                            padding: "6px 9px",
                          }}
                        >
                          {relevantEvent
                            ? "View / Reschedule"
                            : "Schedule"}
                        </button>
                      </div>
                    </div>
                    )
                  })
                )}
              </div>
            )
          })}
        </div>

        <div style={{ background: "white", borderRadius: 12, padding: 12, height: 650 }}>
          <DraggableCalendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          tooltipAccessor={tooltip}
          eventPropGetter={(event: TaskItem) => {
            const heat = stagePresentation(
              event.stage_classification ||
              event.event_type ||
              event.automation_stage_key
            )

            return {
              style: {
                backgroundColor: heat.backgroundColor,
                borderColor: heat.borderColor,
                color: heat.color,
                borderWidth: 2,
                borderStyle: "solid",
                fontWeight: 700,
              },
            }
          }}
          onSelectEvent={handleSelectTask}
          onEventDrop={handleTaskDrop}
          onEventResize={handleTaskResize}
          resizable
          views={["month", "week", "day", "agenda"]}
          culture="en-US"
          style={{ height: "100%" }}
          />
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: 900,
  marginBottom: 8,
  padding: 10,
  boxSizing: "border-box",
}

const buttonStyle: React.CSSProperties = {
  marginRight: 8,
  marginTop: 8,
  padding: "10px 14px",
  cursor: "pointer",
}
