import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Calendar, dateFnsLocalizer } from "react-big-calendar"
import { format } from "date-fns/format"
import { parse } from "date-fns/parse"
import { startOfWeek } from "date-fns/startOfWeek"
import { getDay } from "date-fns/getDay"
import { enUS } from "date-fns/locale/en-US"
import "react-big-calendar/lib/css/react-big-calendar.css"

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787"
const TENANT = "g2g-roofing"

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { "en-US": enUS },
})

type CalendarEvent = {
  id: number
  title: string
  start: Date
  end: Date
  job_id?: number | null
  location?: string
  notes?: string
  event_type?: string
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

  async function loadEvents() {
    try {
      setMessage("Loading calendar...")

      const res = await fetch(`${API_BASE}/calendar/${TENANT}/events`)
      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Failed to load events")
      }

      const mapped = (data.events || []).map((e: any) => ({
        id: Number(e.id),
        title: `${e.event_type || "event"}: ${e.title || "Untitled"}`,
        start: new Date(e.start_time),
        end: new Date(e.end_time),
        job_id: e.job_id ? Number(e.job_id) : null,
        location: e.location || "",
        notes: e.notes || "",
        event_type: e.event_type || "",
      }))

      setEvents(mapped)
      setMessage("")
    } catch (err: any) {
      console.error("Calendar load failed:", err)
      setMessage(err?.message || "Failed to load events")
    }
  }

  async function createEvent() {
    try {
      setMessage("Creating event...")

      const res = await fetch(`${API_BASE}/calendar/${TENANT}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          job_id: jobId ? Number(jobId) : null,
          start_time: startTime,
          end_time: endTime,
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
    if (event.job_id) {
      navigate(`/job-admin?jobId=${event.job_id}`)
      return
    }

    alert("This calendar event is not linked to a job yet. Add a Job ID when creating the event.")
  }

  function tooltip(event: CalendarEvent) {
    return [
      event.title,
      `Time: ${event.start.toLocaleString()} - ${event.end.toLocaleString()}`,
      `Location: ${event.location || "Not provided"}`,
      `Job ID: ${event.job_id || "Not linked"}`,
      `Notes: ${event.notes || "None"}`,
    ].join("\n")
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

      <div style={{ background: "white", borderRadius: 12, padding: 12, height: 650 }}>
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          tooltipAccessor={tooltip}
          onSelectEvent={handleSelectEvent}
          views={["month", "week", "day", "agenda"]}
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
