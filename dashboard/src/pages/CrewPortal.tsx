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
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}
