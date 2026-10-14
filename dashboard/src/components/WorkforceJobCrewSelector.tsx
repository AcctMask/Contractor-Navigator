import { useState } from "react"
import { getToken } from "../lib/auth"

export default function WorkforceJobCrewSelector({
  jobId,
  apiBase,
  refreshKey: _refreshKey,
  onAssigned,
}: {
  jobId: number
  apiBase: string
  refreshKey: number
  onAssigned: () => void
}) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [role, setRole] = useState<"lead" | "member">("member")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  async function assign() {
    if (!name.trim() || !phone.trim() || busy) return

    setBusy(true)
    setError("")
    setNotice("")

    try {
      const response = await fetch(
        `${apiBase}/workforce/jobs/${jobId}/add-crew`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${getToken()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            full_name: name.trim(),
            mobile_phone: phone.trim(),
            crew_role: role,
            preferred_language: "en",
          }),
        }
      )

      const json = await response.json()

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Could not assign crew member")
      }

      setName("")
      setPhone("")
      setRole("member")
      setNotice("Crew member assigned")
      onAssigned()
    } catch (err: any) {
      setError(err?.message || "Could not assign crew member")
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
    boxSizing: "border-box" as const,
  }

  return (
    <div style={{
      padding: 16,
      border: "1px solid #64748b",
      borderRadius: 12,
      marginBottom: 18,
    }}>
      <h3 style={{ marginTop: 0 }}>Add Crew Member</h3>

      <p style={{ opacity: 0.8 }}>
        Add a person to the subcontractor already assigned above.
        No invitation SMS is sent.
      </p>

      <div style={{ display: "grid", gap: 10, maxWidth: 500 }}>
        <label htmlFor="job-crew-name">Full name</label>
        <input
          id="job-crew-name"
          placeholder="Joe Smith"
          value={name}
          style={fieldStyle}
          onChange={event => setName(event.target.value)}
        />

        <label htmlFor="job-crew-role">Role</label>
        <select
          id="job-crew-role"
          value={role}
          style={fieldStyle}
          onChange={event =>
            setRole(event.target.value as "lead" | "member")
          }
        >
          <option value="lead">Crew Lead</option>
          <option value="member">Crew Member</option>
        </select>

        <label htmlFor="job-crew-phone">Mobile phone</label>
        <input
          id="job-crew-phone"
          type="tel"
          placeholder="(555) 555-5555"
          value={phone}
          style={fieldStyle}
          onChange={event => setPhone(event.target.value)}
        />

        <button
          type="button"
          disabled={busy || !name.trim() || !phone.trim()}
          onClick={assign}
        >
          {busy ? "Assigning..." : "Assign Crew Member"}
        </button>
      </div>

      {error && (
        <p role="alert" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      )}

      {notice && <p role="status">{notice}</p>}
    </div>
  )
}
