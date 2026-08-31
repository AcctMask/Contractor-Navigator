import { Link } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import {
  getTenantSlug,
  tenantDisplayName,
} from "../lib/tenant"
import { useCompanyDna } from "../context/CompanyDnaContext"
import { stagePresentation } from "../lib/stagePresentation"

const API_BASE = import.meta.env.VITE_API_BASE
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
  has_buying_signal?: boolean | null
}

type RecentActivitySummary = {
  id: string | number
  job_id?: number | null
  kind: string
  message?: string | null
  metadata?: any
  created_at?: string | null
  customer_name?: string | null
  meta?: {
    customer_name?: string
    actor_name?: string
    staff_name?: string
    user_name?: string
    author?: string
    sent_by?: string
    package_type?: string
    document_type?: string
    signer_name?: string
    [key: string]: unknown
  }

}

type CalendarEventSummary = {
  id: number
  title?: string | null
  event_type?: string | null
  start_time?: string | null
  end_time?: string | null
  customer_name?: string | null
  job_id?: number | null
  automation_managed?: boolean
  automation_stage_key?: string | null
}

function fmtDate(value?: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

function fmtLeadDate(value?: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export default function DashboardPage() {
  const {
    branding,
    workflowDefaults,
    workspace,
  } = useCompanyDna()

  const jobTerm =
    workflowDefaults.job_term || "Job"

  const customerTerm =
    workflowDefaults.customer_term ||
    "Customer"

  const inspectionTerm =
    workflowDefaults.inspection_term ||
    "Inspection"

  const [jobs, setJobs] = useState<DashboardJob[]>([])
  const [events, setEvents] = useState<CalendarEventSummary[]>([])
  const [recentActivity, setRecentActivity] = useState<RecentActivitySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedStage, setSelectedStage] = useState<string | null>(null)

  useEffect(() => {
    void loadDashboard()
  }, [])

  async function loadDashboard() {
    try {
      setLoading(true)
      setError("")

      const [jobsRes, eventsRes, recentActivityRes] = await Promise.all([
        fetch(`${API_BASE}/admin/jobs/${getTenantSlug()}?limit=250`),
        fetch(`${API_BASE}/calendar/${getTenantSlug()}/events`),
        fetch(`${API_BASE}/admin/recent-activity/${getTenantSlug()}?limit=10`)
      ])

      const jobsData = await jobsRes.json()
      const eventsData = await eventsRes.json()
      const recentActivityData = await recentActivityRes.json().catch(() => ({ rows: [] }))

      if (!jobsRes.ok || !jobsData?.ok) {
        throw new Error(jobsData?.error || "Dashboard load failed")
      }

      setJobs(Array.isArray(jobsData.jobs) ? jobsData.jobs : [])
      setEvents(Array.isArray(eventsData?.events) ? eventsData.events : [])
      setRecentActivity(Array.isArray(recentActivityData?.rows) ? recentActivityData.rows : [])
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

  const pipelineCards =
    workspace.dashboard
      .pipeline_cards || []

  const buyingSignalJobs =
    sortedJobs.filter(
      (job) =>
        !!job.has_buying_signal,
    )

  function jobsForPipelineCard(
    card: {
      filter_type:
        | "stage"
        | "stage_any"
        | "buying_signal"
      filter_value?: string | null
      filter_values?: string[]
    },
  ) {
    if (
      card.filter_type ===
      "buying_signal"
    ) {
      return buyingSignalJobs
    }

    if (
      card.filter_type ===
      "stage_any"
    ) {
      const stages =
        card.filter_values || []

      return sortedJobs.filter(
        (job) =>
          stages.includes(
            job.stage || "lead",
          ),
      )
    }

    return sortedJobs.filter(
      (job) =>
        (job.stage || "lead") ===
        card.filter_value,
    )
  }

  const pipelineCardCounts =
    pipelineCards.map((card) => ({
      ...card,
      count:
        jobsForPipelineCard(
          card,
        ).length,
    }))

  const intakePendingJobs = sortedJobs.filter((j) => j.stage === "intake_pending")
  const intakeBreakdown = {
    waiting_on_info: intakePendingJobs.filter((j) => j.crm_substatus === "waiting_on_info").length,
    no_response: intakePendingJobs.filter((j) => j.crm_substatus === "no_response").length,
    likely_solicitor: intakePendingJobs.filter((j) => j.crm_substatus === "likely_solicitor").length,
    other: intakePendingJobs.filter((j) => !["waiting_on_info", "no_response", "likely_solicitor"].includes(j.crm_substatus || "")).length,
  }

  const selectedPipelineCard =
    pipelineCards.find(
      (card) =>
        card.id === selectedStage,
    )

  const filteredJobs =
    selectedPipelineCard
      ? jobsForPipelineCard(
          selectedPipelineCard,
        )
      : sortedJobs

  const newestJobs = filteredJobs.slice(0, 10)
  const now = Date.now()

  const upcomingEvents = events
    .filter((event) => {
      const startTime = new Date(event.start_time || "").getTime()
      if (Number.isNaN(startTime)) return false

      const endTime = new Date(event.end_time || "").getTime()
      const effectiveEndTime = Number.isNaN(endTime)
        ? startTime
        : endTime

      return effectiveEndTime >= now
    })
    .sort((a, b) => {
      const aTime = new Date(a.start_time || "").getTime()
      const bTime = new Date(b.start_time || "").getTime()
      return aTime - bTime
    })
    .slice(0, 6)

  const recentActivityItems = recentActivity.slice(0, 10)

  function activityTitle(event: RecentActivitySummary) {
    const customer =
      event.customer_name ||
      event.meta?.customer_name ||
      "customer"

    const actor =
      event.meta?.actor_name ||
      event.meta?.staff_name ||
      event.meta?.user_name ||
      event.meta?.author ||
      event.meta?.sent_by ||
      null

    const packageType =
      String(
        event.meta?.package_type ||
        event.meta?.document_type ||
        ""
      )
        .replaceAll("_", " ")
        .trim()

    switch (event.kind) {
      case "manual_note":
      case "staff_note":
        return actor
          ? `${actor} added a note to ${customer}`
          : `Note added to ${customer}`

      case "document_package_sent":
        return actor
          ? `${actor} sent ${packageType || "a document"} to ${customer}`
          : `${packageType || "Document"} sent to ${customer}`

      case "document_package_signed":
        return `${packageType || "Document"} signed by ${customer}`

      case "buying_signal_detected":
        return `Buying signal received from ${customer}`

      case "customer_frustration_detected":
      case "human_takeover_frustration":
      case "frustrated_customer_alert_routed":
        return `Customer agitation alert received from ${customer}`

      case "estimate_details":
        return `Estimate activity for ${customer}`

      case "lead_created":
        return `New lead created for ${customer}`

      case "calendar_stage_event_created":
        return `Calendar event scheduled for ${customer}`

      case "calendar_stage_event_rescheduled":
      case "calendar_event_rescheduled":
        return `Calendar event changed for ${customer}`

      case "user_invitation_sent": {
        const invitedUser = String(
          event.meta?.full_name ||
          event.meta?.email ||
          "user"
        )
        return `User invitation sent to ${invitedUser}`
      }

      case "user_invitation_accepted": {
        const invitedUser = String(
          event.meta?.full_name ||
          event.meta?.email ||
          "User"
        )
        return `${invitedUser} accepted user invitation`
      }

      default:
        return event.message || event.kind.replaceAll("_", " ")
    }
  }

  return (
    <div style={pageWrap}>
      <div style={layout}>
        <aside style={sidebar}>
          <div style={brandRow}>
            <div style={brandBadge}>
              {(branding.dba_name ||
                branding.business_display_name ||
                "CN")
                .slice(0, 2)
                .toUpperCase()}
            </div>

            <div>
              <div style={brandTitle}>
                {branding.dba_name ||
                  branding.business_display_name}
              </div>

              <div style={brandSub}>
                Tenant operational workspace
              </div>
            </div>
          </div>

          <div style={companyCard}>
            <div style={companyLabel}>Live company</div>
            <div style={companyName}>
              {branding.business_display_name ||
                tenantDisplayName(getTenantSlug())}
            </div>
            <div style={companySub}>White-label ready tenant</div>
          </div>

          <div style={navSectionLabel}>WORKSPACE</div>

          <div style={tenantSummary}>
            <div style={tenantSummaryTitle}>
              AI Workforce
            </div>

            <div style={capabilityWrap}>
              {workspace.supporting_modules
                .map((module) => {
                  if (module.external_url) {
                    return (
                      <a
                        key={module.id}
                        href={module.external_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          ...capabilityPill,
                          textDecoration: "none",
                          display: "inline-block",
                        }}
                        title={
                          module.description ||
                          undefined
                        }
                      >
                        {module.label}
                      </a>
                    )
                  }

                  if (module.route) {
                    return (
                      <Link
                        key={module.id}
                        to={module.route}
                        style={{
                          ...capabilityPill,
                          textDecoration: "none",
                          display: "inline-block",
                        }}
                        title={
                          module.description ||
                          undefined
                        }
                      >
                        {module.label}
                      </Link>
                    )
                  }

                  return (
                    <span
                      key={module.id}
                      style={capabilityPill}
                      title={
                        module.description ||
                        undefined
                      }
                    >
                      {module.label}
                    </span>
                  )
                })}

              {workspace.supporting_modules
                .length === 0 ? (
                <span style={companySub}>
                  No supporting modules have
                  been assigned yet.
                </span>
              ) : null}
            </div>
          </div>
        </aside>

        <main style={main}>
          <section style={heroCard}>
            <div style={heroEyebrow}>
              {workspace.hero.eyebrow}
            </div>

            <h1 style={heroTitle}>
              {workspace.hero.title}
            </h1>

            <p style={heroText}>
              {workspace.hero.description}
            </p>
          </section>

          <section style={statsGrid}>
            {pipelineCardCounts.map(
              ({
                id,
                label,
                count,
                attention,
                filter_type,
                filter_value,
              }) => {
                const stageColors =
                  filter_type === "stage"
                    ? stagePresentation(
                        String(filter_value || ""),
                      )
                    : null

                return (
                  <button
                    key={id}
                    onClick={() =>
                      setSelectedStage(
                        selectedStage === id
                          ? null
                          : id,
                      )
                    }
                    style={{
                      ...statCard,
                      ...(stageColors || {}),
                      ...(attention
                        ? statCardAttention
                        : {}),
                      ...(selectedStage === id
                        ? statCardActive
                        : {}),
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={statNumber}>
                      {loading
                        ? "…"
                        : count}
                    </div>

                    <div style={statLabel}>
                      {label}
                    </div>

                    <div style={statSub}>
                      {selectedStage === id
                        ? "Showing below"
                        : "Click to filter"}
                    </div>
                  </button>
                )
              },
            )}
          </section>

          {intakePendingJobs.length > 0 ? (
            <section style={intakePanel}>
              <div style={panelTitle}>Intake Pending Breakdown</div>
              <div style={panelSub}>Low-confidence calls/texts waiting for clarification or review.</div>
              <div style={intakeBreakdownGrid}>
                <div style={intakeBreakdownItem}>Waiting on info: <b>{intakeBreakdown.waiting_on_info}</b></div>
                <div style={intakeBreakdownItem}>No response: <b>{intakeBreakdown.no_response}</b></div>
                <div style={intakeBreakdownItem}>Likely solicitor: <b>{intakeBreakdown.likely_solicitor}</b></div>
                <div style={intakeBreakdownItem}>Other: <b>{intakeBreakdown.other}</b></div>
              </div>
            </section>
          ) : null}

          <section style={panelGrid}>
            <div style={panelCardLarge}>
              <div style={panelHeaderRow}>
                <div>
                  <h2 style={panelTitle}>
                    {jobTerm} Command Center
                  </h2>
                  <div style={panelSub}>
                    {selectedPipelineCard
                      ? `Showing ${selectedPipelineCard.label.toLowerCase()} ${jobTerm.toLowerCase()} records. Click the same stage again to clear.`
                      : `Search and open ${jobTerm.toLowerCase()} records, then review the record from the detail view.`}
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
                    <div>{customerTerm.toUpperCase()}</div>
                    <div>STAGE</div>
                    <div>ZIP</div>
                    <div>{selectedStage === "lead" ? "RECEIVED" : "CARRIER"}</div>
                    <div>{selectedStage === "lead" ? "LAST ACTIVITY" : "CLAIM"}</div>
                    <div>SOURCE</div>
                    <div>BOT</div>
                  </div>

                  {loading ? (
                    <div style={tableEmpty}>
                      Loading {jobTerm.toLowerCase()} records...
                    </div>
                  ) : newestJobs.length === 0 ? (
                    <div style={tableEmpty}>
                      No {jobTerm.toLowerCase()} records loaded here yet.
                    </div>
                  ) : (
                    newestJobs.map((job) => (
                      <Link key={job.id} to={`/job/${job.id}`} style={tableRowLink}>
                        <div style={tableRow}>
                          <div>{job.customer_name || "Unknown"}</div>
                          <div>{job.stage || "-"}</div>
                          <div>{job.zip || "-"}</div>
                          <div>{selectedStage === "lead" ? fmtLeadDate(job.created_at) : (job.carrier || "-")}</div>
                          <div>{selectedStage === "lead" ? fmtLeadDate(job.updated_at || job.created_at) : (job.claim_number || "-")}</div>
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
              <h2 style={panelTitle}>Upcoming Calendar</h2>
              <div style={panelSub}>Scheduled projects, {inspectionTerm.toLowerCase()} events, and appointments.</div>

              <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
                {loading ? (
                  <div style={selectedEmpty}>Loading calendar…</div>
                ) : upcomingEvents.length === 0 ? (
                  <div style={selectedEmpty}>
                    No calendar events yet. Add one from the Calendar page.
                  </div>
                ) : (
                  upcomingEvents.map((event) => (
                    <div key={event.id} style={selectedEmpty}>
                      <div style={{ fontWeight: 800, marginBottom: 6 }}>
                        {event.title || "Untitled Event"}
                      </div>
                      <div>{fmtDate(event.start_time)}</div>
                      <div>Type: {event.event_type || "appointment"}</div>
                      <div>Customer: {event.customer_name || "—"}</div>
                      {event.job_id ? (
                        <div style={{ marginTop: 8 }}>
                          <Link to={`/job/${event.job_id}`} style={{ color: "#a9cbff", fontWeight: 700 }}>
                            Open linked {jobTerm.toLowerCase()}
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>

              <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
                <Link to="/calendar" style={primaryAction}>
                  Open Calendar
                </Link>
                <Link to="/users" style={primaryAction}>
                  Manage Users
                </Link>
                <Link to="/document-pipeline" style={primaryAction}>
                  Open Documents
                </Link>
              </div>

              <div style={eventPanel}>
                <h2 style={panelTitle}>Recent Activity</h2>
                <div style={panelSub}>
                  Current customer, staff, document, estimate, and sales activity.
                </div>

                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  {loading ? (
                    <div style={selectedEmpty}>Loading recent activity…</div>
                  ) : recentActivityItems.length === 0 ? (
                    <div style={selectedEmpty}>No recent operational activity yet.</div>
                  ) : (
                    recentActivityItems.map((event) => {
                      const activityCard = (
                        <div style={systemEventCard}>
                          <div style={systemEventTopRow}>
                            <span style={systemEventType}>
                              {activityTitle(event)}
                            </span>
                            <span style={systemEventTime}>
                              {fmtDate(event.created_at)}
                            </span>
                          </div>

                          {event.message ? (
                            <div style={systemEventDetail}>
                              {event.message}
                            </div>
                          ) : null}

                          {event.job_id ? (
                            <div style={systemEventMeta}>
                              Job #{event.job_id} — Open Job
                            </div>
                          ) : null}
                        </div>
                      )

                      return event.job_id ? (
                        <Link
                          key={event.id}
                          to={`/job/${event.job_id}`}
                          style={{
                            display: "block",
                            color: "inherit",
                            textDecoration: "none",
                          }}
                        >
                          {activityCard}
                        </Link>
                      ) : (
                        <div key={event.id}>
                          {activityCard}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

const pageWrap: CSSProperties = {
  maxWidth: "1200px",
  margin: "0 auto",
}

const layout: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "230px 1fr",
  gap: "22px",
  alignItems: "start",
}

const sidebar: CSSProperties = {
  background: "rgba(8, 22, 59, 0.7)",
  border: "1px solid rgba(81, 133, 255, 0.18)",
  borderRadius: "22px",
  padding: "18px",
  position: "sticky",
  top: "16px",
}

const brandRow: CSSProperties = {
  display: "flex",
  gap: "12px",
  alignItems: "center",
  marginBottom: "18px",
}

const brandBadge: CSSProperties = {
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

const brandTitle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 800,
}

const brandSub: CSSProperties = {
  fontSize: "12px",
  opacity: 0.75,
}

const companyCard: CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "18px",
  padding: "18px",
  marginTop: "18px",
  marginBottom: "18px",
}

const companyLabel: CSSProperties = {
  fontSize: "12px",
  opacity: 0.7,
  marginBottom: "6px",
}

const companyName: CSSProperties = {
  fontSize: "28px",
  fontWeight: 800,
  lineHeight: 1.05,
}

const companySub: CSSProperties = {
  fontSize: "12px",
  opacity: 0.72,
  marginTop: "6px",
}

const navSectionLabel: CSSProperties = {
  fontSize: "12px",
  opacity: 0.65,
  letterSpacing: "0.08em",
  marginBottom: "10px",
}





const main: CSSProperties = {
  display: "grid",
  gap: "22px",
}

const heroCard: CSSProperties = {
  background: "linear-gradient(135deg, rgba(13,33,85,0.98) 0%, rgba(17,44,108,0.92) 100%)",
  border: "1px solid rgba(81, 133, 255, 0.25)",
  borderRadius: "26px",
  padding: "18px 22px",
  boxShadow: "0 18px 50px rgba(0,0,0,0.22)",
}

const heroEyebrow: CSSProperties = {
  display: "inline-block",
  fontSize: "12px",
  padding: "8px 12px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.08)",
  marginBottom: "12px",
}

const heroTitle: CSSProperties = {
  margin: 0,
  fontSize: "24px",
  lineHeight: 1.08,
  maxWidth: "900px",
}

const heroText: CSSProperties = {
  fontSize: "18px",
  opacity: 0.86,
  maxWidth: "860px",
  marginTop: "10px",
}


const primaryAction: CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  padding: "12px 18px",
  borderRadius: "14px",
  fontWeight: 700,
  display: "inline-block",
}



const statsGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
  gap: "12px",
}


const statCard: CSSProperties = {
  background: "rgba(30, 58, 138, 0.55)",
  border: "1px solid rgba(147, 197, 253, 0.42)",
  borderRadius: "16px",
  padding: "10px 12px",
  color: "#f8fafc",
}

const statCardActive: CSSProperties = {
  border: "1px solid rgba(191, 219, 254, 0.95)",
  background: "rgba(59, 130, 246, 0.78)",
  boxShadow: "0 0 0 1px rgba(147, 197, 253, 0.45), 0 12px 28px rgba(37, 99, 235, 0.28)",
}

const statCardAttention: CSSProperties = {
  background: "rgba(180, 83, 9, 0.62)",
  border: "1px solid rgba(251, 191, 36, 0.62)",
  boxShadow: "0 12px 28px rgba(180, 83, 9, 0.18)",
}

const statNumber: CSSProperties = {
  fontSize: "24px",
  fontWeight: 800,
  lineHeight: 1,
  marginBottom: "6px",
  color: "#111827",
}

const statLabel: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: "#111827",
  textTransform: "capitalize",
}

const statSub: CSSProperties = {
  fontSize: "12px",
  opacity: 0.9,
  color: "#111827",
  marginTop: "6px",
}

const panelGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.2fr 0.9fr",
  gap: "18px",
}

const panelCardLarge: CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(81, 133, 255, 0.18)",
  borderRadius: "24px",
  padding: "22px",
}

const panelCardSide: CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(81, 133, 255, 0.18)",
  borderRadius: "24px",
  padding: "22px",
}

const panelHeaderRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "center",
  flexWrap: "wrap",
}

const panelTitle: CSSProperties = {
  margin: 0,
  fontSize: "22px",
}

const panelSub: CSSProperties = {
  fontSize: "14px",
  opacity: 0.75,
  marginTop: "6px",
}

const panelSearchButton: CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "12px 16px",
  borderRadius: "14px",
  fontWeight: 700,
  display: "inline-block",
}

const tableShell: CSSProperties = {
  marginTop: "18px",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  overflow: "hidden",
  background: "rgba(255,255,255,0.03)",
}

const tableHeader: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.6fr 1fr 0.8fr 1fr 1fr 1fr 0.7fr",
  gap: "10px",
  padding: "10px 12px",
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.04em",
  opacity: 0.7,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
}

const tableRowLink: CSSProperties = {
  textDecoration: "none",
  color: "#e8eefc",
}

const tableRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.6fr 1fr 0.8fr 1fr 1fr 1fr 0.7fr",
  gap: "10px",
  padding: "10px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  alignItems: "center",
}

const tableEmpty: CSSProperties = {
  padding: "28px 16px",
  textAlign: "center",
  opacity: 0.72,
}

const selectedEmpty: CSSProperties = {
  marginTop: "18px",
  lineHeight: 1.55,
  opacity: 0.82,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "16px",
  padding: "16px",
}

const errorBox: CSSProperties = {
  marginTop: "18px",
  background: "rgba(255, 90, 90, 0.12)",
  border: "1px solid rgba(255, 90, 90, 0.3)",
  borderRadius: "14px",
  padding: "10px 12px",
  color: "#ffd7d7",
}


const tenantSummary: CSSProperties = {
  marginTop: "18px",
  padding: "16px",
  borderRadius: "18px",
  background: "rgba(15, 23, 42, 0.72)",
  border: "1px solid rgba(148, 163, 184, 0.18)",
}

const tenantSummaryTitle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  opacity: 0.85,
  marginBottom: "8px",
}

const capabilityWrap: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "7px",
  marginTop: "12px",
}

const capabilityPill: CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  padding: "6px 8px",
  borderRadius: "999px",
  color: "#dbeafe",
  background: "rgba(37, 99, 235, 0.22)",
  border: "1px solid rgba(147, 197, 253, 0.28)",
}


const eventPanel: CSSProperties = {
  marginTop: 22,
  paddingTop: 18,
  borderTop: "1px solid rgba(255,255,255,0.1)",
}

const systemEventCard: CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "14px",
  padding: "12px",
}

const systemEventTopRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "center",
}

const systemEventType: CSSProperties = {
  fontWeight: 800,
  textTransform: "capitalize",
}

const systemEventTime: CSSProperties = {
  fontSize: 11,
  opacity: 0.65,
  whiteSpace: "nowrap",
}

const systemEventMeta: CSSProperties = {
  fontSize: 12,
  opacity: 0.7,
  marginTop: 5,
}

const systemEventDetail: CSSProperties = {
  fontSize: 12,
  opacity: 0.86,
  marginTop: 5,
}


const intakePanel: CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(250, 204, 21, 0.25)",
  borderRadius: "20px",
  padding: "18px",
}

const intakeBreakdownGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "10px",
  marginTop: "12px",
}

const intakeBreakdownItem: CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  padding: "10px 12px",
  fontSize: "13px",
}
