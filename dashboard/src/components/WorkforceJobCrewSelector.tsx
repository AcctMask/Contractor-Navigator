import { useEffect, useState } from "react"
import { getToken } from "../lib/auth"

type Company = { id: number; company_name: string }
type Crew = {
  id: number
  full_name: string
  crew_role: "lead" | "member"
  is_active: boolean
}

export default function WorkforceJobCrewSelector({
  jobId,
  apiBase,
  refreshKey,
  onAssigned,
}: {
  jobId: number
  apiBase: string
  refreshKey: number
  onAssigned: () => void
}) {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState("")
  const [crew, setCrew] = useState<Crew[]>([])
  const [memberId, setMemberId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  useEffect(() => {
    let cancelled = false
    setCompanies([])
    setCompanyId("")
    setCrew([])
    setMemberId("")
    setError("")

    if (!Number.isSafeInteger(jobId) || jobId <= 0) return

    fetch(`${apiBase}/workforce/jobs/${jobId}/eligible-companies`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(async response => {
        const json = await response.json()
        if (!response.ok || !json.ok) {
          throw new Error(json.error || "Could not load companies")
        }
        return json.companies as Company[]
      })
      .then(items => { if (!cancelled) setCompanies(items) })
      .catch(err => { if (!cancelled) setError(err.message) })

    return () => { cancelled = true }
  }, [apiBase, jobId, refreshKey])

  useEffect(() => {
    let cancelled = false
    setCrew([])
    setMemberId("")
    if (!companyId) return

    fetch(`${apiBase}/workforce/companies/${companyId}/crew`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(async response => {
        const json = await response.json()
        if (!response.ok || !json.ok) {
          throw new Error(json.error || "Could not load company crew")
        }
        return (json.crew as Crew[]).filter(member => member.is_active)
      })
      .then(items => { if (!cancelled) setCrew(items) })
      .catch(err => { if (!cancelled) setError(err.message) })

    return () => { cancelled = true }
  }, [apiBase, companyId])

  async function assign() {
    if (!companyId || !memberId || busy) return
    setBusy(true)
    setError("")
    setNotice("")

    try {
      const response = await fetch(
        `${apiBase}/workforce/jobs/${jobId}/assign-existing-crew`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${getToken()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            company_id: Number(companyId),
            crew_member_id: Number(memberId),
          }),
        }
      )
      const json = await response.json()
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Crew assignment failed")
      }
      setNotice(json.already_assigned
        ? "This crew member is already assigned"
        : "Crew member assigned to job")
      setMemberId("")
      onAssigned()
    } catch (err: any) {
      setError(err?.message || "Crew assignment failed")
    } finally {
      setBusy(false)
    }
  }

  const fieldStyle = {
    width: "100%",
    padding: 10,
    borderRadius: 8,
    border: "1px solid #64748b",
    background: "transparent",
    color: "inherit",
  }

  return (
    <div style={{
      padding: 16, border: "1px solid #64748b",
      borderRadius: 12, marginBottom: 18,
    }}>
      <h3 style={{ marginTop: 0 }}>Assign Existing Crew</h3>
      <p style={{ opacity: 0.8 }}>
        Optional: select a crew member from an assigned subcontractor company.
        No invitation SMS is sent.
      </p>

      <div style={{ display: "grid", gap: 10, maxWidth: 500 }}>
        <select aria-label="Assigned subcontractor company"
          value={companyId} style={fieldStyle}
          onChange={event => {
            setCompanyId(event.target.value)
            setError("")
            setNotice("")
          }}>
          <option value="">Select assigned company...</option>
          {companies.map(company => (
            <option key={company.id} value={company.id}>
              {company.company_name}
            </option>
          ))}
        </select>

        <select aria-label="Crew member"
          value={memberId} style={fieldStyle}
          disabled={!companyId}
          onChange={event => setMemberId(event.target.value)}>
          <option value="">Select crew lead or member...</option>
          {crew.map(member => (
            <option key={member.id} value={member.id}>
              {member.full_name} — {member.crew_role === "lead"
                ? "Crew Lead" : "Crew Member"}
            </option>
          ))}
        </select>

        <button type="button" disabled={busy || !companyId || !memberId}
          onClick={assign}>
          {busy ? "Assigning..." : "Assign Selected Crew"}
        </button>
      </div>

      {companies.length === 0 && !error && (
        <p>No assigned subcontractor companies available yet.</p>
      )}
      {companyId && crew.length === 0 && !error && (
        <p>No active crew members in this company's directory.</p>
      )}
      {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
  )
}
