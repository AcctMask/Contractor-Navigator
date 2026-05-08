import { useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"

const API = import.meta.env.VITE_API_BASE || "https://contractor-navigator.onrender.com"

export default function CommercialPipelinePage() {
  const [targets, setTargets] = useState<any[]>([])
  const [totalDatabaseCount, setTotalDatabaseCount] = useState(0)
  const [selected, setSelected] = useState<any | null>(null)
  const [detail, setDetail] = useState<any | null>(null)
  const [batches, setBatches] = useState<any[]>([])
  const [pendingQueue, setPendingQueue] = useState<any[]>([])
  const [sentQueue, setSentQueue] = useState<any[]>([])
  const [selectedBatchTitle, setSelectedBatchTitle] = useState("")
  const [selectedBatchRows, setSelectedBatchRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("all")
  const [city, setCity] = useState("")
  const [status, setStatus] = useState("all")
  const [priority, setPriority] = useState("all")

  const campaignName = "Tampa General Contractor Batch"
  const campaignCategory = "general_contractor"
  const campaignCity = "Tampa"
  const campaignStatus = "working"
  const campaignPriority = "all"
  const campaignLimit = 25

  useEffect(() => {
    void loadAll()
  }, [])

  async function loadAll() {
    await Promise.all([loadTargets(), loadBatches(), loadPendingQueue(), loadSentQueue()])
  }

  async function loadTargets() {
    const res = await fetch(`${API}/commercial/targets`)
    const data = await res.json()
    setTargets(data.rows || [])
    setTotalDatabaseCount(data.total_count || data.rows?.length || 0)
  }

  async function loadBatches() {
    const res = await fetch(`${API}/commercial/campaigns/batches`)
    const data = await res.json()
    setBatches(data.rows || [])
  }

  async function loadPendingQueue() {
    const res = await fetch(`${API}/commercial/email-queue/pending`)
    const data = await res.json()
    setPendingQueue(data.rows || [])
  }

  async function loadSentQueue() {
    const res = await fetch(`${API}/commercial/email-queue/sent`)
    const data = await res.json()
    setSentQueue(data.rows || [])
  }

  async function loadDetail(id: string) {
    const res = await fetch(`${API}/commercial/targets/${id}`)
    const data = await res.json()
    setDetail(data)
  }

  async function openContractorRecord(targetId: string) {
    await loadDetail(targetId)
    const match = targets.find((t) => t.id === targetId)
    setSelected(match || { id: targetId })
  }

  async function queueEmail() {
    if (!selected) return
    setNotice("")
    setError("")

    const res = await fetch(`${API}/commercial/targets/${selected.id}/queue-email`, { method: "POST" })
    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data.error || "Queue failed")
      return
    }

    setNotice(data.queued ? "Email queued." : data.reason || "Already queued.")
    await loadDetail(selected.id)
  }

  async function sendEmail(queueId: string) {
    setNotice("")
    setError("")

    const res = await fetch(`${API}/commercial/email-queue/${queueId}/send`, { method: "POST" })
    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data.error || "Send failed")
      return
    }

    setNotice("Email sent.")
    await loadAll()

    if (selected?.id) {
      await loadDetail(selected.id)
    }
  }

  async function updateStatus(nextStatus: string) {
    if (!selected) return
    setNotice("")
    setError("")

    const res = await fetch(`${API}/commercial/targets/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline_status: nextStatus }),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data.error || "Update failed")
      return
    }

    setNotice("Contractor updated.")
    await loadTargets()
    await loadDetail(selected.id)
  }

  async function markDoNotContact() {
    if (!selected) return
    setNotice("")
    setError("")

    const res = await fetch(`${API}/commercial/targets/${selected.id}/dnc`, { method: "POST" })
    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data.error || "DNC failed")
      return
    }

    setNotice("DNC updated.")
    await loadTargets()
    await loadDetail(selected.id)
  }

  async function launchCampaign() {
    setLoading(true)
    setNotice("")
    setError("")

    const payload: any = {
      name: campaignName,
      contractor_category: campaignCategory,
      city: campaignCity,
      pipeline_status: campaignStatus,
      limit: campaignLimit,
    }

    if (campaignPriority !== "all") {
      payload.priority_level = campaignPriority
    }

    const res = await fetch(`${API}/commercial/campaigns/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok || !data.ok) {
      setError(data.error || "Campaign failed")
      return
    }

    setNotice(`Campaign queued: ${data.queued} queued, ${data.skipped || 0} skipped.`)
    await loadAll()
  }

  const filtered = useMemo(() => {
    return targets.filter((t) => {
      const q = search.toLowerCase().trim()
      const searchable = `${t.business_name || ""} ${t.city || ""} ${t.email || ""} ${t.zip || ""}`.toLowerCase()

      const matchesSearch = !q || searchable.includes(q)
      const matchesCategory = category === "all" || t.contractor_category === category
      const matchesCity = !city || (t.city || "").toLowerCase().includes(city.toLowerCase())
      const matchesStatus = status === "all" || (t.pipeline_status || "working") === status
      const matchesPriority = priority === "all" || (t.priority_level || "low") === priority

      return matchesSearch && matchesCategory && matchesCity && matchesStatus && matchesPriority
    })
  }, [targets, search, category, city, status, priority])

  const counts = {
    totalDatabase: totalDatabaseCount,
    loaded: targets.length,
    shown: filtered.length,
  }

  const dailyGoal = 50
  const manualBatch = batches.find((b) => b.id === "manual-email-queue") || {}
  const sentTotal = Number(manualBatch.sent_count || 0)
  const pendingTotal = Number(manualBatch.pending_count || pendingQueue.length || 0)
  const failedTotal = Number(manualBatch.failed_count || 0)
  const remainingToContact = Math.max(counts.totalDatabase - sentTotal, 0)
  const estimatedDaysRemaining = Math.ceil(remainingToContact / dailyGoal)

  return (
    <div style={wrap}>
      <div style={summaryGrid}>
        <div style={summaryCard}>
          <div style={summaryNumber}>{counts.totalDatabase}</div>
          <div style={summaryLabel}>Total Database</div>
        </div>

        <div style={summaryCard}>
          <div style={summaryNumber}>{counts.loaded}</div>
          <div style={summaryLabel}>Loaded</div>
        </div>

        <div style={summaryCard}>
          <div style={summaryNumber}>{counts.shown}</div>
          <div style={summaryLabel}>Filtered</div>
        </div>

        <div style={campaignSummaryCard}>
          <div style={summaryLabel}>Current GC Outreach Campaign</div>
          <div style={{ marginTop: 6, fontWeight: 900 }}>50 emails/day</div>
          <div style={{ marginTop: 5, fontSize: 13, opacity: 0.9 }}>
            Sent: {sentTotal} • Pending: {pendingTotal} • Failed: {failedTotal}
          </div>
          <div style={{ marginTop: 5, fontSize: 13, opacity: 0.9 }}>
            Remaining: {remainingToContact} • Est. days left: {estimatedDaysRemaining}
          </div>
        </div>
      </div>

      {notice ? <div style={noticeBox}>{notice}</div> : null}
      {error ? <div style={errorBox}>{error}</div> : null}

      <div style={grid}>
        <div style={panel}>
          <h2>Contractor Search</h2>

          <div style={filterBox}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contractor..." style={input} />

            <select value={category} onChange={(e) => setCategory(e.target.value)} style={select}>
              <option value="all">All Types</option>
              <option value="general_contractor">General Contractor</option>
              <option value="building_contractor">Building Contractor</option>
              <option value="residential_contractor">Residential Contractor</option>
            </select>

            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City..." style={input} />

            <select value={status} onChange={(e) => setStatus(e.target.value)} style={select}>
              <option value="all">All Status</option>
              <option value="working">Working</option>
              <option value="active">Active</option>
              <option value="on_hook">On Hook</option>
              <option value="opted_out">Opted Out</option>
            </select>

            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={select}>
              <option value="all">All Priority</option>
              <option value="high">High Priority</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div style={countLine}>
            {counts.shown} matching records. Results appear in the filtered list on the right.
          </div>

          <div style={selectedFileBox}>
            {!detail ? (
              <>
                <h3 style={{ marginTop: 0 }}>Open Contractor File</h3>
                <div style={{ opacity: 0.75 }}>
                  Click a contractor in the filtered list or outreach batch to open the file here.
                </div>
              </>
            ) : (
              <>
                <h3 style={{ marginTop: 0 }}>Open Contractor File</h3>

                <div style={name}>{detail.target.business_name}</div>
                <div style={section}><b>Email:</b> {detail.target.email || "-"}</div>
                <div style={section}><b>Phone:</b> {detail.target.telephone || "-"}</div>
                <div style={section}><b>Website:</b> {detail.target.website || "-"}</div>
                <div style={section}><b>License:</b> {detail.target.license_number || "-"}</div>
                <div style={section}><b>City:</b> {detail.target.city}, {detail.target.state || "FL"}</div>
                <div style={section}><b>Status:</b> {detail.target.pipeline_status || "working"}</div>
                <div style={section}><b>Priority:</b> {detail.target.priority_level || "-"}</div>
                <div style={section}><b>Fit Score:</b> {detail.target.fit_score ?? "-"}</div>

                <div style={buttonRow}>
                  <button onClick={() => updateStatus("working")}>Working</button>
                  <button onClick={() => updateStatus("active")}>Active</button>
                  <button onClick={() => updateStatus("on_hook")}>On Hook</button>
                  <button onClick={markDoNotContact}>DNC</button>
                </div>

                <div style={buttonRow}>
                  <button onClick={queueEmail}>Queue Email</button>
                </div>

                <div style={{ marginTop: 14 }}>
                  <b>Notes:</b>
                  <div style={{ marginTop: 6, opacity: 0.85, minHeight: 80, whiteSpace: "pre-wrap" }}>
                    {detail.target.notes || "No notes yet"}
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <b>Email History:</b>
                  {detail.email_history?.length ? (
                    detail.email_history.slice(0, 6).map((e: any) => (
                      <div key={e.queue_id} style={miniEmailBox}>
                        {e.status} • {e.sent_at || "pending"}
                        {e.status === "pending" && (
                          <button onClick={() => sendEmail(e.queue_id)} style={sendBtn}>
                            Send
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div style={{ marginTop: 6, opacity: 0.75 }}>No email history yet.</div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div style={rightStack}>
          <div style={panel}>
            <h2>Daily GC Outreach Engine</h2>

            <div style={{ opacity: 0.75, marginBottom: 14 }}>
              This panel tracks the active contractor outreach queue.
            </div>

            <div style={buttonRow}>
              <button onClick={launchCampaign} disabled={loading} style={primaryButton}>
                {loading ? "Launching..." : "Launch Campaign"}
              </button>

              <button onClick={() => {
                setSearch("")
                setCategory("all")
                setCity("")
                setStatus("all")
                setPriority("all")
              }}>
                Clear Filters
              </button>

              <button onClick={loadAll}>Reload Data</button>
            </div>

            <div style={{ marginTop: 20 }}>
              <h3>Daily Outreach Timeline</h3>

              <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 14 }}>
                Click a batch to view the contractor list. Then click a contractor to open the file on the left.
              </div>

              <div
                style={batchBox}
                onClick={() => {
                  setSelectedBatchTitle("Today Pending Outreach")
                  setSelectedBatchRows(pendingQueue)
                }}
              >
                <div style={name}>Today Pending Outreach</div>
                <div style={sub}>
                  Scheduled: {pendingQueue[0]?.scheduled_at ? new Date(pendingQueue[0].scheduled_at).toLocaleString() : "Not scheduled"}
                </div>
                <div style={tagRow}>
                  <span style={pill}>Pending: {pendingQueue.length}</span>
                  <span style={pill}>Daily Goal: 50</span>
                </div>
              </div>

              <div
                style={batchBox}
                onClick={() => {
                  setSelectedBatchTitle("Previous Outreach Batch")
                  setSelectedBatchRows(sentQueue)
                }}
              >
                <div style={name}>Previous Outreach Batch</div>
                <div style={sub}>
                  Last Sent: {sentQueue[0]?.sent_at ? new Date(sentQueue[0].sent_at).toLocaleString() : "Unknown"}
                </div>
                <div style={tagRow}>
                  <span style={pill}>Sent: {sentQueue.length}</span>
                  <span style={pill}>Successful: {sentQueue.filter((q) => q.status === "sent").length}</span>
                  <span style={pill}>Failed: {sentQueue.filter((q) => q.status === "failed").length}</span>
                </div>
              </div>

              {selectedBatchRows.length > 0 && (
                <div style={{ marginTop: 22 }}>
                  <h3>{selectedBatchTitle} Contractors ({selectedBatchRows.length})</h3>

                  {selectedBatchRows.map((q) => (
                    <div key={q.queue_id} onClick={() => openContractorRecord(q.target_id)} style={batchBox}>
                      <div style={name}>{q.business_name}</div>
                      <div style={sub}>{q.city}, {q.state} • {q.email}</div>
                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.65 }}>
                        {q.status} • Scheduled: {q.scheduled_at ? new Date(q.scheduled_at).toLocaleString() : "-"}
                        {q.sent_at ? ` • Sent: ${new Date(q.sent_at).toLocaleString()}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={panel}>
            <h2>Filtered Contractor List</h2>

            <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 12 }}>
              This list uses the search and filters on the left. Click any contractor to open the file on the left.
            </div>

            {filtered.slice(0, 100).map((t) => (
              <div
                key={t.id}
                onClick={() => openContractorRecord(t.id)}
                style={{
                  ...row,
                  background: selected?.id === t.id ? "rgba(74,168,255,0.2)" : "rgba(255,255,255,0.05)",
                }}
              >
                <div style={name}>{t.business_name}</div>
                <div style={sub}>{t.city} • {t.email || "No email"}</div>
                <div style={tagRow}>
                  <span style={pill}>{t.contractor_category || "unknown"}</span>
                  <span style={pill}>{t.pipeline_status || "working"}</span>
                  <span style={pill}>{t.priority_level || "low"}</span>
                  <span style={pill}>score {t.fit_score ?? "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const wrap: CSSProperties = { maxWidth: 1200, margin: "0 auto" }

const summaryGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "0.8fr 0.8fr 0.8fr 1.8fr",
  gap: 12,
  marginBottom: 18,
}

const summaryCard: CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  borderRadius: 18,
  padding: 16,
  border: "1px solid rgba(255,255,255,0.12)",
}

const campaignSummaryCard: CSSProperties = {
  background: "rgba(74,168,255,0.10)",
  borderRadius: 18,
  padding: 16,
  border: "1px solid rgba(74,168,255,0.25)",
}

const summaryNumber: CSSProperties = { fontSize: 26, fontWeight: 900 }
const summaryLabel: CSSProperties = { opacity: 0.7, fontSize: 13 }

const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "0.85fr 1.7fr",
  gap: 20,
}

const rightStack: CSSProperties = { display: "grid", gap: 20 }

const panel: CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: 20,
  border: "1px solid rgba(255,255,255,0.12)",
}

const filterBox: CSSProperties = { display: "grid", gap: 8, marginBottom: 12 }

const input: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(0,0,0,0.18)",
  color: "#fff",
}

const select: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "#071b45",
  color: "#fff",
}

const countLine: CSSProperties = { fontSize: 12, opacity: 0.65, marginBottom: 10 }
const row: CSSProperties = { padding: 12, borderRadius: 12, cursor: "pointer", marginBottom: 8, border: "1px solid rgba(255,255,255,0.08)" }
const name: CSSProperties = { fontWeight: 800 }
const sub: CSSProperties = { opacity: 0.7, fontSize: 12, marginTop: 4 }
const tagRow: CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }
const pill: CSSProperties = { fontSize: 11, background: "rgba(74,168,255,0.14)", border: "1px solid rgba(74,168,255,0.24)", borderRadius: 999, padding: "4px 8px" }
const section: CSSProperties = { marginTop: 10 }
const buttonRow: CSSProperties = { marginTop: 15, display: "flex", gap: 10, flexWrap: "wrap" }

const selectedFileBox: CSSProperties = {
  marginTop: 18,
  marginBottom: 10,
  padding: 16,
  borderRadius: 14,
  background: "rgba(74,168,255,0.12)",
  border: "1px solid rgba(74,168,255,0.30)",
  minHeight: 470,
}

const miniEmailBox: CSSProperties = {
  marginTop: 6,
  padding: 8,
  borderRadius: 8,
  background: "rgba(0,0,0,0.18)",
  fontSize: 12,
}

const sendBtn: CSSProperties = { marginLeft: 10, padding: "4px 10px", borderRadius: 8, cursor: "pointer" }

const primaryButton: CSSProperties = {
  color: "#fff",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  border: "none",
  padding: "11px 16px",
  borderRadius: 14,
  cursor: "pointer",
  fontWeight: 700,
}

const batchBox: CSSProperties = {
  marginTop: 10,
  padding: 14,
  borderRadius: 12,
  background: "rgba(0,0,0,0.18)",
  border: "1px solid rgba(255,255,255,0.08)",
  cursor: "pointer",
}

const noticeBox: CSSProperties = { background: "rgba(34,197,94,0.14)", border: "1px solid rgba(34,197,94,0.30)", padding: 12, borderRadius: 14, marginBottom: 12 }
const errorBox: CSSProperties = { background: "rgba(239,68,68,0.16)", border: "1px solid rgba(239,68,68,0.35)", padding: 12, borderRadius: 14, marginBottom: 12 }
