import { useEffect, useState } from "react"
import { getToken } from "../lib/auth"

const API_BASE = import.meta.env.VITE_API_BASE

type CrewMember = {
  id: number
  full_name: string
  mobile_phone: string
  crew_role: "lead" | "member"
  preferred_language: "en" | "es"
  invitation_status: string
  account_activated?: boolean
  invitation_issued?: boolean
  is_active: boolean
}

const emptyForm = {
  full_name: "",
  mobile_phone: "",
  crew_role: "member" as "lead" | "member",
  preferred_language: "en" as "en" | "es",
}

export default function WorkforceCompanyCrew({
  companyId,
}: {
  companyId: string | number | null | undefined
}) {
  const [crew, setCrew] = useState<CrewMember[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [loading, setLoading] = useState(false)

  const validCompanyId = Number(companyId) > 0 ? Number(companyId) : null

  useEffect(() => {
    let cancelled = false
    setCrew([])
    setForm(emptyForm)
    setEditingId(null)
    setError("")
    setNotice("")
    if (!validCompanyId) return

    setLoading(true)
    fetch(`${API_BASE}/workforce/companies/${validCompanyId}/crew`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(async (response) => {
        const json = await response.json()
        if (!response.ok || !json.ok) {
          throw new Error(json.error || "Could not load crew")
        }
        return json.crew as CrewMember[]
      })
      .then((members) => {
        if (!cancelled) setCrew(members)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [validCompanyId])

  async function saveCrew() {
    if (!validCompanyId || busy) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const endpoint =
        `${API_BASE}/workforce/companies/${validCompanyId}/crew` +
        (editingId ? `/${editingId}` : "")
      const response = await fetch(endpoint, {
        method: editingId ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${getToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      })
      const json = await response.json()
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Could not save crew member")
      }
      const member = json.crew_member as CrewMember
      setCrew((current) =>
        editingId
          ? current.map((item) => item.id === editingId ? member : item)
          : [...current, member]
      )
      setForm(emptyForm)
      setEditingId(null)
      setNotice(editingId ? "Crew member updated" : "Crew member added")
    } catch (err: any) {
      setError(err?.message || "Could not save crew member")
    } finally {
      setBusy(false)
    }
  }

  const fieldStyle = {
    width: "100%",
    padding: "10px",
    borderRadius: "8px",
    border: "1px solid #64748b",
    background: "transparent",
    color: "inherit",
    boxSizing: "border-box" as const,
  }

  return (
    <section style={{ marginTop: 22, padding: 16, border: "1px solid #64748b", borderRadius: 12 }}>
      <h3 style={{ marginTop: 0 }}>Crew Leads &amp; Members</h3>
      <p style={{ opacity: 0.8 }}>
        Company crew directory. Adding someone here does not assign a job or send an invitation.
      </p>

      {!validCompanyId ? (
        <p>Save the subcontractor company before adding crew members.</p>
      ) : (
        <>
          {loading ? <p>Loading crew...</p> : null}
          {!loading && crew.length === 0 ? <p>No crew members listed yet.</p> : null}

          {crew.map((member) => (
            <div key={member.id} style={{
              display: "flex", justifyContent: "space-between",
              alignItems: "center", gap: 12, padding: "10px 0",
              borderBottom: "1px solid #64748b", flexWrap: "wrap",
            }}>
              <div>
                <strong>{member.full_name}</strong>
                <div>{member.mobile_phone}</div>
                <small>
                  {member.crew_role === "lead" ? "Crew Lead" : "Crew Member"}
                  {" · "}
                  {member.preferred_language === "es" ? "Español" : "English"}
                  {" · "}
                  {member.account_activated
                    ? "Account active"
                    : member.invitation_issued
                      ? member.invitation_status
                      : "Roster only"}
                </small>
              </div>
              {!member.account_activated && (
                <button type="button" disabled={busy}
                  onClick={() => {
                    setEditingId(member.id)
                    setForm({
                      full_name: member.full_name,
                      mobile_phone: member.mobile_phone,
                      crew_role: member.crew_role,
                      preferred_language: member.preferred_language,
                    })
                    setError("")
                    setNotice("")
                  }}>
                  Edit
                </button>
              )}
            </div>
          ))}

          <h4>{editingId ? "Edit Crew Member" : "Add Crew Member"}</h4>
          <div style={{ display: "grid", gap: 10 }}>
            <input aria-label="Crew name" placeholder="Full name"
              value={form.full_name} style={fieldStyle}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            <input aria-label="Crew mobile phone" placeholder="Mobile phone"
              type="tel" value={form.mobile_phone} style={fieldStyle}
              onChange={(e) => setForm({ ...form, mobile_phone: e.target.value })} />
            <select aria-label="Crew role" value={form.crew_role} style={fieldStyle}
              onChange={(e) => setForm({
                ...form, crew_role: e.target.value as "lead" | "member",
              })}>
              <option value="lead">Crew Lead</option>
              <option value="member">Crew Member</option>
            </select>
            <select aria-label="Crew language" value={form.preferred_language}
              style={fieldStyle}
              onChange={(e) => setForm({
                ...form, preferred_language: e.target.value as "en" | "es",
              })}>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" disabled={busy || !form.full_name.trim() || !form.mobile_phone.trim()}
                onClick={saveCrew}>
                {busy ? "Saving..." : editingId ? "Save Changes" : "Add Crew Member"}
              </button>
              {editingId && (
                <button type="button" disabled={busy}
                  onClick={() => { setEditingId(null); setForm(emptyForm) }}>
                  Cancel
                </button>
              )}
            </div>
          </div>
          {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </section>
  )
}
