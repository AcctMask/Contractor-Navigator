import { useEffect, useMemo, useState } from "react"

type Job = {
  id: string
  customer_name?: string
  stage?: string
  zip?: string
  carrier?: string
  claim_number?: string
  lead_source?: string
  lead_source_detail?: string
  marketing_campaign?: string
  crm_flow_key?: string
  crm_substatus?: string
  manual_owner?: string
  bot_paused?: boolean
  updated_at?: string
}

type JobDetail = {
  ok: boolean
  tenant_id: number
  job: any
  contacts: any[]
  insurance: any
  damage_reports: any[]
  documents: any[]
  crew_assignments: any[]
  timeline: any[]
}

const API = "https://contractor-autopilot-backend.onrender.com"const TENANT = "g2g-roofing"

const NAV_ITEMS = [
  "Dashboard",
  "Customers",
  "Jobs",
  "Message Center",
  "Claims",
  "Production",
  "Reports",
  "Settings",
]

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string>("")
  const [selectedJob, setSelectedJob] = useState<JobDetail | null>(null)
  const [activeTab, setActiveTab] = useState("Dashboard")
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [loadingJob, setLoadingJob] = useState(false)
  const [search, setSearch] = useState("")

  useEffect(() => {
    loadJobs()
  }, [])

  useEffect(() => {
    if (!selectedJobId) return
    loadJob(selectedJobId)
  }, [selectedJobId])

  async function loadJobs() {
    setLoadingJobs(true)
    try {
      const res = await fetch(`${API}/admin/jobs/${TENANT}`)
      const data = await res.json()
      const rows = data.jobs || []
      setJobs(rows)
      if (rows.length && !selectedJobId) {
        setSelectedJobId(String(rows[0].id))
      }
    } catch (error) {
      console.error("Failed to load jobs", error)
    } finally {
      setLoadingJobs(false)
    }
  }

  async function loadJob(jobId: string) {
    setLoadingJob(true)
    try {
      const res = await fetch(`${API}/admin/job/${TENANT}/${jobId}`)
      const data = await res.json()
      setSelectedJob(data)
    } catch (error) {
      console.error("Failed to load job", error)
    } finally {
      setLoadingJob(false)
    }
  }

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return jobs

    return jobs.filter((job) =>
      [
        job.customer_name,
        job.stage,
        job.zip,
        job.carrier,
        job.claim_number,
        job.lead_source,
        job.manual_owner,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
  }, [jobs, search])

  const stats = useMemo(() => {
    const active = jobs.length
    const paused = jobs.filter((j) => j.bot_paused).length
    const claims = jobs.filter((j) => j.claim_number).length
    const google = jobs.filter((j) => (j.lead_source || "").toLowerCase() === "google").length
    return { active, paused, claims, google }
  }, [jobs])

  const selected = selectedJob?.job

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-wrap">
          <div className="brand-icon">CP</div>
          <div>
            <div className="brand-title">Co-Pilot</div>
            <div className="brand-sub">Contractor operating platform</div>
          </div>
        </div>

        <div className="company-card">
          <div className="company-label">Live company</div>
          <div className="company-name">Good2Go Roofing</div>
          <div className="company-meta">White-label ready tenant</div>
        </div>

        <div className="nav-group-title">Workspace</div>
        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item}
              className={`nav-item ${activeTab === item ? "active" : ""}`}
              onClick={() => setActiveTab(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="footer-card">
            <div className="footer-title">Platform Positioning</div>
            <div className="footer-text">
              Customer contact, AI follow-up, and information-tracking operations platform.
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <section className="hero">
          <div className="eyebrow">Welcome to Co-Pilot</div>
          <h1 className="hero-title">
            Customer contact, AI follow-up, and information-tracking operations platform.
          </h1>
          <p className="hero-text">
            Built for contractor teams that need customer visibility, workflow control, claims handling,
            and sales follow-up in one attractive operating system.
          </p>

          <div className="hero-actions">
            <button className="btn btn-secondary">Customer Search</button>
            <button className="btn btn-secondary">Message Center</button>
            <button className="btn btn-secondary">Send Estimate</button>
            <button className="btn btn-primary">Add Manual Note</button>
          </div>
        </section>

        <section className="kpi-grid">
          <KpiCard label="Active Jobs" value={String(stats.active)} sub="Tracked in CRM" />
          <KpiCard label="Bot Paused" value={String(stats.paused)} sub="Human takeover" />
          <KpiCard label="Claim Jobs" value={String(stats.claims)} sub="Insurance-related" />
          <KpiCard label="Google Leads" value={String(stats.google)} sub="Current top source" />
        </section>

        {activeTab === "Dashboard" && (
          <section className="dashboard-grid">
            <div className="panel panel-large">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Job Command Center</div>
                  <div className="panel-sub">
                    Search and open jobs, then review the full live record on the right.
                  </div>
                </div>

                <input
                  className="search-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search customer, claim, zip, source..."
                />
              </div>

              <div className="table-shell">
                <table className="jobs-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Stage</th>
                      <th>ZIP</th>
                      <th>Carrier</th>
                      <th>Claim</th>
                      <th>Source</th>
                      <th>Bot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingJobs ? (
                      <tr>
                        <td colSpan={7} className="empty-cell">Loading jobs...</td>
                      </tr>
                    ) : filteredJobs.length ? (
                      filteredJobs.map((job) => (
                        <tr
                          key={job.id}
                          className={selectedJobId === String(job.id) ? "row-active" : ""}
                          onClick={() => setSelectedJobId(String(job.id))}
                        >
                          <td className="strong">{job.customer_name || "—"}</td>
                          <td>{job.stage || "—"}</td>
                          <td>{job.zip || "—"}</td>
                          <td>{job.carrier || "—"}</td>
                          <td>{job.claim_number || "—"}</td>
                          <td>{job.lead_source || "—"}</td>
                          <td>
                            <span className={job.bot_paused ? "badge badge-warn" : "badge badge-ok"}>
                              {job.bot_paused ? "Paused" : "Active"}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="empty-cell">No jobs found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="right-col">
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Selected Job</div>
                    <div className="panel-sub">Live data from your backend</div>
                  </div>
                  {selected && <div className="job-chip">Job #{selected.id}</div>}
                </div>

                {loadingJob ? (
                  <div className="empty-state">Loading selected job...</div>
                ) : selected ? (
                  <div className="detail-stack">
                    <DetailCard
                      title="Customer"
                      rows={[
                        ["Name", selected.customer_name || "—"],
                        ["ZIP", selected.zip || "—"],
                        ["Owner", selected.manual_owner || "—"],
                        ["Flow", selected.crm_flow_key || "—"],
                        ["Substatus", selected.crm_substatus || "—"],
                      ]}
                    />
                    <DetailCard
                      title="Insurance"
                      rows={[
                        ["Carrier", selected.carrier || "—"],
                        ["Claim", selected.claim_number || "—"],
                        ["WA Status", selected.wa_status || "—"],
                        ["Damage", selected.damage_summary || "—"],
                        ["Location", selected.damage_location || "—"],
                      ]}
                    />
                    <DetailCard
                      title="Marketing"
                      rows={[
                        ["Source", selected.lead_source || "—"],
                        ["Detail", selected.lead_source_detail || "—"],
                        ["Campaign", selected.marketing_campaign || "—"],
                        ["Bot Paused", selected.bot_paused ? "Yes" : "No"],
                      ]}
                    />
                  </div>
                ) : (
                  <div className="empty-state">Select a job from the table.</div>
                )}
              </div>

              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Recent Timeline</div>
                    <div className="panel-sub">Human and automation actions in one audit trail</div>
                  </div>
                </div>

                <div className="timeline-wrap">
                  {selectedJob?.timeline?.length ? (
                    selectedJob.timeline.slice(0, 8).map((item: any) => (
                      <div key={item.id} className="timeline-item">
                        <div className="timeline-top">
                          <div className="timeline-kind">{item.kind}</div>
                          <div className="timeline-time">
                            {new Date(item.created_at).toLocaleString()}
                          </div>
                        </div>
                        <div className="timeline-msg">{item.message}</div>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">No timeline events yet.</div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab !== "Dashboard" && (
          <section className="panel placeholder-panel">
            <div className="placeholder-title">{activeTab}</div>
            <div className="placeholder-text">
              This section is now wired into the navigation shell. Next we can make this view fully functional.
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  )
}

function DetailCard({
  title,
  rows,
}: {
  title: string
  rows: [string, string][]
}) {
  return (
    <div className="detail-card">
      <div className="detail-title">{title}</div>
      <div className="detail-rows">
        {rows.map(([label, value]) => (
          <div key={label} className="detail-row">
            <div className="detail-label">{label}</div>
            <div className="detail-value">{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
