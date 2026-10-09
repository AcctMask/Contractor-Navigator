import { useCallback, useEffect, useState } from "react"

type CrewMember = {
  id: number
  full_name: string
  crew_role: "lead" | "member"
  preferred_language: "en" | "es"
  invitation_status: string
  assignment_status: string
}

type Props = {
  jobId: number
  apiBase: string
  token: string
  refreshKey?: number
}

export default function WorkforceAssignedCrew({
  jobId,
  apiBase,
  token,
  refreshKey,
}: Props) {
  const [crew, setCrew] = useState<CrewMember[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<number | null>(null)
  const [messageTo, setMessageTo] = useState<number | null>(null)
  const [message, setMessage] = useState("")
  const [notice, setNotice] = useState("")

  const loadCrew = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(
        `${apiBase}/workforce/crew/${jobId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await response.json()
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to load crew")
      }
      setCrew(Array.isArray(data.crew) ? data.crew : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load crew")
    } finally {
      setLoading(false)
    }
  }, [apiBase, jobId, token])

  useEffect(() => {
    void loadCrew()
  }, [loadCrew, refreshKey])

  async function sendCrewSms(member: CrewMember) {
    const text = message.trim()
    if (!text || text.length > 1500) return

    setBusyId(member.id)
    setError("")
    setNotice("")

    try {
      const response = await fetch(
        `${apiBase}/workforce/crew/${jobId}/sms`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            crew_member_id: member.id,
            message: text,
          }),
        }
      )

      const data = await response.json()
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Crew SMS could not be sent")
      }

      setMessage("")
      setMessageTo(null)
      setNotice(`SMS submitted to ${member.full_name}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Crew SMS failed")
    } finally {
      setBusyId(null)
    }
  }

  async function revoke(member: CrewMember) {
    if (!window.confirm(
      `Remove ${member.full_name} from this job? This ends their access to this job.`
    )) return

    setBusyId(member.id)
    setError("")
    try {
      const response = await fetch(
        `${apiBase}/workforce/crew/${jobId}/revoke`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ crew_member_id: member.id }),
        }
      )
      const data = await response.json()
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to revoke crew assignment")
      }
      await loadCrew()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revocation failed")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <h3>Assigned Crew</h3>
      {loading && <p>Loading crew...</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
      {!loading && crew.length === 0 && <p>No crew assigned yet.</p>}
      {crew.map(member => (
        <div
          key={member.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            padding: "10px 0",
            borderBottom: "1px solid #ddd",
          }}
        >
          <div>
            <strong>{member.full_name}</strong>
            <div style={{ fontSize: 13 }}>
              {member.crew_role === "lead" ? "Crew Lead" : "Crew Member"}
              {" · "}
              {member.preferred_language === "es" ? "Español" : "English"}
              {" · "}
              {member.invitation_status}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => {
                setMessageTo(messageTo === member.id ? null : member.id)
                setMessage("")
                setError("")
                setNotice("")
              }}
            >
              Send SMS
            </button>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => void revoke(member)}
            >
              {busyId === member.id ? "Revoking..." : "Revoke from Job"}
            </button>
          </div>
          {messageTo === member.id && (
            <div style={{ width: "100%", marginTop: 8 }}>
              <textarea
                aria-label={`Message to ${member.full_name}`}
                value={message}
                maxLength={1500}
                onChange={event => setMessage(event.target.value)}
                placeholder="Job-related message..."
                rows={3}
                style={{ width: "100%", boxSizing: "border-box" }}
              />
              <button
                type="button"
                disabled={busyId !== null || !message.trim()}
                onClick={() => void sendCrewSms(member)}
              >
                {busyId === member.id ? "Sending..." : "Send Job SMS"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
