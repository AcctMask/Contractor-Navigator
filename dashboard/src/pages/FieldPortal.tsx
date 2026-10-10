import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { clearToken, getMe, getToken, saveMyPreferredLanguage, type AuthUser } from "../lib/auth"
import {
  getTenantSlug,
  tenantDisplayName,
} from "../lib/tenant"

import {
  normalizeWorkforceLanguage,
  workforceText,
  WORKFORCE_LANGUAGES,
  type WorkforceLanguage,
} from "../lib/workforceLanguage"

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://contractor-navigator.onrender.com"

export default function FieldPortalPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [language, setLanguage] = useState<WorkforceLanguage>("en")
  const [savingLanguage, setSavingLanguage] = useState(false)
  const [languageError, setLanguageError] = useState("")
  const t = (key: Parameters<typeof workforceText>[1]) =>
    workforceText(language, key)

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const currentUser = await getMe()

        if (!active) return
        setUser(currentUser)
        setLanguage(
          normalizeWorkforceLanguage(currentUser?.preferred_language)
        )

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

  async function changeLanguage(next: WorkforceLanguage) {
    if (savingLanguage || next === language) return

    setSavingLanguage(true)
    setLanguageError("")

    try {
      await saveMyPreferredLanguage(next)
      setLanguage(next)
      setUser((current) =>
        current ? { ...current, preferred_language: next } : current
      )
    } catch (err: any) {
      setLanguageError(
        err?.message || "Unable to save language preference"
      )
    } finally {
      setSavingLanguage(false)
    }
  }

  function handleLogout() {
    clearToken()
    navigate("/login")
  }

  function openJob(jobId: number | string) {
    navigate(`/job/${jobId}`)
  }

  const assignedTarps = jobs.filter(
    (job) => job.stage === "tarp"
  )
  const completedTarps = jobs.filter(
    (job) => job.stage === "tarp_complete"
  )
  const otherJobs = jobs.filter(
    (job) => job.stage !== "tarp" && job.stage !== "tarp_complete"
  )

  function renderJobGroup(
    title: string,
    group: any[]
  ) {
    return (
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ marginTop: 0 }}>
          {title} ({group.length})
        </h2>

        <div style={{ display: "grid", gap: "12px" }}>
          {group.map((job) => (
            <button
              key={job.id}
              onClick={() => openJob(job.id)}
              style={jobButton}
            >
              <div style={{ fontWeight: 800 }}>
                Job #{job.id} — {job.customer_name || t("customer")}
              </div>

              <div style={{ marginTop: 6, opacity: 0.88 }}>
                {[job.address1, job.city, job.state, job.zip]
                  .filter(Boolean)
                  .join(", ") || t("addressUnavailable")}
              </div>

              <div style={{ marginTop: 6, opacity: 0.72 }}>
                {t("stage")}: {job.stage || "—"}
              </div>
            </button>
          ))}
        </div>
      </section>
    )
  }

  return (
    <div style={page}>
      <div style={content}>
        <div style={headerCard}>
          <div style={{ fontSize: "14px", opacity: 0.78 }}>
            {tenantDisplayName(getTenantSlug())}
          </div>

          <h1 style={{ margin: "8px 0 0", fontSize: "36px" }}>
            {t("myAssignedJobs")}
          </h1>

          <p style={{ marginBottom: 0, opacity: 0.86 }}>
            {t("welcome")}{user?.full_name ? `, ${user.full_name}` : ""}.
          </p>
          <div style={{ marginTop: "16px" }}>
            <label htmlFor="field-language" style={{ marginRight: 10 }}>
              {t("language")}
            </label>
            <select
              id="field-language"
              value={language}
              disabled={!user || savingLanguage}
              onChange={(e) =>
                void changeLanguage(e.target.value as WorkforceLanguage)
              }
              style={{ padding: "8px", borderRadius: "8px" }}
            >
              {WORKFORCE_LANGUAGES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
            {languageError && (
              <p role="alert" style={{ color: "#ffb4b4" }}>
                {languageError}
              </p>
            )}
          </div>
        </div>

        <div style={jobsCard}>
          {loading ? (
            <p style={{ margin: 0 }}>{t("loadingJobs")}</p>
          ) : error ? (
            <>
              <h2 style={{ marginTop: 0 }}>{t("unableToLoadJobs")}</h2>
              <p style={{ marginBottom: 0, lineHeight: 1.55 }}>
                {error}
              </p>
            </>
          ) : jobs.length === 0 ? (
            <>
              <h2 style={{ marginTop: 0 }}>{t("noAssignedJobs")}</h2>
              <p style={{ marginBottom: 0, lineHeight: 1.55, opacity: 0.84 }}>
                {t("assignmentExplanation")}
              </p>
            </>
          ) : (
            <>
              {renderJobGroup(
                language === "es" ? "Lonas asignadas" : "Tarps Assigned",
                assignedTarps
              )}
              {renderJobGroup(
                language === "es" ? "Lonas completadas" : "Tarps Completed",
                completedTarps
              )}
              {renderJobGroup(
                language === "es" ? "Otros trabajos asignados" : "Other Assigned Jobs",
                otherJobs
              )}
            </>
          )}
        </div>

        <button onClick={handleLogout} style={logoutButton}>
          {t("logout")}
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
