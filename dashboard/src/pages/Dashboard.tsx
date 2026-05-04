import { Link } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"

const API_BASE = import.meta.env.VITE_API_BASE
const TENANT_SLUG = "g2g-roofing"

// ✅ ACTIVE MODULES (highlighted)
const activeModules = [
  "Storm Check",
  "Storm Tracking Map",
  "Instant Estimator",
  "GC Mail Engine"
]

// ✅ MODULE DEFINITIONS
const modules = [
  { label: "SEO Lead Engine", to: "/reports" },
  { label: "Storm Check", href: "https://g2g-weather-event-frontend.onrender.com/storm-check.html?zip=33710" },
  { label: "Storm Tracking Map", href: "https://g2g-weather-event-frontend.onrender.com" },
  { label: "Roof Age Targeting", to: "/roof-intelligence" },
  { label: "Evergreen Social", to: "/social" },
  { label: "Instant Estimator", to: "/estimator" },
  { label: "GC Mail Engine", to: "/commercial" }
]

type DashboardJob = {
  id: number
  stage?: string | null
  zip?: string | null
  carrier?: string | null
  claim_number?: string | null
  lead_source?: string | null
  bot_paused?: boolean | null
  customer_name?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export default function DashboardPage() {
  const [jobs, setJobs] = useState<DashboardJob[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    try {
      const res = await fetch(`${API_BASE}/admin/jobs/${TENANT_SLUG}?limit=50`)
      const data = await res.json()
      setJobs(data.jobs || [])
    } catch (err) {
      console.error(err)
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

  return (
    <div style={layout}>
      {/* 🔵 LEFT SIDEBAR */}
      <aside style={sidebar}>
        <div style={title}>Supporting Modules</div>

        <div style={capabilityWrap}>
          {modules.map((item) => {
            const isActive = activeModules.includes(item.label)

            const baseStyle = {
              ...capabilityPill,
              background: isActive ? "#1e3a8a" : "transparent",
              border: isActive
                ? "1px solid #3b82f6"
                : "1px solid rgba(255,255,255,0.1)",
              color: isActive ? "#fff" : "rgba(255,255,255,0.5)",
              opacity: isActive ? 1 : 0.6,
              cursor: isActive ? "pointer" : "not-allowed",
              textDecoration: "none"
            }

            if ("href" in item) {
              return (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  style={baseStyle}
                >
                  {item.label}
                  {!isActive && <span style={soonTag}> (soon)</span>}
                </a>
              )
            }

            return (
              <Link
                key={item.label}
                to={isActive ? item.to : "#"}
                style={baseStyle}
              >
                {item.label}
                {!isActive && <span style={soonTag}> (soon)</span>}
              </Link>
            )
          })}
        </div>
      </aside>

      {/* 🟢 MAIN */}
      <main style={main}>
        <h1>Command Center</h1>

        {loading ? (
          <div>Loading...</div>
        ) : (
          <div style={jobList}>
            {sortedJobs.slice(0, 10).map((job) => (
              <div key={job.id} style={jobRow}>
                <div>{job.customer_name || "Unknown"}</div>
                <div>{job.stage}</div>
                <div>{job.zip}</div>
                <div>{job.carrier}</div>
                <div>{job.claim_number}</div>
                <div>{job.lead_source}</div>
                <div>{job.bot_paused ? "Paused" : "On"}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

/* 🎨 STYLES */

const layout: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "250px 1fr",
  gap: 20,
  padding: 20,
  color: "#fff"
}

const sidebar: CSSProperties = {
  background: "rgba(0,0,0,0.4)",
  padding: 16,
  borderRadius: 12
}

const title: CSSProperties = {
  fontWeight: 700,
  marginBottom: 12
}

const capabilityWrap: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8
}

const capabilityPill: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 20,
  fontSize: 12
}

const soonTag: CSSProperties = {
  fontSize: 10,
  marginLeft: 4
}

const main: CSSProperties = {}

const jobList: CSSProperties = {
  display: "grid",
  gap: 8
}

const jobRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(7, 1fr)",
  gap: 8,
  background: "rgba(255,255,255,0.05)",
  padding: 8,
  borderRadius: 8
}
