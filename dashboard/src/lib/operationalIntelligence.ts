import { getToken } from "./auth"

const API_BASE = import.meta.env.VITE_API_BASE
const OIM_URL =
  import.meta.env.VITE_OPERATIONAL_INTELLIGENCE_URL ||
  "https://operational-intelligence-chi.vercel.app"

export async function getOperationalIntelligenceAccess(): Promise<boolean> {
  const token = getToken()
  if (!token) return false
  const response = await fetch(`${API_BASE}/operational-intelligence/access`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  if (!response.ok) return false
  const data = await response.json()
  return data.ok === true && data.authorized === true
}

export async function openOperationalIntelligence(tenantSlug: string): Promise<void> {
  const token = getToken()
  if (!token) throw new Error("Navigator login required")
  const response = await fetch(`${API_BASE}/operational-intelligence/handoff`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tenant_slug: tenantSlug }),
  })
  const data = await response.json()
  if (!response.ok || data.ok !== true || !data.code) {
    throw new Error(data.error || "Operational Intelligence access denied")
  }
  window.location.assign(
    `${OIM_URL}/navigator-handoff?code=${encodeURIComponent(data.code)}`
  )
}
