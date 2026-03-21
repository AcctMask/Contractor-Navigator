import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"

const API = "http://localhost:8787"
const TENANT = "g2g-roofing"

type ConversationItem = {
  id: number
  kind: string
  message: string
  meta?: any
  created_at: string
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

type AiConversationResponse = {
  ok: boolean
  tenant_id: number
  job_id: number
  conversation: ConversationItem[]
}

function cardStyle(): React.CSSProperties {
  return {
    background: "linear-gradient(180deg, rgba(14,32,66,0.95), rgba(7,22,48,0.95))",
    border: "1px solid rgba(110,150,255,0.12)",
    borderRadius: 28,
    padding: 22,
    boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
  }
}

function timelineBubbleStyle(kind: string): React.CSSProperties {
  const lower = kind.toLowerCase()

  if (lower === "customer_reply") {
    return {
      background: "rgba(38, 92, 171, 0.22)",
      border: "1px solid rgba(96, 157, 255, 0.22)",
      borderRadius: 18,
      padding: 14,
      marginBottom: 12,
    }
  }

  if (lower.includes("buying_signal")) {
    return {
      background: "rgba(202, 132, 10, 0.18)",
      border: "1px solid rgba(255, 200, 102, 0.24)",
      borderRadius: 18,
      padding: 14,
      marginBottom: 12,
    }
  }

  if (lower.includes("ai_message")) {
    return {
      background: "rgba(30, 122, 84, 0.18)",
      border: "1px solid rgba(101, 216, 169, 0.18)",
      borderRadius: 18,
      padding: 14,
      marginBottom: 12,
    }
  }

  return {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  }
}

function formatKind(kind: string) {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
}

export default function JobDetailPage() {
  const { id } = useParams()
  const [jobData, setJobData] = useState<JobDetailResponse | null>(null)
  const [conversationData, setConversationData] = useState<AiConversationResponse | null>(null)

  useEffect(() => {
    if (!id) return

    fetch(`${API}/admin/job/${TENANT}/${id}`)
      .then((r) => r.json())
      .then((data) => setJobData(data))

    fetch(`${API}/ai/conversation/${TENANT}/${id}`)
      .then((r) => r.json())
      .then((data) => setConversationData(data))
  }, [id])

  const job = jobData?.job
  const aiConversation = conversationData?.conversation || []
  const timeline = jobData?.timeline || []

  if (!job) {
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
        <div style={cardStyle()}>Loading job...</div>
      </div>
    )
  }

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

      <div style={{ display: "grid", gridTemplateColumns: "0.95fr 1.05fr", gap: 20 }}>
        <div style={cardStyle()}>
          <div style={{ fontSize: 28, fontWeight: 900, marginBottom: 10 }}>
            {job.customer_name || `Job #${job.id}`}
          </div>

          <div style={{ color: "#9db2d9", marginBottom: 20 }}>
            Individual prospect / job record
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

        <div style={cardStyle()}>
          <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 8 }}>
            Conversation Timeline
          </div>

          <div style={{ color: "#9db2d9", marginBottom: 20 }}>
            AI messages, customer replies, buying signal alerts, and manual notes
          </div>

          {aiConversation.length ? (
            aiConversation.map((item) => (
              <div key={item.id} style={timelineBubbleStyle(item.kind)}>
                <div
                  style={{
                    fontSize: 12,
                    color: "#c7d8f4",
                    fontWeight: 900,
                    marginBottom: 6,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  {formatKind(item.kind)}
                </div>

                <div style={{ fontWeight: 700, lineHeight: 1.5 }}>{item.message}</div>

                <div style={{ color: "#97a8c9", fontSize: 12, marginTop: 6 }}>
                  {item.created_at}
                </div>
              </div>
            ))
          ) : (
            <div style={{ color: "#9db2d9", marginBottom: 20 }}>
              No AI conversation items yet.
            </div>
          )}

          {timeline.filter((t: any) => t.kind === "manual_note").length > 0 && (
            <>
              <div style={{ fontSize: 18, fontWeight: 900, marginTop: 24, marginBottom: 14 }}>
                Manual Notes
              </div>

              {timeline
                .filter((t: any) => t.kind === "manual_note")
                .map((item: any) => (
                  <div key={item.id} style={timelineBubbleStyle(item.kind)}>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#c7d8f4",
                        fontWeight: 900,
                        marginBottom: 6,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                      }}
                    >
                      Manual Note
                    </div>

                    <div style={{ fontWeight: 700, lineHeight: 1.5 }}>{item.message}</div>

                    <div style={{ color: "#97a8c9", fontSize: 12, marginTop: 6 }}>
                      {item.created_at}
                    </div>
                  </div>
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
