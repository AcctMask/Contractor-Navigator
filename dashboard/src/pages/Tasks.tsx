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


const TASK_STAGE_OPTIONS = [
  ["intake_pending", "Intake Pending"],
  ["lead", "Lead"],
  ["estimate_needed", "Estimate Needed"],
  ["inspection", "Inspection"],
  ["estimate_sent", "Estimate Sent"],
  ["contract_sent", "Contract Sent"],
  ["contract_signed", "Contract Signed"],
  ["pre_production", "Pre Production"],
  ["in_production", "In Production"],
  ["wa_sent", "WA Sent"],
  ["tarp", "Tarp"],
  ["tarp_complete", "Tarp Complete"],
  ["invoiced", "Invoiced"],
  ["completed", "Completed"],
  ["paid", "Paid"],
  ["disqualified", "Disqualified"],
  ["dnc", "DNC"],
] as const

function dateTimeLocalValue(value: Date) {
  if (!value || Number.isNaN(value.getTime())) return ""

  const adjusted =
    new Date(value.getTime() - value.getTimezoneOffset() * 60000)

  return adjusted.toISOString().slice(0, 16)
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
  job_stage?: string | null
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

type NavigatorTaskJob = {
  id: number
  customer_name?: string | null
  address1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

export default function TasksPage() {
  const navigate = useNavigate()

  const [events, setEvents] = useState<TaskItem[]>([])
  const [title, setTitle] = useState("")
  const [jobId, setJobId] = useState("")
  const [jobSearch, setJobSearch] = useState("")
  const [jobSearchResults, setJobSearchResults] = useState<any[]>([])
  const [jobSearchMessage, setJobSearchMessage] = useState("")
  const [jobs, setJobs] = useState<NavigatorTaskJob[]>([])
  const [startTime, setStartTime] = useState("")
  const [notes, setNotes] = useState("")
  const [eventType, setEventType] = useState("inspection")
  const [message, setMessage] = useState("")
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null)


  async function searchJobs() {
    const query = jobSearch.trim().toLowerCase()

    if (!query) {
      setJobSearchResults([])
      setJobSearchMessage(
        "Enter a customer name, phone, address, or job number."
      )
      return
    }

    setJobSearchMessage("Searching jobs...")

    const token = getToken()

    const res = await fetch(
      `${API_BASE}/admin/${getTenantSlug()}/jobs-all`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    )

    const data = await res.json()

    if (!res.ok) {
      setJobSearchResults([])
      setJobSearchMessage(
        data?.error || "Failed to search Navigator jobs"
      )
      return
    }

    const allJobs = Array.isArray(data.jobs) ? data.jobs : []
    const digits = query.replace(/\D/g, "")

    const matches = allJobs
      .filter((job: any) => {
        const values = [
          job.id,
          job.customer_name,
          job.customer_phone,
          job.phone,
          job.address1,
          job.address,
          job.city,
          job.state,
          job.zip,
        ]
          .filter(
            (value) =>
              value !== null &&
              value !== undefined
          )
          .map((value) =>
            String(value).toLowerCase()
          )

        if (
          values.some((value) =>
            value.includes(query)
          )
        ) {
          return true
        }

        if (digits) {
          return values.some((value) =>
            value
              .replace(/\D/g, "")
              .includes(digits)
          )
        }

        return false
      })
      .slice(0, 25)

    setJobSearchResults(matches)

    setJobSearchMessage(
      matches.length
        ? `${matches.length} matching job${
            matches.length === 1 ? "" : "s"
          }`
        : "No matching jobs found."
    )
  }

  async function loadTasks() {
    try {
      setMessage("Loading tasks...")

      const res = await fetch(`${API_BASE}/tasks/${getTenantSlug()}/events`)
      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Failed to load tasks")
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
        job_stage: e.job_stage || null,
      }))

      setEvents(mapped)
      setSelectedTask(current =>
        current ? mapped.find((event: TaskItem) => event.id === current.id) || null : null
      )
      setMessage("")
    } catch (err: any) {
      console.error("Task load failed:", err)
      setMessage(err?.message || "Failed to load tasks")
    }
  }


  async function createTask() {
    try {
      setMessage("Creating task...")

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
          end_time:
            startTime && startTime.includes("T") &&
            startTime.slice(11, 16) !== "12:00"
              ? new Date(
                  new Date(localDateTimeToIso(startTime)).getTime() +
                    60 * 60 * 1000
                ).toISOString()
              : null,
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
      alert("This task is not linked to a job yet. Add a Job ID when creating the task.")
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
        <h2 style={{ color: "white" }}>Create Task</h2>

        <label
          style={{
            display: "block",
            color: "white",
            marginBottom: 4,
          }}
        >
          <strong>Linked job</strong>
        </label>

        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <input
            value={jobSearch}
            onChange={(e) =>
              setJobSearch(e.target.value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void searchJobs()
              }
            }}
            placeholder="Search by name, phone, address, or job number"
            style={{
              ...inputStyle,
              flex: 1,
              marginBottom: 0,
            }}
          />

          <button
            type="button"
            onClick={() => void searchJobs()}
          >
            Search
          </button>
        </div>

        {jobSearchMessage ? (
          <div
            style={{
              color: "white",
              fontSize: 13,
              marginBottom: 8,
              opacity: 0.85,
            }}
          >
            {jobSearchMessage}
          </div>
        ) : null}

        {jobSearchResults.length > 0 ? (
          <div
            style={{
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 8,
              maxHeight: 260,
              overflowY: "auto",
              marginBottom: 12,
            }}
          >
            {jobSearchResults.map((job: any) => {
              const customer =
                String(
                  job.customer_name || ""
                ).trim() ||
                `Job ${job.id}`

              const address = [
                job.address1 || job.address,
                job.city,
                job.state,
                job.zip,
              ]
                .filter(Boolean)
                .join(", ")

              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => {
                    setJobId(String(job.id))
                    setJobs([job])
                    setJobSearch("")
                    setJobSearchResults([])
                    setJobSearchMessage("")
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    background: "transparent",
                    color: "white",
                    border: 0,
                    borderBottom:
                      "1px solid #1e293b",
                    cursor: "pointer",
                  }}
                >
                  <strong>{customer}</strong>
                  {" — "}Job {job.id}

                  {address ? (
                    <div
                      style={{
                        fontSize: 12,
                        opacity: 0.8,
                        marginTop: 3,
                      }}
                    >
                      {address}
                    </div>
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}

        {jobId ? (() => {
          const linkedJob = jobs.find(
            (job: any) =>
              String(job.id) === jobId
          )

          const customer =
            String(
              linkedJob?.customer_name || ""
            ).trim() ||
            `Navigator Job ${jobId}`

          const address = linkedJob
            ? [
                linkedJob.address1,
                linkedJob.city,
                linkedJob.state,
                linkedJob.zip,
              ]
                .filter(Boolean)
                .join(", ")
            : ""

          return (
            <div
              style={{
                background: "#172033",
                border: "1px solid #475569",
                borderRadius: 8,
                padding: "10px 12px",
                marginBottom: 12,
                color: "white",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  opacity: 0.7,
                  marginBottom: 3,
                }}
              >
                Linked job
              </div>

              <strong>
                {customer} — Job {jobId}
              </strong>

              {address ? (
                <div
                  style={{
                    fontSize: 12,
                    opacity: 0.8,
                    marginTop: 3,
                  }}
                >
                  {address}
                </div>
              ) : null}

              <div>
                <button
                  type="button"
                  onClick={() => {
                    setJobId("")
                    setJobs([])
                    setJobSearch("")
                    setJobSearchResults([])
                    setJobSearchMessage("")
                  }}
                  style={{ marginTop: 8 }}
                >
                  Change Job
                </button>
              </div>
            </div>
          )
        })() : (
          <div
            style={{
              color: "white",
              fontSize: 13,
              opacity: 0.7,
              marginBottom: 12,
            }}
          >
            No linked job selected.
          </div>
        )}

        <label style={{ display: "block", color: "white", marginBottom: 4 }}>
          <strong>Due date</strong>
        </label>
        <input
          type="date"
          value={startTime ? startTime.slice(0, 10) : ""}
          onClick={(e) => {
            const input = e.currentTarget as HTMLInputElement & {
              showPicker?: () => void
            }

            try {
              input.showPicker?.()
            } catch {
              // Browser-native date entry remains available.
            }
          }}
          onChange={(e) => {
            const date = e.target.value
            const existingTime =
              startTime && startTime.includes("T")
                ? startTime.slice(11, 16)
                : ""

            setStartTime(
              date
                ? `${date}T${existingTime || "12:00"}`
                : ""
            )
          }}
          style={inputStyle}
        />

        <label style={{ display: "block", color: "white", marginBottom: 4 }}>
          <strong>Time (optional)</strong>
        </label>
        <input
          type="time"
          value={
            startTime && startTime.includes("T") &&
            startTime.slice(11, 16) !== "12:00"
              ? startTime.slice(11, 16)
              : ""
          }
          onChange={(e) => {
            const date =
              startTime && startTime.includes("T")
                ? startTime.slice(0, 10)
                : ""

            if (!date) return

            setStartTime(
              `${date}T${e.target.value || "12:00"}`
            )
          }}
          style={inputStyle}
        />

        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          style={inputStyle}
        >
          {TASK_STAGE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>



        <input
          type="text"
          placeholder="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
        />

        <textarea
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ ...inputStyle, height: 70 }}
        />

        <button onClick={createTask} style={buttonStyle}>
          Create Task
        </button>

        <button onClick={loadTasks} style={buttonStyle}>
          Refresh Tasks
        </button>

        {message && <p style={{ color: "white" }}>{message}</p>}
      </div>

      {selectedTask && (
        <div style={{ background: "#111827", color: "white", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Selected Task</h2>
          <p><strong>Title:</strong> {selectedTask.title}</p>
          <p><strong>Customer:</strong> {selectedTask.customer_name || "Not linked"}</p>
          <p><strong>Job ID:</strong> {selectedTask.job_id || "Not linked"}</p>
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
            Delete Task
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
          <h2 style={{ marginTop: 0 }}>Tasks</h2>

          <div
            style={{
              fontSize: 13,
              opacity: 0.75,
              marginBottom: 12,
            }}
          >
            {events.length} {events.length === 1 ? "task" : "tasks"}
          </div>

          {events.length === 0 ? (
            <div
              style={{
                padding: "10px 8px",
                opacity: 0.7,
                fontSize: 13,
              }}
            >
              No tasks yet.
            </div>
          ) : (
            [...events]
              .sort((a, b) => a.start.getTime() - b.start.getTime())
              .map(task => {
                const presentation = stagePresentation(
                  task.stage_classification ||
                  task.event_type
                )

                const isSelected =
                  selectedTask?.id === task.id

                return (
                  <div
                    key={task.id}
                    onClick={() => handleSelectTask(task)}
                    style={{
                      background: presentation.backgroundColor,
                      border: isSelected
                        ? "3px solid #ffffff"
                        : `2px solid ${presentation.borderColor}`,
                      color: presentation.color,
                      borderRadius: 8,
                      padding: 10,
                      marginBottom: 8,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>
                      {task.title}
                    </div>

                    <div
                      style={{
                        fontSize: 13,
                        marginTop: 4,
                        opacity: 0.9,
                      }}
                    >
                      {task.start.toLocaleString("en-US", {
                        timeZone: EASTERN_TIME_ZONE,
                      })}
                    </div>

                    {task.customer_name && (
                      <div
                        style={{
                          fontSize: 13,
                          marginTop: 4,
                        }}
                      >
                        {task.customer_name}
                      </div>
                    )}

                    {task.job_id && (
                      <div
                        style={{
                          fontSize: 13,
                          marginTop: 3,
                          opacity: 0.9,
                        }}
                      >
                        Job {task.job_id}
                      </div>
                    )}

                  </div>
                )
              })
          )}
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
              event.event_type
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
