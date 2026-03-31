import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import type { CSSProperties } from "react"

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE?.replace(/\/$/, "") ||
  "https://contractor-navigator.onrender.com"

const TENANT_SLUG =
  (import.meta as any).env?.VITE_TENANT_SLUG || "g2g-roofing"

type CalendarEvent = {
  id: number
  job_id?: number | null
  title?: string | null
  event_type?: string | null
  start_at?: string | null
  end_at?: string | null
  location?: string | null
  notes?: string | null
  status?: string | null
  assigned_to?: string | null
  created_by?: string | null
  customer_name?: string | null
  job_stage?: string | null
  job_address?: string | null
  created_at?: string | null
  updated_at?: string | null
}

function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

function fmtDate(value?: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [filters, setFilters] = useState({
    from: toLocalInputValue(startOfToday()),
    to: toLocalInputValue(addDays(startOfToday(), 30)),
  })

  const [form, setForm] = useState({
    job_id: "",
    title: "",
    event_type: "appointment",
    start_at: toLocalInputValue(new Date()),
    end_at: toLocalInputValue(addDays(new Date(), 0)),
    location: "",
    notes: "",
    status: "scheduled",
    assigned_to: "",
    created_by: "Steve",
  })

  useEffect(() => {
    void loadEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadEvents() {
    try {
      setLoading(true)
      setError("")
      setSuccess("")

      const params = new URLSearchParams()
      if (filters.from) params.set("from", new Date(filters.from).toISOString())
      if (filters.to) params.set("to", new Date(filters.to).toISOString())
      params.set("limit", "250")

      const res = await fetch(`${API_BASE}/admin/calendar/${TENANT_SLUG}?${params.toString()}`)
      const data = await res.json()

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Calendar load failed")
      }

      setEvents(Array.isArray(data.events) ? data.events : [])
    } catch (err: any) {
      setError(err?.message || "Calendar load failed")
    } finally {
      setLoading(false)
    }
  }

  async function createEvent() {
    try {
      setSaving(true)
      setError("")
      setSuccess("")

      if (!form.title.trim()) {
        throw new Error("Title is required.")
      }
      if (!form.start_at || !form.end_at) {
        throw new Error("Start and end are required.")
      }

      const payload = {
        job_id: form.job_id.trim() ? Number(form.job_id) : null,
        title: form.title.trim(),
        event_type: form.event_type,
        start_at: new Date(form.start_at).toISOString(),
        end_at: new Date(form.end_at).toISOString(),
        location: form.location.trim() || null,
        notes: form.notes.trim() || null,
        status: form.status,
        assigned_to: form.assigned_to.trim() || null,
        created_by: form.created_by.trim() || "Steve",
      }

      const res = await fetch(`${API_BASE}/admin/calendar/${TENANT_SLUG}/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Calendar create failed")
      }

      setSuccess("Calendar event created.")
      setForm({
        job_id: "",
        title: "",
        event_type: "appointment",
        start_at: toLocalInputValue(new Date()),
        end_at: toLocalInputValue(addDays(new Date(), 0)),
        location: "",
        notes: "",
        status: "scheduled",
        assigned_to: "",
        created_by: "Steve",
      })

      await loadEvents()
    } catch (err: any) {
      setError(err?.message || "Calendar create failed")
    } finally {
      setSaving(false)
    }
  }

  async function markComplete(eventId: number) {
    try {
      setError("")
      setSuccess("")

      const res = await fetch(`${API_BASE}/admin/calendar/${TENANT_SLUG}/${eventId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      })
      const data = await res.json()

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to update event")
      }

      setSuccess("Event marked completed.")
      await loadEvents()
    } catch (err: any) {
      setError(err?.message || "Failed to update event")
    }
  }

  async function deleteEvent(eventId: number) {
    const ok = window.confirm("Delete this calendar event?")
    if (!ok) return

    try {
      setError("")
      setSuccess("")

      const res = await fetch(`${API_BASE}/admin/calendar/${TENANT_SLUG}/${eventId}/delete`, {
        method: "POST",
      })
      const data = await res.json()

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to delete event")
      }

      setSuccess("Event deleted.")
      await loadEvents()
    } catch (err: any) {
      setError(err?.message || "Failed to delete event")
    }
  }

  const groupedEvents = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()

    const sorted = [...events].sort((a, b) => {
      const aTime = new Date(a.start_at || 0).getTime()
      const bTime = new Date(b.start_at || 0).getTime()
      return aTime - bTime
    })

    for (const event of sorted) {
      const key = event.start_at
        ? new Date(event.start_at).toLocaleDateString()
        : "No Date"
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(event)
    }

    return Array.from(map.entries())
  }, [events])

  return (
    <div style={wrap}>
      <div style={grid}>
        <section style={card}>
          <h1 style={title}>Calendar</h1>
          <div style={sub}>Schedule inspections, appointments, production dates, and job-linked events.</div>

          {error ? <div style={errorStyle}>{error}</div> : null}
          {success ? <div style={successStyle}>{success}</div> : null}

          <div style={formGrid}>
            <div>
              <label style={label}>Linked Job ID</label>
              <input
                style={input}
                value={form.job_id}
                onChange={(e) => setForm((p) => ({ ...p, job_id: e.target.value }))}
                placeholder="Optional"
              />
            </div>

            <div style={{ gridColumn: "span 2" }}>
              <label style={label}>Title</label>
              <input
                style={input}
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="Inspection, production start, job meeting, etc."
              />
            </div>

            <div>
              <label style={label}>Type</label>
              <select
                style={input}
                value={form.event_type}
                onChange={(e) => setForm((p) => ({ ...p, event_type: e.target.value }))}
              >
                <option value="appointment">appointment</option>
                <option value="inspection">inspection</option>
                <option value="estimate">estimate</option>
                <option value="production">production</option>
                <option value="follow_up">follow_up</option>
                <option value="meeting">meeting</option>
              </select>
            </div>

            <div>
              <label style={label}>Start</label>
              <input
                type="datetime-local"
                style={input}
                value={form.start_at}
                onChange={(e) => setForm((p) => ({ ...p, start_at: e.target.value }))}
              />
            </div>

            <div>
              <label style={label}>End</label>
              <input
                type="datetime-local"
                style={input}
                value={form.end_at}
                onChange={(e) => setForm((p) => ({ ...p, end_at: e.target.value }))}
              />
            </div>

            <div>
              <label style={label}>Assigned To</label>
              <input
                style={input}
                value={form.assigned_to}
                onChange={(e) => setForm((p) => ({ ...p, assigned_to: e.target.value }))}
                placeholder="Michelle, production, sales, etc."
              />
            </div>

            <div>
              <label style={label}>Created By</label>
              <input
                style={input}
                value={form.created_by}
                onChange={(e) => setForm((p) => ({ ...p, created_by: e.target.value }))}
              />
            </div>

            <div>
              <label style={label}>Status</label>
              <select
                style={input}
                value={form.status}
                onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
              >
                <option value="scheduled">scheduled</option>
                <option value="completed">completed</option>
                <option value="cancelled">cancelled</option>
              </select>
            </div>

            <div style={{ gridColumn: "span 3" }}>
              <label style={label}>Location</label>
              <input
                style={input}
                value={form.location}
                onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                placeholder="Property address, office, phone call, etc."
              />
            </div>

            <div style={{ gridColumn: "span 3" }}>
              <label style={label}>Notes</label>
              <textarea
                style={{ ...input, minHeight: 120, resize: "vertical" }}
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <button style={primaryButton} onClick={createEvent} disabled={saving}>
              {saving ? "Saving..." : "Create Calendar Event"}
            </button>
          </div>
        </section>

        <section style={card}>
          <h2 style={panelTitle}>View Range</h2>

          <div style={filterGrid}>
            <div>
              <label style={label}>From</label>
              <input
                type="datetime-local"
                style={input}
                value={filters.from}
                onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
              />
            </div>

            <div>
              <label style={label}>To</label>
              <input
                type="datetime-local"
                style={input}
                value={filters.to}
                onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
              />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <button style={secondaryButton} onClick={loadEvents}>
              Refresh Calendar
            </button>
          </div>

          <div style={{ marginTop: 22 }}>
            {loading ? (
              <div style={emptyBox}>Loading calendar…</div>
            ) : groupedEvents.length === 0 ? (
              <div style={emptyBox}>No calendar events in this range.</div>
            ) : (
              <div style={{ display: "grid", gap: 18 }}>
                {groupedEvents.map(([day, list]) => (
                  <div key={day}>
                    <div style={dayHeader}>{day}</div>

                    <div style={{ display: "grid", gap: 12 }}>
                      {list.map((event) => (
                        <div key={event.id} style={eventCard}>
                          <div style={eventTitleRow}>
                            <div>
                              <div style={eventTitle}>{event.title || "Untitled Event"}</div>
                              <div style={eventSub}>
                                {event.event_type || "appointment"} · {event.status || "scheduled"}
                              </div>
                            </div>

                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button style={smallButton} onClick={() => markComplete(event.id)}>
                                Complete
                              </button>
                              <button style={dangerButton} onClick={() => deleteEvent(event.id)}>
                                Delete
                              </button>
                            </div>
                          </div>

                          <div style={eventMeta}>Start: {fmtDate(event.start_at)}</div>
                          <div style={eventMeta}>End: {fmtDate(event.end_at)}</div>
                          <div style={eventMeta}>Assigned To: {event.assigned_to || "—"}</div>
                          <div style={eventMeta}>Location: {event.location || event.job_address || "—"}</div>
                          <div style={eventMeta}>Customer: {event.customer_name || "—"}</div>

                          {event.job_id ? (
                            <div style={{ marginTop: 10 }}>
                              <Link to={`/job/${event.job_id}`} style={jobLink}>
                                Open linked job #{event.job_id}
                              </Link>
                            </div>
                          ) : null}

                          {event.notes ? (
                            <div style={notesBox}>{event.notes}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

const wrap: CSSProperties = {
  maxWidth: "1200px",
  margin: "0 auto",
}

const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "20px",
  alignItems: "start",
}

const card: CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(81, 133, 255, 0.18)",
  borderRadius: "24px",
  padding: "22px",
}

const title: CSSProperties = {
  margin: 0,
  fontSize: "40px",
  lineHeight: 1.05,
}

const sub: CSSProperties = {
  marginTop: "10px",
  opacity: 0.82,
  fontSize: "15px",
  lineHeight: 1.5,
}

const panelTitle: CSSProperties = {
  margin: 0,
  fontSize: "26px",
}

const label: CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 700,
  marginBottom: "6px",
  color: "#d7e5ff",
}

const input: CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.08)",
  color: "white",
  outline: "none",
  fontSize: "15px",
  boxSizing: "border-box",
}

const formGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "14px",
  marginTop: "18px",
}

const filterGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "14px",
  marginTop: "18px",
}

const primaryButton: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "14px",
  border: "none",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "15px",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  color: "white",
}

const secondaryButton: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "14px",
  border: "1px solid rgba(255,255,255,0.12)",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "15px",
  background: "rgba(255,255,255,0.08)",
  color: "white",
}

const smallButton: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "12px",
  border: "1px solid rgba(255,255,255,0.12)",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "13px",
  background: "rgba(255,255,255,0.08)",
  color: "white",
}

const dangerButton: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "12px",
  border: "1px solid rgba(255,120,120,0.28)",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "13px",
  background: "rgba(255,80,80,0.16)",
  color: "#ffdede",
}

const errorStyle: CSSProperties = {
  marginTop: "16px",
  background: "rgba(255,90,90,0.12)",
  border: "1px solid rgba(255,90,90,0.3)",
  borderRadius: "14px",
  padding: "12px 14px",
  color: "#ffd7d7",
}

const successStyle: CSSProperties = {
  marginTop: "16px",
  background: "rgba(80,180,120,0.18)",
  border: "1px solid rgba(80,180,120,0.28)",
  borderRadius: "14px",
  padding: "12px 14px",
  color: "#dbffe7",
}

const emptyBox: CSSProperties = {
  marginTop: "18px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "16px",
  padding: "16px",
  opacity: 0.86,
}

const dayHeader: CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
  marginBottom: "10px",
}

const eventCard: CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  padding: "14px",
}

const eventTitleRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "flex-start",
  flexWrap: "wrap",
}

const eventTitle: CSSProperties = {
  fontWeight: 800,
  fontSize: "18px",
}

const eventSub: CSSProperties = {
  opacity: 0.75,
  marginTop: "4px",
  fontSize: "13px",
}

const eventMeta: CSSProperties = {
  marginTop: "8px",
  fontSize: "14px",
  opacity: 0.92,
}

const notesBox: CSSProperties = {
  marginTop: "12px",
  background: "rgba(255,255,255,0.04)",
  borderRadius: "14px",
  padding: "12px",
  whiteSpace: "pre-wrap",
  lineHeight: 1.5,
}

const jobLink: CSSProperties = {
  color: "#a9cbff",
  fontWeight: 700,
  textDecoration: "none",
}
