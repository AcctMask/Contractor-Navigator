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

type CalendarEvent = {
  id: number
  title: string
  start: Date
  end: Date
  job_id?: number | null
  location?: string
  notes?: string
  event_type?: string
  customer_name?: string
  job_address?: string
  automation_managed?: boolean
  automation_stage_key?: string | null
}

export default function CalendarPage() {
  const navigate = useNavigate()

  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [title, setTitle] = useState("")
  const [jobId, setJobId] = useState("")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [location, setLocation] = useState("")
  const [notes, setNotes] = useState("")
  const [eventType, setEventType] = useState("inspection")
  const [message, setMessage] = useState("")
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)

  async function loadEvents() {
    try {
      setMessage("Loading calendar...")

      const res = await fetch(`${API_BASE}/calendar/${getTenantSlug()}/events`)
      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Failed to load events")
      }

      const mapped = (data.events || []).map((e: any) => ({
        id: Number(e.id),
        title: e.title || e.customer_name || "Untitled",
        start: new Date(e.start_time),
        end: new Date(e.end_time || e.start_time),
        job_id: e.job_id ? Number(e.job_id) : null,
        location: e.location || e.job_address || "",
        notes: e.notes || "",
        event_type: e.event_type || "",
        customer_name: e.customer_name || "",
        job_address: e.job_address || "",
        automation_managed: Boolean(e.automation_managed),
        automation_stage_key: e.automation_stage_key || null,
      }))

      setEvents(mapped)
      setSelectedEvent(current =>
        current ? mapped.find((event: CalendarEvent) => event.id === current.id) || null : null
      )
      setMessage("")
    } catch (err: any) {
      console.error("Calendar load failed:", err)
      setMessage(err?.message || "Failed to load events")
    }
  }

  async function createEvent() {
    try {
      setMessage("Creating event...")

      const res = await fetch(`${API_BASE}/calendar/${getTenantSlug()}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          job_id: jobId ? Number(jobId) : null,
          start_time: localDateTimeToIso(startTime),
          end_time: endTime ? localDateTimeToIso(endTime) : null,
          location,
          notes,
          event_type: eventType,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Calendar create failed")
      }

      setTitle("")
      setJobId("")
      setStartTime("")
      setEndTime("")
      setLocation("")
      setNotes("")
      setEventType("inspection")
      setMessage("Calendar event created.")

      await loadEvents()
    } catch (err: any) {
      console.error("Calendar create failed:", err)
      setMessage(err?.message || "Calendar create failed")
    }
  }

  function handleSelectEvent(event: CalendarEvent) {
    setSelectedEvent(event)
  }

  function openSelectedJob() {
    if (!selectedEvent?.job_id) {
      alert("This calendar event is not linked to a job yet. Add a Job ID when creating the event.")
      return
    }

    navigate(`/job/${selectedEvent.job_id}`)
  }

  async function deleteSelectedEvent() {
    if (!selectedEvent) return

    const confirmed = window.confirm(`Delete calendar event: ${selectedEvent.title}?`)
    if (!confirmed) return

    try {
      setMessage("Deleting calendar event...")

      const res = await fetch(`${API_BASE}/calendar/${getTenantSlug()}/events/${selectedEvent.id}`, {
        method: "DELETE",
      })

      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Calendar delete failed")
      }

      setSelectedEvent(null)
      setMessage("Calendar event deleted.")
      await loadEvents()
    } catch (err: any) {
      console.error("Calendar delete failed:", err)
      setMessage(err?.message || "Calendar delete failed")
    }
  }

  function tooltip(event: CalendarEvent) {
    return [
      event.title,
      `Time: ${event.start.toLocaleString("en-US", { timeZone: EASTERN_TIME_ZONE })} - ${event.end.toLocaleString("en-US", { timeZone: EASTERN_TIME_ZONE })}`,
      `Location: ${event.location || "Not provided"}`,
      `Job ID: ${event.job_id || "Not linked"}`,
      `Notes: ${event.notes || "None"}`,
    ].join("\n")
  }

  async function saveCalendarTiming(
    event: CalendarEvent,
    start: Date,
    end: Date,
    auditSource: string,
  ) {
    try {
      setMessage("Saving calendar change...")

      const res = await fetch(
        `${API_BASE}/calendar/${getTenantSlug()}/events/${event.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: event.title,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            location: event.location || "",
            notes: event.notes || "",
            event_type: event.event_type || "general",
            audit_source: auditSource,
          }),
        }
      )

      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Calendar update failed")
      }

      setMessage("Calendar event updated.")
      await loadEvents()
    } catch (err: any) {
      console.error("Calendar update failed:", err)
      setMessage(err?.message || "Calendar update failed")
      await loadEvents()
    }
  }

  async function saveSelectedTiming() {
    if (!selectedEvent) return

    await saveCalendarTiming(
      selectedEvent,
      selectedEvent.start,
      selectedEvent.end,
      "calendar_manual_datetime_edit",
    )
  }

  async function handleEventDrop({
    event,
    start,
  }: any) {
    const calendarEvent = event as CalendarEvent
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

    await saveCalendarTiming(
      calendarEvent,
      nextStart,
      nextEnd,
      "calendar_drag_drop",
    )
  }

  async function handleEventResize({
    event,
    start,
    end,
  }: any) {
    await saveCalendarTiming(
      event as CalendarEvent,
      new Date(start),
      new Date(end),
      "calendar_resize",
    )
  }

  useEffect(() => {
    loadEvents()
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

      <h1 style={{ color: "white" }}>Calendar</h1>

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

        <button onClick={createEvent} style={buttonStyle}>
          Create Calendar Event
        </button>

        <button onClick={loadEvents} style={buttonStyle}>
          Refresh Calendar
        </button>

        {message && <p style={{ color: "white" }}>{message}</p>}
      </div>

      {selectedEvent && (
        <div style={{ background: "#111827", color: "white", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Selected Event</h2>
          <p><strong>Title:</strong> {selectedEvent.title}</p>
          <p><strong>Customer:</strong> {selectedEvent.customer_name || "Not linked"}</p>
          <p><strong>Job ID:</strong> {selectedEvent.job_id || "Not linked"}</p>
          <p><strong>Location:</strong> {selectedEvent.location || "Not provided"}</p>
          <p><strong>Notes:</strong> {selectedEvent.notes || "None"}</p>

          <label style={{ display: "block", marginTop: 12 }}>
            <strong>Start date / time</strong>
          </label>
          <input
            type="datetime-local"
            value={dateTimeLocalValue(selectedEvent.start)}
            onChange={(e) =>
              setSelectedEvent({
                ...selectedEvent,
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
            value={dateTimeLocalValue(selectedEvent.end)}
            onChange={(e) =>
              setSelectedEvent({
                ...selectedEvent,
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

          <button onClick={deleteSelectedEvent} style={{ ...buttonStyle, background: "#991b1b", color: "white" }}>
            Delete Event
          </button>

          <button onClick={() => setSelectedEvent(null)} style={buttonStyle}>
            Clear Selection
          </button>
        </div>
      )}

      <div style={{ background: "white", borderRadius: 12, padding: 12, height: 650 }}>
        <DraggableCalendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          tooltipAccessor={tooltip}
          onSelectEvent={handleSelectEvent}
          onEventDrop={handleEventDrop}
          onEventResize={handleEventResize}
          resizable
          views={["month", "week", "day", "agenda"]}
          culture="en-US"
          style={{ height: "100%" }}
        />
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
