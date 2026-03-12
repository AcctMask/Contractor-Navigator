import { useEffect, useMemo, useState } from "react"
import {
  Routes,
  Route,
  useNavigate,
  useSearchParams,
  useParams,
  Link,
} from "react-router-dom"

const API = "http://localhost:8787"
const TENANT = "g2g-roofing"

type Job = {
  id: number
  customer_name: string | null
  stage: string | null
  zip: string | null
  carrier: string | null
  claim_number: string | null
  lead_source: string | null
  lead_source_detail?: string | null
  marketing_campaign?: string | null
  bot_paused?: boolean
  manual_owner?: string | null
  job_type?: string | null
  contract_status?: string | null
  estimate_status?: string | null
}

type JobDetailResponse = {
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

const stageButtons = [
  { label: "Lead", params: { stage: "lead" } },
  { label: "Estimate Sent", params: { stage: "estimate_sent" } },
  { label: "Contract Sent", params: { stage: "contract_sent" } },
  { label: "Accepted", params: { stage: "accepted" } },
  { label: "Declined", params: { stage: "declined" } },
]

const sourceButtons = [
  { label: "Google", params: { source: "Google" } },
  { label: "Website", params: { source: "Website Estimate" } },
  { label: "Claims", params: { claims: "true" } },
  { label: "Referral", params: { source: "Referral" } },
]

const jobTypeButtons = [
  { label: "Tarp", params: { job_type: "TARP" } },
  { label: "Tarp R&R", params: { job_type: "TARP_R_AND_R" } },
  { label: "Roof Repair", params: { job_type: "ROOF_REPAIR" } },
  { label: "Roof Replacement", params: { job_type: "ROOF_REPLACEMENT" } },
  { label: "Inspection", params: { job_type: "INSPECTION" } },
]

const productionButtons = [
  { label: "Pre-Construction", params: { production_status: "pre_construction" } },
  { label: "Scheduled", params: { production_status: "scheduled" } },
  { label: "In Production", params: { production_status: "in_production" } },
  { label: "Job Complete", params: { production_status: "job_complete" } },
  { label: "Passed Final", params: { production_status: "passed_final" } },
  { label: "Invoiced", params: { production_status: "invoiced" } },
  { label: "Paid in Full", params: { production_status: "paid_in_full" } },
]

function cardStyle(clickable = false): React.CSSProperties {
  return {
    background: "linear-gradient(180deg, rgba(14,32,66,0.95), rgba(7,22,48,0.95))",
    border: "1px solid rgba(110,150,255,0.12)",
    borderRadius: 28,
    padding: 22,
    boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
    cursor: clickable ? "pointer" : "default",
  }
}

function pillStyle(active = false): React.CSSProperties {
  return {
    padding: "12px 16px",
    borderRadius: 14,
    border: active
      ? "1px solid rgba(78,146,255,0.9)"
      : "1px solid rgba(255,255,255,0.08)",
    background: active
      ? "linear-gradient(135deg, #2d6cff, #44b7ff)"
      : "rgba(255,255,255,0.04)",
    color: "#eef4ff",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  }
}

function sectionTitleStyle(): React.CSSProperties {
  return {
    fontSize: 14,
    fontWeight: 800,
    letterSpacing: "0.08em",
    color: "#97a8c9",
    textTransform: "uppercase",
    marginBottom: 14,
  }
}

function fetchJobs(): Promise<Job[]> {
  return fetch(`${API}/admin/jobs/${TENANT}`)
    .then((r) => r.json())
    .then((data) => data.jobs || [])
}

function filterJobs(jobs: Job[], searchParams: URLSearchParams) {
  const stage = searchParams.get("stage")
  const source = searchParams.get("source")
  const claims = searchParams.get("claims")
  const botPaused = searchParams.get("bot_paused")
  const active = searchParams.get("active")
  const jobType = searchParams.get("job_type")
  const productionStatus = searchParams.get("production_status")

  return jobs.filter((job) => {
    if (stage && job.stage !== stage) return false
    if (source && job.lead_source !== source) return false
    if (claims === "true" && !job.carrier) return false
    if (botPaused === "true" && !job.bot_paused) return false
    if (active === "true" && job.stage === "declined") return false
    if (jobType && job.job_type !== jobType) return false

    if (productionStatus) {
      return false
    }

    return true
  })
}

function DashboardPage() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [selectedJobData, setSelectedJobData] = useState<JobDetailResponse | null>(null)

  useEffect(() => {
    fetchJobs().then((list) => {
      setJobs(list)
      if (list.length) {
        setSelectedJobId(Number(list[0].id))
      }
    })
  }, [])

  useEffect(() => {
    if (!selectedJobId) return
    fetch(`${API}/admin/job/${TENANT}/${selectedJobId}`)
      .then((r) => r.json())
      .then((data) => setSelectedJobData(data))
  }, [selectedJobId])

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.stage !== "declined"),
    [jobs]
  )

  const estimateSentCount = useMemo(
    () => jobs.filter((j) => j.stage === "estimate_sent").length,
    [jobs]
  )

  const contractSentCount = useMemo(
    () => jobs.filter((j) => j.stage === "contract_sent").length,
    [jobs]
  )

  const claimJobsCount = useMemo(
    () => jobs.filter((j) => !!j.carrier).length,
    [jobs]
  )

  const pausedCount = useMemo(
    () => jobs.filter((j) => !!j.bot_paused).length,
    [jobs]
  )

  const selectedJob = selectedJobData?.job || null
  const timeline = selectedJobData?.timeline || []

  const openFilteredJobs = (params: Record<string, string>) => {
    const search = new URLSearchParams(params).toString()
    navigate(`/jobs?${search}`)
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top right, rgba(37,91,189,0.45), transparent 28%), linear-gradient(180deg, #031126 0%, #04142b 100%)",
        color: "#eef4ff",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "240px 1fr",
          minHeight: "100vh",
        }}
      >
        <aside
          style={{
            padding: 24,
            borderRight: "1px solid rgba(255,255,255,0.06)",
            background:
              "linear-gradient(180deg, rgba(7,20,42,0.96), rgba(6,18,38,0.96))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: "linear-gradient(135deg, #2d6cff, #44b7ff)",
                display: "grid",
                placeItems: "center",
                fontWeight: 900,
                fontSize: 22,
              }}
            >
              CP
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>Co-Pilot</div>
              <div style={{ color: "#97a8c9", fontSize: 13 }}>
                Contractor operating platform
              </div>
            </div>
          </div>

          <div style={{ ...cardStyle(false), marginBottom: 24, padding: 18 }}>
            <div style={{ color: "#97a8c9", fontSize: 13, marginBottom: 4 }}>
              Live company
            </div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>Good2Go Roofing</div>
            <div style={{ color: "#97a8c9", marginTop: 4 }}>
              White-label ready tenant
            </div>
          </div>

          <div style={{ ...sectionTitleStyle(), marginBottom: 12 }}>Workspace</div>

          <div style={{ display: "grid", gap: 10 }}>
            {NAV_ITEMS.map((item, idx) => (
              <div
                key={item}
                style={{
                  padding: "14px 16px",
                  borderRadius: 16,
                  background: idx === 0 ? "rgba(53,117,233,0.22)" : "transparent",
                  border:
                    idx === 0
                      ? "1px solid rgba(88,144,255,0.35)"
                      : "1px solid transparent",
                  fontWeight: idx === 0 ? 800 : 700,
                  color: idx === 0 ? "#eef4ff" : "#d8e3fb",
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </aside>

        <main style={{ padding: 28 }}>
          <section style={{ ...cardStyle(false), padding: 28 }}>
            <div
              style={{
                display: "inline-block",
                padding: "9px 14px",
                borderRadius: 999,
                background: "rgba(51,100,188,0.24)",
                border: "1px solid rgba(102,154,255,0.25)",
                color: "#d9e7ff",
                fontWeight: 800,
                fontSize: 14,
                marginBottom: 16,
              }}
            >
              Welcome to Co-Pilot
            </div>

            <h1
              style={{
                fontSize: 58,
                lineHeight: 1.02,
                margin: 0,
                maxWidth: 930,
              }}
            >
              Customer contact, AI follow-up, and information-tracking operations platform.
            </h1>

            <p
              style={{
                marginTop: 20,
                fontSize: 18,
                color: "#b5c4df",
                maxWidth: 980,
                lineHeight: 1.55,
              }}
            >
              Built for contractor teams that need customer visibility, workflow control, claims
              handling, and sales follow-up in one attractive operating system.
            </p>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 24 }}>
              <button style={pillStyle(false)}>Customer Search</button>
              <button style={pillStyle(false)}>Message Center</button>
              <button style={pillStyle(false)}>Send Estimate</button>
              <button style={pillStyle(true)}>Add Manual Note</button>
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
              gap: 16,
              marginTop: 22,
            }}
          >
            <div style={cardStyle(true)} onClick={() => openFilteredJobs({ active: "true" })}>
              <div style={{ color: "#9db2d9", marginBottom: 8 }}>Active Jobs</div>
              <div style={{ fontSize: 56, fontWeight: 900 }}>{activeJobs.length}</div>
              <div style={{ color: "#9db2d9" }}>Tracked in CRM</div>
            </div>

            <div
              style={cardStyle(true)}
              onClick={() => openFilteredJobs({ stage: "estimate_sent" })}
            >
              <div style={{ color: "#9db2d9", marginBottom: 8 }}>Estimate Sent</div>
              <div style={{ fontSize: 56, fontWeight: 900 }}>{estimateSentCount}</div>
              <div style={{ color: "#9db2d9" }}>Ready for follow-up</div>
            </div>

            <div
              style={cardStyle(true)}
              onClick={() => openFilteredJobs({ stage: "contract_sent" })}
            >
              <div style={{ color: "#9db2d9", marginBottom: 8 }}>Contract Sent</div>
              <div style={{ fontSize: 56, fontWeight: 900 }}>{contractSentCount}</div>
              <div style={{ color: "#9db2d9" }}>Pending signature</div>
            </div>

            <div style={cardStyle(true)} onClick={() => openFilteredJobs({ claims: "true" })}>
              <div style={{ color: "#9db2d9", marginBottom: 8 }}>Claim Jobs</div>
              <div style={{ fontSize: 56, fontWeight: 900 }}>{claimJobsCount}</div>
              <div style={{ color: "#9db2d9" }}>Insurance-related</div>
            </div>

            <div
              style={cardStyle(true)}
              onClick={() => openFilteredJobs({ bot_paused: "true" })}
            >
              <div style={{ color: "#9db2d9", marginBottom: 8 }}>Bot Paused</div>
              <div style={{ fontSize: 56, fontWeight: 900 }}>{pausedCount}</div>
              <div style={{ color: "#9db2d9" }}>Human takeover</div>
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "1.15fr 0.85fr",
              gap: 20,
              marginTop: 22,
            }}
          >
            <div style={cardStyle(false)}>
              <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 6 }}>
                Job Command Center
              </div>
              <div style={{ color: "#9db2d9", marginBottom: 20 }}>
                Search and open jobs, then review the full live record on the right.
              </div>

              <div style={{ ...sectionTitleStyle(), marginTop: 6 }}>Sales Stage</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
                {stageButtons.map((item) => (
                  <button
                    key={item.label}
                    style={pillStyle(false)}
                    onClick={() => openFilteredJobs(item.params)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div style={sectionTitleStyle()}>Source</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
                {sourceButtons.map((item) => (
                  <button
                    key={item.label}
                    style={pillStyle(false)}
                    onClick={() => openFilteredJobs(item.params)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div style={sectionTitleStyle()}>Job Type</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
                {jobTypeButtons.map((item) => (
                  <button
                    key={item.label}
                    style={pillStyle(false)}
                    onClick={() => openFilteredJobs(item.params)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div style={sectionTitleStyle()}>Production Status</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {productionButtons.map((item) => (
                  <button
                    key={item.label}
                    style={pillStyle(false)}
                    onClick={() => openFilteredJobs(item.params)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={cardStyle(false)}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>Selected Job</div>
                  <div style={{ color: "#9db2d9" }}>Live data from your backend</div>
                </div>
                <div
                  style={{
                    borderRadius: 999,
                    padding: "10px 14px",
                    background: "rgba(255,255,255,0.05)",
                    fontWeight: 800,
                  }}
                >
                  {selectedJob ? `Job #${selectedJob.id}` : "No Job"}
                </div>
              </div>

              {selectedJob ? (
                <>
                  <div
                    style={{
                      background: "rgba(0,0,0,0.14)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 22,
                      padding: 18,
                    }}
                  >
                    <div style={{ fontSize: 15, color: "#9db2d9", marginBottom: 10 }}>
                      Customer
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "120px 1fr",
                        rowGap: 10,
                      }}
                    >
                      <div style={{ color: "#9db2d9" }}>Name</div>
                      <div style={{ fontWeight: 800 }}>{selectedJob.customer_name || "-"}</div>

                      <div style={{ color: "#9db2d9" }}>ZIP</div>
                      <div style={{ fontWeight: 800 }}>{selectedJob.zip || "-"}</div>

                      <div style={{ color: "#9db2d9" }}>Owner</div>
                      <div style={{ fontWeight: 800 }}>{selectedJob.manual_owner || "—"}</div>

                      <div style={{ color: "#9db2d9" }}>Flow</div>
                      <div style={{ fontWeight: 800 }}>{selectedJob.crm_flow_key || "—"}</div>

                      <div style={{ color: "#9db2d9" }}>Substatus</div>
                      <div style={{ fontWeight: 800 }}>{selectedJob.crm_substatus || "—"}</div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 16,
                      background: "rgba(0,0,0,0.14)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 22,
                      padding: 18,
                    }}
                  >
                    <div style={{ fontSize: 15, color: "#9db2d9", marginBottom: 10 }}>
                      Marketing
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "120px 1fr",
                        rowGap: 10,
                      }}
                    >
                      <div style={{ color: "#9db2d9" }}>Source</div>
                      <div style={{ fontWeight: 800 }}>{selectedJob.lead_source || "—"}</div>

                      <div style={{ color: "#9db2d9" }}>Detail</div>
                      <div style={{ fontWeight: 800 }}>
                        {selectedJob.lead_source_detail || "—"}
                      </div>

                      <div style={{ color: "#9db2d9" }}>Campaign</div>
                      <div style={{ fontWeight: 800 }}>
                        {selectedJob.marketing_campaign || "—"}
                      </div>

                      <div style={{ color: "#9db2d9" }}>Bot Paused</div>
                      <div style={{ fontWeight: 800 }}>
                        {selectedJob.bot_paused ? "Yes" : "No"}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 16,
                      background: "rgba(0,0,0,0.14)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 22,
                      padding: 18,
                    }}
                  >
                    <div style={{ fontSize: 15, color: "#9db2d9", marginBottom: 10 }}>
                      Recent Timeline
                    </div>
                    {timeline.length ? (
                      timeline.slice(0, 5).map((item: any) => (
                        <div
                          key={item.id}
                          style={{
                            border: "1px solid rgba(255,255,255,0.05)",
                            borderRadius: 16,
                            padding: 12,
                            marginBottom: 10,
                            background: "rgba(255,255,255,0.02)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              color: "#97a8c9",
                              fontWeight: 900,
                              marginBottom: 6,
                            }}
                          >
                            {String(item.kind || "").toUpperCase()}
                          </div>
                          <div style={{ fontWeight: 800 }}>{item.message}</div>
                          <div style={{ color: "#97a8c9", fontSize: 12, marginTop: 4 }}>
                            {item.created_at}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: "#9db2d9" }}>No timeline yet.</div>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ color: "#9db2d9", marginTop: 30 }}>Select a job from the list.</div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

function JobsPage() {
  const [searchParams] = useSearchParams()
  const [jobs, setJobs] = useState<Job[]>([])

  useEffect(() => {
    fetchJobs().then((allJobs) => {
      setJobs(filterJobs(allJobs, searchParams))
    })
  }, [searchParams])

  const titleParts: string[] = []

  if (searchParams.get("stage")) titleParts.push(`Stage: ${searchParams.get("stage")}`)
  if (searchParams.get("source")) titleParts.push(`Source: ${searchParams.get("source")}`)
  if (searchParams.get("claims") === "true") titleParts.push("Claims")
  if (searchParams.get("bot_paused") === "true") titleParts.push("Bot Paused")
  if (searchParams.get("active") === "true") titleParts.push("Active Jobs")
  if (searchParams.get("job_type")) titleParts.push(`Job Type: ${searchParams.get("job_type")}`)
  if (searchParams.get("production_status")) {
    titleParts.push(`Production: ${searchParams.get("production_status")}`)
  }

  const title = titleParts.length ? titleParts.join(" / ") : "All Jobs"

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top right, rgba(37,91,189,0.45), transparent 28%), linear-gradient(180deg, #031126 0%, #04142b 100%)",
        color: "#eef4ff",
        fontFamily: "Inter, system-ui, sans-serif",
        padding: 28,
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <Link to="/" style={{ color: "#9fc2ff", textDecoration: "none", fontWeight: 700 }}>
          ← Back to Dashboard
        </Link>
      </div>

      <div style={cardStyle(false)}>
        <div style={{ fontSize: 28, fontWeight: 900, marginBottom: 6 }}>{title}</div>
        <div style={{ color: "#9db2d9", marginBottom: 20 }}>
          Click any prospect to open the individual job record.
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#97a8c9", textAlign: "left" }}>
              <th style={{ padding: "10px 8px" }}>Customer</th>
              <th style={{ padding: "10px 8px" }}>Stage</th>
              <th style={{ padding: "10px 8px" }}>ZIP</th>
              <th style={{ padding: "10px 8px" }}>Carrier</th>
              <th style={{ padding: "10px 8px" }}>Claim</th>
              <th style={{ padding: "10px 8px" }}>Source</th>
              <th style={{ padding: "10px 8px" }}>Open</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <td style={{ padding: "14px 8px", fontWeight: 800 }}>
                  {job.customer_name || "—"}
                </td>
                <td style={{ padding: "14px 8px" }}>{job.stage || "—"}</td>
                <td style={{ padding: "14px 8px" }}>{job.zip || "—"}</td>
                <td style={{ padding: "14px 8px" }}>{job.carrier || "—"}</td>
                <td style={{ padding: "14px 8px" }}>{job.claim_number || "—"}</td>
                <td style={{ padding: "14px 8px" }}>{job.lead_source || "—"}</td>
                <td style={{ padding: "14px 8px" }}>
                  <Link
                    to={`/jobs/${job.id}`}
                    style={{
                      color: "#bfe0ff",
                      textDecoration: "none",
                      fontWeight: 800,
                    }}
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!jobs.length && (
          <div style={{ marginTop: 18, color: "#9db2d9" }}>
            No jobs found for this filter yet.
          </div>
        )}
      </div>
    </div>
  )
}

function JobDetailPage() {
  const { id } = useParams()
  const [jobData, setJobData] = useState<JobDetailResponse | null>(null)

  useEffect(() => {
    if (!id) return
    fetch(`${API}/admin/job/${TENANT}/${id}`)
      .then((r) => r.json())
      .then((data) => setJobData(data))
  }, [id])

  const job = jobData?.job
  const timeline = jobData?.timeline || []

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top right, rgba(37,91,189,0.45), transparent 28%), linear-gradient(180deg, #031126 0%, #04142b 100%)",
        color: "#eef4ff",
        fontFamily: "Inter, system-ui, sans-serif",
        padding: 28,
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <Link to="/jobs" style={{ color: "#9fc2ff", textDecoration: "none", fontWeight: 700 }}>
          ← Back to Jobs
        </Link>
      </div>

      {!job ? (
        <div style={cardStyle(false)}>Loading job...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 0.9fr", gap: 20 }}>
          <div style={cardStyle(false)}>
            <div style={{ fontSize: 28, fontWeight: 900, marginBottom: 10 }}>
              {job.customer_name || `Job #${job.id}`}
            </div>
            <div style={{ color: "#9db2d9", marginBottom: 20 }}>
              Individual prospect/job record
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "160px 1fr",
                rowGap: 12,
              }}
            >
              <div style={{ color: "#9db2d9" }}>Stage</div>
              <div style={{ fontWeight: 800 }}>{job.stage || "—"}</div>

              <div style={{ color: "#9db2d9" }}>ZIP</div>
              <div style={{ fontWeight: 800 }}>{job.zip || "—"}</div>

              <div style={{ color: "#9db2d9" }}>Carrier</div>
              <div style={{ fontWeight: 800 }}>{job.carrier || "—"}</div>

              <div style={{ color: "#9db2d9" }}>Claim Number</div>
              <div style={{ fontWeight: 800 }}>{job.claim_number || "—"}</div>

              <div style={{ color: "#9db2d9" }}>Source</div>
              <div style={{ fontWeight: 800 }}>{job.lead_source || "—"}</div>

              <div style={{ color: "#9db2d9" }}>Source Detail</div>
              <div style={{ fontWeight: 800 }}>{job.lead_source_detail || "—"}</div>

              <div style={{ color: "#9db2d9" }}>Campaign</div>
              <div style={{ fontWeight: 800 }}>{job.marketing_campaign || "—"}</div>

              <div style={{ color: "#9db2d9" }}>Bot Paused</div>
              <div style={{ fontWeight: 800 }}>{job.bot_paused ? "Yes" : "No"}</div>

              <div style={{ color: "#9db2d9" }}>Last Human Note</div>
              <div style={{ fontWeight: 800 }}>{job.last_human_note || "—"}</div>
            </div>
          </div>

          <div style={cardStyle(false)}>
            <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>Timeline</div>
            {timeline.length ? (
              timeline.map((item: any) => (
                <div
                  key={item.id}
                  style={{
                    border: "1px solid rgba(255,255,255,0.05)",
                    borderRadius: 16,
                    padding: 12,
                    marginBottom: 10,
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      color: "#97a8c9",
                      fontWeight: 900,
                      marginBottom: 6,
                    }}
                  >
                    {String(item.kind || "").toUpperCase()}
                  </div>
                  <div style={{ fontWeight: 800 }}>{item.message}</div>
                  <div style={{ color: "#97a8c9", fontSize: 12, marginTop: 4 }}>
                    {item.created_at}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: "#9db2d9" }}>No timeline yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/jobs" element={<JobsPage />} />
      <Route path="/jobs/:id" element={<JobDetailPage />} />
    </Routes>
  )
}
