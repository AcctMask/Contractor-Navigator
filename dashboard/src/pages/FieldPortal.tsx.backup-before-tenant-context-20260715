import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { clearToken, getMe, getToken, type AuthUser } from "../lib/auth"

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://contractor-navigator.onrender.com"

const TENANT = "g2g-roofing"

export default function FieldPortalPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const currentUser = await getMe()

        if (!active) return
        setUser(currentUser)

        const token = getToken()
        const res = await fetch(
          `${API_BASE}/admin/${TENANT}/jobs-all`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        )

        const data = await res.json()

        if (!res.ok || !data.ok) {
          throw new Error(data?.error || "Failed to load assigned jobs")
        }

        if (active) {
          setJobs(Array.isArray(data.jobs) ? data.jobs : [])
        }
      } catch (err: any) {
        if (active) {
          setError(err?.message || "Failed to load assigned jobs")
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [])

  function handleLogout() {
    clearToken()
    navigate("/login")
  }

  function openJob(jobId: number | string) {
    navigate(`/job/${jobId}`)
  }

  return (
    <div style={page}>
      <div style={content}>
        <div style={headerCard}>
          <div style={{ fontSize: "14px", opacity: 0.78 }}>
            Good2Go Roofing
          </div>

          <h1 style={{ margin: "8px 0 0", fontSize: "36px" }}>
            My Assigned Jobs
          </h1>

          <p style={{ marginBottom: 0, opacity: 0.86 }}>
            Welcome{user?.full_name ? `, ${user.full_name}` : ""}.
          </p>
        </div>

        <div style={jobsCard}>
          {loading ? (
            <p style={{ margin: 0 }}>Loading assigned jobs...</p>
          ) : error ? (
            <>
              <h2 style={{ marginTop: 0 }}>Unable to load assigned jobs</h2>
              <p style={{ marginBottom: 0, lineHeight: 1.55 }}>
                {error}
              </p>
            </>
          ) : jobs.length === 0 ? (
            <>
              <h2 style={{ marginTop: 0 }}>No assigned jobs yet</h2>
              <p style={{ marginBottom: 0, lineHeight: 1.55, opacity: 0.84 }}>
                When the office assigns a job to you, it will appear here.
              </p>
            </>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>
                Assigned Jobs ({jobs.length})
              </h2>

              <div style={{ display: "grid", gap: "12px" }}>
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => openJob(job.id)}
                    style={jobButton}
                  >
                    <div style={{ fontWeight: 800 }}>
                      Job #{job.id} — {job.customer_name || "Customer"}
                    </div>

                    <div style={{ marginTop: 6, opacity: 0.88 }}>
                      {[job.address1, job.city, job.state, job.zip]
                        .filter(Boolean)
                        .join(", ") || "Address not yet available"}
                    </div>

                    <div style={{ marginTop: 6, opacity: 0.72 }}>
                      Stage: {job.stage || "—"}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button onClick={handleLogout} style={logoutButton}>
          Logout
        </button>
      </div>
    </div>
  )
}

const page: React.CSSProperties = {
  minHeight: "100vh",
  background:
    "linear-gradient(135deg, rgba(0,25,70,1) 0%, rgba(2,18,47,1) 45%, rgba(8,42,102,1) 100%)",
  color: "#e8eefc",
  padding: "20px",
}

const content: React.CSSProperties = {
  maxWidth: "760px",
  margin: "0 auto",
  display: "grid",
  gap: "18px",
}

const headerCard: React.CSSProperties = {
  background: "rgba(8, 22, 59, 0.94)",
  border: "1px solid rgba(81, 133, 255, 0.28)",
  borderRadius: "22px",
  padding: "22px",
}

const jobsCard: React.CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(81, 133, 255, 0.24)",
  borderRadius: "22px",
  padding: "22px",
}

const jobButton: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  color: "#e8eefc",
  background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.13)",
  borderRadius: "14px",
  padding: "16px",
  cursor: "pointer",
}

const logoutButton: React.CSSProperties = {
  justifySelf: "start",
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.14)",
  padding: "11px 17px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: 700,
}
