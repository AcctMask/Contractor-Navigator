import { useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"

const API = "http://localhost:8795"

export default function CommercialPipelinePage() {
  const [targets, setTargets] = useState<any[]>([])
  const [totalDatabaseCount, setTotalDatabaseCount] = useState(0)
  const [selected, setSelected] = useState<any | null>(null)
  const [detail, setDetail] = useState<any | null>(null)
  const [batches, setBatches] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("all")
  const [city, setCity] = useState("")
  const [status, setStatus] = useState("all")
  const [priority, setPriority] = useState("all")

  const [campaignName, setCampaignName] = useState("Tampa General Contractor Batch")
  const [campaignCategory, setCampaignCategory] = useState("general_contractor")
  const [campaignCity, setCampaignCity] = useState("Tampa")
  const [campaignStatus, setCampaignStatus] = useState("working")
  const [campaignPriority, setCampaignPriority] = useState("all")
  const [campaignLimit, setCampaignLimit] = useState(25)

  useEffect(() => {
    void loadAll()
  }, [])

  async function loadAll() {
    await Promise.all([loadTargets(), loadBatches()])
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

  async function loadDetail(id: string) {
    const res = await fetch(`${API}/commercial/targets/${id}`)
    const data = await res.json()
    setDetail(data)
  }

  async function queueEmail() {
    if (!selected) return
    setNotice("")
    setError("")

    const res = await fetch(`${API}/commercial/targets/${selected.id}/queue-email`, {
      method: "POST",
    })
    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data.error || "Queue failed")
      return
    }

    setNotice(data.queued ? "Email queued." : data.reason || "Email already queued.")
    await loadDetail(selected.id)
  }

  async function sendEmail(queueId: string) {
    if (!selected) return
    setLoading(true)
    setNotice("")
    setError("")

    const res = await fetch(`${API}/commercial/email-queue/${queueId}/send`, {
      method: "POST",
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok || !data.ok) {
      setError(data.error || "Send failed")
      return
    }

    setNotice("Email sent.")
    await loadTargets()
    await loadDetail(selected.id)
  }

  async function updateStatus(nextStatus: string) {
    if (!selected) return

    const nextPriority =
      nextStatus === "on_hook"
        ? "high"
        : nextStatus === "active"
          ? "medium"
          : nextStatus === "opted_out"
            ? "none"
            : "low"

    const res = await fetch(`${API}/commercial/targets/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pipeline_status: nextStatus,
        priority_level: nextPriority,
      }),
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

    const res = await fetch(`${API}/commercial/targets/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        do_not_contact: true,
        pipeline_status: "opted_out",
        priority_level: "none",
      }),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setError(data.error || "Do not contact update failed")
      return
    }

    setNotice("Contractor marked do not contact.")
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
      setError(data.error || "Campaign launch failed")
      return
    }

    setNotice(`Campaign queued: ${data.queued} queued, ${data.skipped} skipped.`)
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
    onHook: targets.filter((t) => t.pipeline_status === "on_hook").length,
    active: targets.filter((t) => t.pipeline_status === "active").length,
    working: targets.filter((t) => !t.pipeline_status || t.pipeline_status === "working").length,
  }

  return (
    <div style={wrap}>
      <div style={summaryGrid}>
        <div style={summaryCard}>
          <div style={summaryNumber}>{counts.totalDatabase}</div>
          <div style={summaryLabel}>Total Database</div>
        </div>
        <div style={summaryCard}>
          <div style={summaryNumber}>{counts.loaded}</div>
          <div style={summaryLabel}>Loaded On Screen</div>
        </div>
        <div style={summaryCard}>
          <div style={summaryNumber}>{counts.shown}</div>
          <div style={summaryLabel}>Matching Filters</div>
        </div>
        <div style={summaryCard}>
          <div style={summaryNumber}>{counts.working}</div>
          <div style={summaryLabel}>Working Loaded</div>
        </div>
      </div>

      {notice ? <div style={noticeBox}>{notice}</div> : null}
      {error ? <div style={errorBox}>{error}</div> : null}

      <div style={grid}>
        <div style={panel}>
          <h2>Contractors</h2>

          <div style={filterBox}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, city, email, ZIP..." style={input} />
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
              <option value="unresponsive">Unresponsive</option>
              <option value="opted_out">Opted Out</option>
              <option value="not_fit">Not Fit</option>
            </select>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={select}>
              <option value="all">All Priority</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="none">None</option>
            </select>
          </div>

          <div style={countLine}>
            Showing {counts.shown} displayed records out of {counts.loaded} loaded / {counts.totalDatabase} total database records
          </div>

          {filtered.slice(0, 500).map((t) => (
            <div
              key={t.id}
              onClick={() => {
                setSelected(t)
                void loadDetail(t.id)
              }}
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

        <div style={rightStack}>
          <div style={panel}>
            <h2>Campaign Launcher</h2>

            <div style={filterBox}>
              <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Campaign name" style={input} />
              <select value={campaignCategory} onChange={(e) => setCampaignCategory(e.target.value)} style={select}>
                <option value="general_contractor">General Contractor</option>
                <option value="building_contractor">Building Contractor</option>
                <option value="residential_contractor">Residential Contractor</option>
              </select>
              <input value={campaignCity} onChange={(e) => setCampaignCity(e.target.value)} placeholder="City" style={input} />
              <select value={campaignStatus} onChange={(e) => setCampaignStatus(e.target.value)} style={select}>
                <option value="working">Working</option>
                <option value="active">Active</option>
                <option value="on_hook">On Hook</option>
              </select>
              <select value={campaignPriority} onChange={(e) => setCampaignPriority(e.target.value)} style={select}>
                <option value="all">All Priority</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <input
                type="number"
                value={campaignLimit}
                onChange={(e) => setCampaignLimit(Number(e.target.value))}
                min={1}
                max={250}
                style={input}
              />
            </div>

            <button onClick={launchCampaign} disabled={loading} style={primaryButton}>
              {loading ? "Launching..." : "Launch Campaign From Filters"}
            </button>

            <h3 style={{ marginTop: 18 }}>Recent Campaign Batches</h3>
            {batches.slice(0, 5).map((b) => (
              <div key={b.id} style={batchBox}>
                <div style={name}>{b.name}</div>
                <div style={sub}>
                  {b.status} • {b.queued_count} queued • {b.skipped_count} skipped • {new Date(b.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          <div style={panel}>
            {!detail ? (
              <div>Select a contractor</div>
            ) : (
              <>
                <h2>{detail.target.business_name}</h2>

                <div style={section}><b>Email:</b> {detail.target.email}</div>
                <div style={section}><b>Type:</b> {detail.target.contractor_category}</div>
                <div style={section}><b>City:</b> {detail.target.city}, {detail.target.state || "FL"}</div>
                <div style={section}><b>Status:</b> {detail.target.pipeline_status}</div>
                <div style={section}><b>Priority:</b> {detail.target.priority_level}</div>
                <div style={section}><b>Fit Score:</b> {detail.target.fit_score}</div>

                <div style={buttonRow}>
                  <button onClick={() => updateStatus("working")}>Working</button>
                  <button onClick={() => updateStatus("active")}>Active</button>
                  <button onClick={() => updateStatus("on_hook")}>On Hook</button>
                  <button onClick={markDoNotContact}>Do Not Contact</button>
                </div>

                <div style={buttonRow}>
                  <button onClick={queueEmail}>Queue Email</button>
                </div>

                <h3 style={{ marginTop: 20 }}>Email History</h3>

                {detail.email_history.map((e: any) => (
                  <div key={e.queue_id} style={emailBox}>
                    <div><b>{e.subject || "State-based message"}</b></div>
                    <div style={{ opacity: 0.7, whiteSpace: "pre-wrap" }}>{e.body || "Message generated from contractor state."}</div>
                    <div style={emailFooter}>
                      {e.status} • {e.sent_at || "pending"}
                      {e.status === "pending" && (
                        <button onClick={() => sendEmail(e.queue_id)} disabled={loading} style={sendBtn}>
                          Send
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const wrap: CSSProperties = { maxWidth: 1200, margin: "0 auto" }
const summaryGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }
const summaryCard: CSSProperties = { background: "rgba(255,255,255,0.08)", borderRadius: 18, padding: 16, border: "1px solid rgba(255,255,255,0.12)" }
const summaryNumber: CSSProperties = { fontSize: 30, fontWeight: 900 }
const summaryLabel: CSSProperties = { opacity: 0.7, fontSize: 13 }
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 2fr", gap: 20 }
const rightStack: CSSProperties = { display: "grid", gap: 20 }
const panel: CSSProperties = { background: "rgba(255,255,255,0.08)", borderRadius: 20, padding: 20, border: "1px solid rgba(255,255,255,0.12)" }
const filterBox: CSSProperties = { display: "grid", gap: 8, marginBottom: 12 }
const input: CSSProperties = { padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(0,0,0,0.18)", color: "#fff" }
const select: CSSProperties = { padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "#071b45", color: "#fff" }
const countLine: CSSProperties = { fontSize: 12, opacity: 0.65, marginBottom: 10 }
const row: CSSProperties = { padding: 12, borderRadius: 12, cursor: "pointer", marginBottom: 8, border: "1px solid rgba(255,255,255,0.08)" }
const name: CSSProperties = { fontWeight: 800 }
const sub: CSSProperties = { opacity: 0.7, fontSize: 12, marginTop: 4 }
const tagRow: CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }
const pill: CSSProperties = { fontSize: 11, background: "rgba(74,168,255,0.14)", border: "1px solid rgba(74,168,255,0.24)", borderRadius: 999, padding: "4px 8px" }
const section: CSSProperties = { marginTop: 10 }
const buttonRow: CSSProperties = { marginTop: 15, display: "flex", gap: 10, flexWrap: "wrap" }
const emailBox: CSSProperties = { marginTop: 10, padding: 10, borderRadius: 12, background: "rgba(0,0,0,0.2)" }
const emailFooter: CSSProperties = { marginTop: 8, fontSize: 12, opacity: 0.6, display: "flex", justifyContent: "space-between", alignItems: "center" }
const sendBtn: CSSProperties = { marginLeft: 10, padding: "4px 10px", borderRadius: 8, cursor: "pointer" }
const primaryButton: CSSProperties = { color: "#fff", background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)", border: "none", padding: "11px 16px", borderRadius: 14, cursor: "pointer", fontWeight: 700 }
const noticeBox: CSSProperties = { background: "rgba(34,197,94,0.14)", border: "1px solid rgba(34,197,94,0.30)", padding: 12, borderRadius: 14, marginBottom: 12 }
const errorBox: CSSProperties = { background: "rgba(239,68,68,0.16)", border: "1px solid rgba(239,68,68,0.35)", padding: 12, borderRadius: 14, marginBottom: 12 }
const batchBox: CSSProperties = { marginTop: 10, padding: 10, borderRadius: 12, background: "rgba(0,0,0,0.18)", border: "1px solid rgba(255,255,255,0.08)" }
