import { Link } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"

const API_BASE = import.meta.env.VITE_API_BASE 
const TENANT_SLUG = "g2g-roofing"

type DashboardJob = {
  id: number
  external_job_id?: string | null
  stage?: string | null
  crm_flow_key?: string | null
  crm_substatus?: string | null
  bot_paused?: boolean | null
  manual_owner?: string | null
  address1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  carrier?: string | null
  claim_number?: string | null
  wa_status?: string | null
  estimate_status?: string | null
  contract_status?: string | null
  lead_source?: string | null
  lead_source_detail?: string | null
  marketing_campaign?: string | null
  created_at?: string | null
  updated_at?: string | null
  customer_name?: string | null
}

export default function DashboardPage() {
  const [jobs, setJobs] = useState<DashboardJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    void loadDashboard()
  }, [])

  async function loadDashboard() {
    try {
      setLoading(true)
      setError("")

      const res = await fetch(`${API_BASE}/admin/jobs/${TENANT_SLUG}?limit=250`)
      const data = await res.json()

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Dashboard load failed")
      }

      setJobs(Array.isArray(data.jobs) ? data.jobs : [])
    } catch (err: any) {
      setError(err?.message || "Dashboard load failed")
    } finally {
      setLoading(false)
    }
  }

  const sortedJobs = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime()
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime()
      return bTime - aTime
    })
  }, [jobs])

  const activeJobsCount = sortedJobs.length
  const botPausedCount = sortedJobs.filter((j) => Boolean(j.bot_paused)).length
  const claimJobsCount = sortedJobs.filter(
    (j) => Boolean(j.claim_number) || Boolean(j.carrier)
  ).length
  const googleLeadsCount = sortedJobs.filter((j) => {
    const source = String(j.lead_source || "").toLowerCase()
    const detail = String(j.lead_source_detail || "").toLowerCase()
    return source.includes("google") || detail.includes("google")
  }).length

  const newestJobs = sortedJobs.slice(0, 10)

  return (
    <div style={pageWrap}>
      <div style={layout}>
        <aside style={sidebar}>
          <div style={brandRow}>
            <div style={brandBadge}>CP</div>
            <div>
              <div style={brandTitle}>Co-Pilot</div>
              <div style={brandSub}>Contractor operating platform</div>
            </div>
          </div>

          <div style={companyCard}>
            <div style={companyLabel}>Live company</div>
            <div style={companyName}>Good2Go Roofing</div>
            <div style={companySub}>White-label ready tenant</div>
          </div>

          <div style={navSectionLabel}>WORKSPACE</div>

          <div style={navList}>
            <Link to="/" style={{ ...sideNavItem, ...sideNavItemActive }}>
              Dashboard
            </Link>
            <Link to="/job-admin" style={sideNavItem}>
              Jobs
            </Link>
            <Link to="/job-admin" style={sideNavItem}>
              Customer Search
            </Link>
            <Link to="/document-pipeline" style={sideNavItem}>
              Documents
            </Link>
            <Link to="/users" style={sideNavItem}>
              Users
            </Link>
            <div style={sideNavItemMuted}>Message Center</div>
            <div style={sideNavItemMuted}>Claims</div>
            <div style={sideNavItemMuted}>Production</div>
            <div style={sideNavItemMuted}>Reports</div>
            <div style={sideNavItemMuted}>Settings</div>
          </div>
        </aside>

        <main style={main}>
          <section style={heroCard}>
            <div style={heroEyebrow}>Welcome to Co-Pilot</div>
            <h1 style={heroTitle}>
              Customer contact, AI follow-up, and information-tracking operations platform.
            </h1>
            <p style={heroText}>
              Built for contractor teams that need customer visibility, workflow control,
              claims handling, and sales follow-up in one operating system.
            </p>

            <div style={heroActions}>
              <Link to="/job-admin" style={primaryAction}>
                Customer Search
              </Link>

              <Link to="/job-admin" style={secondaryActionLink}>
                Message Center
              </Link>

              <Link to="/job-admin" style={secondaryActionLink}>
                Send Estimate
              </Link>

              <Link to="/job-admin" style={primaryActionAlt}>
                Add Manual Note
              </Link>
            </div>
          </section>

          <section style={statsGrid}>
            <Link to="/job-admin" style={statCardLink}>
              <div style={statCard}>
                <div style={statNumber}>{loading ? "…" : activeJobsCount}</div>
                <div style={statLabel}>Active Jobs</div>
                <div style={statSub}>Tracked in CRM</div>
              </div>
            </Link>

            <Link to="/job-admin" style={statCardLink}>
              <div style={statCard}>
                <div style={statNumber}>{loading ? "…" : botPausedCount}</div>
                <div style={statLabel}>Bot Paused</div>
                <div style={statSub}>Human takeover</div>
              </div>
            </Link>

            <Link to="/job-admin" style={statCardLink}>
              <div style={statCard}>
                <div style={statNumber}>{loading ? "…" : claimJobsCount}</div>
                <div style={statLabel}>Claim Jobs</div>
                <div style={statSub}>Insurance-related</div>
              </div>
            </Link>

            <Link to="/job-admin" style={statCardLink}>
              <div style={statCard}>
                <div style={statNumber}>{loading ? "…" : googleLeadsCount}</div>
                <div style={statLabel}>Google Leads</div>
                <div style={statSub}>Current top source</div>
              </div>
            </Link>
          </section>

          <section style={panelGrid}>
            <div style={panelCardLarge}>
              <div style={panelHeaderRow}>
                <div>
                  <h2 style={panelTitle}>Job Command Center</h2>
                  <div style={panelSub}>
                    Search and open jobs, then review the record from the job detail view.
                  </div>
                </div>

                <Link to="/job-admin" style={panelSearchButton}>
                  Open Search
                </Link>
              </div>

              {error ? (
                <div style={errorBox}>{error}</div>
              ) : (
                <div style={tableShell}>
                  <div style={tableHeader}>
                    <div>CUSTOMER</div>
                    <div>STAGE</div>
                    <div>ZIP</div>
                    <div>CARRIER</div>
                    <div>CLAIM</div>
                    <div>SOURCE</div>
                    <div>BOT</div>
                  </div>

                  {loading ? (
                    <div style={tableEmpty}>Loading jobs...</div>
                  ) : newestJobs.length === 0 ? (
                    <div style={tableEmpty}>No jobs loaded here yet.</div>
                  ) : (
                    newestJobs.map((job) => (
                      <Link key={job.id} to={`/job/${job.id}`} style={tableRowLink}>
                        <div style={tableRow}>
                          <div>{job.customer_name || "Unknown"}</div>
                          <div>{job.stage || "-"}</div>
                          <div>{job.zip || "-"}</div>
                          <div>{job.carrier || "-"}</div>
                          <div>{job.claim_number || "-"}</div>
                          <div>{job.lead_source || job.lead_source_detail || "-"}</div>
                          <div>{job.bot_paused ? "Paused" : "On"}</div>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              )}

              <div style={{ marginTop: 18 }}>
                <Link to="/job-admin" style={primaryAction}>
                  Go to Command Center
                </Link>
              </div>
            </div>

            <div style={panelCardSide}>
              <h2 style={panelTitle}>Selected Job</h2>
              <div style={panelSub}>Live data from your backend opens from Job Admin.</div>

              <div style={selectedEmpty}>
                Select a job from Command Center to view notes, contacts, claim data, history, and stage controls.
              </div>

              <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
                <Link to="/job-admin" style={primaryAction}>
                  Open Jobs
                </Link>
                <Link to="/users" style={secondaryActionLink}>
                  Manage Users
                </Link>
                <Link to="/document-pipeline" style={secondaryActionLink}>
                  Open Documents
                </Link>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

const pageWrap: React.CSSProperties = {
  maxWidth: "1200px",
  margin: "0 auto",
}

const layout: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "230px 1fr",
  gap: "22px",
  alignItems: "start",
}

const sidebar: React.CSSProperties = {
  background: "rgba(8, 22, 59, 0.7)",
  border: "1px solid rgba(81, 133, 255, 0.18)",
  borderRadius: "22px",
  padding: "18px",
  position: "sticky",
  top: "16px",
}

const brandRow: React.CSSProperties = {
  display: "flex",
  gap: "12px",
  alignItems: "center",
  marginBottom: "18px",
}

const brandBadge: React.CSSProperties = {
  width: "42px",
  height: "42px",
  borderRadius: "14px",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 800,
  color: "#fff",
}

const brandTitle: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
}

const brandSub: React.CSSProperties = {
  fontSize: "12px",
  opacity: 0.75,
}

const companyCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  padding: "14px",
  marginBottom: "18px",
}

const companyLabel: React.CSSProperties = {
  fontSize: "12px",
  opacity: 0.7,
  marginBottom: "6px",
}

const companyName: React.CSSProperties = {
  fontSize: "28px",
  fontWeight: 800,
  lineHeight: 1.05,
}

const companySub: React.CSSProperties = {
  fontSize: "12px",
  opacity: 0.72,
  marginTop: "6px",
}

const navSectionLabel: React.CSSProperties = {
  fontSize: "12px",
  opacity: 0.65,
  letterSpacing: "0.08em",
  marginBottom: "10px",
}

const navList: React.CSSProperties = {
  display: "grid",
  gap: "8px",
}

const sideNavItem: React.CSSProperties = {
  textDecoration: "none",
  color: "#e8eefc",
  padding: "12px 14px",
  borderRadius: "14px",
  display: "block",
  background: "transparent",
}

const sideNavItemActive: React.CSSProperties = {
  background: "rgba(74,168,255,0.16)",
  border: "1px solid rgba(74,168,255,0.24)",
}

const sideNavItemMuted: React.CSSProperties = {
  color: "#e8eefc",
  padding: "12px 14px",
  borderRadius: "14px",
  opacity: 0.75,
}

const main: React.CSSProperties = {
  display: "grid",
  gap: "22px",
}

const heroCard: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(13,33,85,0.98) 0%, rgba(17,44,108,0.92) 100%)",
  border: "1px solid rgba(81, 133, 255, 0.25)",
  borderRadius: "26px",
  padding: "24px",
  boxShadow: "0 18px 50px rgba(0,0,0,0.22)",
}

const heroEyebrow: React.CSSProperties = {
  display: "inline-block",
  fontSize: "12px",
  padding: "8px 12px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.08)",
  marginBottom: "12px",
}

const heroTitle: React.CSSProperties = {
  margin: 0,
  fontSize: "36px",
  lineHeight: 1.08,
  maxWidth: "900px",
}

const heroText: React.CSSProperties = {
  fontSize: "18px",
  opacity: 0.86,
  maxWidth: "860px",
  marginTop: "14px",
}

const heroActions: React.CSSProperties = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
  marginTop: "22px",
}

const primaryAction: React.CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  padding: "12px 18px",
  borderRadius: "14px",
  fontWeight: 700,
  display: "inline-block",
}

const primaryActionAlt: React.CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "linear-gradient(90deg, #2c6af5 0%, #5aaeff 100%)",
  padding: "12px 18px",
  borderRadius: "14px",
  fontWeight: 700,
  display: "inline-block",
}

const secondaryActionLink: React.CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "12px 18px",
  borderRadius: "14px",
  fontWeight: 700,
  display: "inline-block",
}

const statsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: "18px",
}

const statCardLink: React.CSSProperties = {
  textDecoration: "none",
  color: "#e8eefc",
}

const statCard: React.CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(81, 133, 255, 0.18)",
  borderRadius: "22px",
  padding: "22px",
}

const statNumber: React.CSSProperties = {
  fontSize: "44px",
  fontWeight: 800,
  lineHeight: 1,
  marginBottom: "10px",
}

const statLabel: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: 700,
}

const statSub: React.CSSProperties = {
  fontSize: "13px",
  opacity: 0.72,
  marginTop: "6px",
}

const panelGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.2fr 0.9fr",
  gap: "18px",
}

const panelCardLarge: React.CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(81, 133, 255, 0.18)",
  borderRadius: "24px",
  padding: "22px",
}

const panelCardSide: React.CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(81, 133, 255, 0.18)",
  borderRadius: "24px",
  padding: "22px",
}

const panelHeaderRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "center",
  flexWrap: "wrap",
}

const panelTitle: React.CSSProperties = {
  margin: 0,
  fontSize: "22px",
}

const panelSub: React.CSSProperties = {
  fontSize: "14px",
  opacity: 0.75,
  marginTop: "6px",
}

const panelSearchButton: React.CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "12px 16px",
  borderRadius: "14px",
  fontWeight: 700,
  display: "inline-block",
}

const tableShell: React.CSSProperties = {
  marginTop: "18px",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  overflow: "hidden",
  background: "rgba(255,255,255,0.03)",
}

const tableHeader: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.6fr 1fr 0.8fr 1fr 1fr 1fr 0.7fr",
  gap: "10px",
  padding: "14px 16px",
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.04em",
  opacity: 0.7,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
}

const tableRowLink: React.CSSProperties = {
  textDecoration: "none",
  color: "#e8eefc",
}

const tableRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.6fr 1fr 0.8fr 1fr 1fr 1fr 0.7fr",
  gap: "10px",
  padding: "14px 16px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  alignItems: "center",
}

const tableEmpty: React.CSSProperties = {
  padding: "28px 16px",
  textAlign: "center",
  opacity: 0.72,
}

const selectedEmpty: React.CSSProperties = {
  marginTop: "18px",
  lineHeight: 1.55,
  opacity: 0.82,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "16px",
  padding: "16px",
}

const errorBox: React.CSSProperties = {
  marginTop: "18px",
  background: "rgba(255, 90, 90, 0.12)",
  border: "1px solid rgba(255, 90, 90, 0.3)",
  borderRadius: "14px",
  padding: "14px 16px",
  color: "#ffd7d7",
}
