import { useEffect, useState } from "react"
import { clearToken, getToken } from "../lib/auth"

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://contractor-navigator.onrender.com"

type CrewJob = {
  id: number
  external_job_id?: string | null
  address1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  assigned_at?: string | null
}


type SmsRecipient = {
  id: number
  email: string
  role: string
  recipient_type: "sub" | "staff"
}

type SmsMessage = {
  id: number
  message: string
  created_at: string
}

function CrewSmsPanel({
  jobId,
  spanish,
}: {
  jobId: number
  spanish: boolean
}) {
  const [recipients, setRecipients] = useState<SmsRecipient[]>([])
  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [selected, setSelected] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)

  async function api(path: string, options: RequestInit = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      cache: "no-store",
    })

    const result = await response.json()

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "SMS request failed")
    }

    return result
  }

  async function refresh() {
    setLoading(true)
    setError("")

    try {
      const [recipientData, historyData] = await Promise.all([
        api(`/workforce/crew/${jobId}/sms-recipients`),
        api(`/workforce/crew/${jobId}/conversations`),
      ])

      setRecipients(
        Array.isArray(recipientData.recipients)
          ? recipientData.recipients
          : []
      )

      setMessages(
        Array.isArray(historyData.messages)
          ? historyData.messages
          : []
      )
    } catch (err: any) {
      setError(err?.message || "Unable to load SMS")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [jobId])

  async function send() {
    if (!selected || !message.trim() || sending) return

    const [recipient_type, recipient_id] = selected.split(":")

    setSending(true)
    setError("")
    setStatus("")

    try {
      await api(`/workforce/crew/${jobId}/reply-sms`, {
        method: "POST",
        body: JSON.stringify({
          recipient_type,
          recipient_id: Number(recipient_id),
          message: message.trim(),
        }),
      })

      setMessage("")
      setStatus(spanish ? "SMS enviado." : "SMS sent.")
      await refresh()
    } catch (err: any) {
      setError(err?.message || "SMS could not be sent")
    } finally {
      setSending(false)
    }
  }

  return (
    <section style={{ marginTop: 20 }}>
      <h3>{spanish ? "Mensajes SMS" : "SMS messages"}</h3>

      <button type="button" onClick={() => void refresh()} disabled={loading}>
        {spanish ? "Actualizar mensajes" : "Refresh messages"}
      </button>

      {error && <p role="alert" style={{ color: "#fecaca" }}>{error}</p>}
      {status && <p role="status">{status}</p>}

      <label style={{ display: "block", marginTop: 12 }}>
        {spanish ? "Destinatario" : "Recipient"}
      </label>

      <select
        value={selected}
        onChange={event => setSelected(event.target.value)}
        style={{ width: "100%", padding: 10, marginTop: 6 }}
      >
        <option value="">
          {spanish ? "Seleccione un destinatario" : "Select recipient"}
        </option>

        {recipients.map(recipient => (
          <option
            key={`${recipient.recipient_type}:${recipient.id}`}
            value={`${recipient.recipient_type}:${recipient.id}`}
          >
            {recipient.email} ({recipient.role})
          </option>
        ))}
      </select>

      <label style={{ display: "block", marginTop: 12 }}>
        {spanish ? "Mensaje" : "Message"}
      </label>

      <textarea
        value={message}
        onChange={event => setMessage(event.target.value)}
        maxLength={1500}
        rows={3}
        style={{ width: "100%", padding: 10, marginTop: 6 }}
      />

      <button
        type="button"
        onClick={() => void send()}
        disabled={!selected || !message.trim() || sending}
        style={{ marginTop: 10, padding: 10 }}
      >
        {sending
          ? (spanish ? "Enviando..." : "Sending...")
          : (spanish ? "Enviar SMS" : "Send SMS")}
      </button>

      <h4>{spanish ? "Historial" : "Message history"}</h4>

      {messages.length === 0 && (
        <p>{spanish ? "Sin mensajes." : "No messages."}</p>
      )}

      {messages.map(item => (
        <div
          key={item.id}
          style={{
            padding: 10,
            marginBottom: 8,
            background: "#24456e",
            borderRadius: 8,
            whiteSpace: "pre-wrap",
          }}
        >
          <small>{new Date(item.created_at).toLocaleString()}</small>
          <p>{item.message}</p>
        </div>
      ))}
    </section>
  )
}

export default function CrewPortal() {
  const [jobs, setJobs] = useState<CrewJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [language, setLanguage] = useState<"en" | "es">("en")

  const spanish = language === "es"

  async function loadJobs() {
    setLoading(true)
    setError("")

    try {
      const response = await fetch(
        `${API_BASE}/workforce/crew/my-jobs`,
        {
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
          cache: "no-store",
        }
      )

      const result = await response.json()

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error || "Unable to load assignments"
        )
      }

      setJobs(Array.isArray(result.jobs) ? result.jobs : [])
    } catch (err: any) {
      setJobs([])
      setError(err?.message || "Unable to load assignments")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadJobs()
  }, [])

  function logout() {
    clearToken()
    window.location.assign("/login")
  }

  return (
    <main style={{
      minHeight: "100vh",
      background: "#0f2344",
      color: "#fff",
      padding: 20,
      fontFamily: "Arial, sans-serif",
    }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <header style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}>
          <h1>
            {spanish ? "Mis trabajos" : "My jobs"}
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setLanguage(
              spanish ? "en" : "es"
            )}>
              {spanish ? "English" : "Español"}
            </button>
            <button onClick={logout}>
              {spanish ? "Salir" : "Logout"}
            </button>
          </div>
        </header>

        <p>
          {spanish
            ? "Solo se muestran sus trabajos asignados y autorizados."
            : "Only your authorized assigned jobs appear here."}
        </p>

        <button onClick={() => void loadJobs()} disabled={loading}>
          {spanish ? "Actualizar trabajos" : "Refresh jobs"}
        </button>

        {loading && <p>
          {spanish ? "Cargando..." : "Loading..."}
        </p>}

        {error && <p role="alert" style={{ color: "#fecaca" }}>
          {error}
        </p>}

        {!loading && !error && jobs.length === 0 && (
          <p>
            {spanish
              ? "No tiene trabajos activos asignados."
              : "No active job assignments."}
          </p>
        )}

        <div style={{
          display: "grid",
          gap: 12,
          marginTop: 20,
        }}>
          {jobs.map(job => (
            <article key={job.id} style={{
              background: "#19375e",
              padding: 18,
              borderRadius: 12,
              border: "1px solid #42618b",
            }}>
              <h2 style={{ marginTop: 0 }}>
                {spanish ? "Trabajo" : "Job"} #{job.id}
              </h2>
              <p>
                {[
                  job.address1,
                  job.city,
                  job.state,
                  job.zip,
                ].filter(Boolean).join(", ")}
              </p>
              <CrewSmsPanel jobId={job.id} spanish={spanish} />\n            </article>
          ))}
        </div>
      </div>
    </main>
  )
}
