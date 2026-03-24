import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { acceptInvite, fetchInvite } from "../lib/auth"

export default function AcceptInvitePage() {
  const { token = "" } = useParams()
  const navigate = useNavigate()

  const [invite, setInvite] = useState<any>(null)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [status, setStatus] = useState("Loading invitation...")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true

    async function loadInvite() {
      try {
        const data = await fetchInvite(token)
        if (!active) return
        setInvite(data)
        setStatus("Invitation loaded")
      } catch (err: any) {
        if (!active) return
        setError(err?.message || "Invitation not found")
        setStatus("Load failed")
      }
    }

    loadInvite()

    return () => {
      active = false
    }
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (password.length < 6) {
      setError("Password must be at least 6 characters")
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      return
    }

    setSubmitting(true)
    setError("")
    setStatus("Accepting invitation...")

    try {
      await acceptInvite(token, password)
      setStatus("Invitation accepted")
      navigate("/job-admin")
    } catch (err: any) {
      setError(err?.message || "Accept invite failed")
      setStatus("Accept invite failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ marginTop: 0, fontSize: "42px", lineHeight: 1.1 }}>Accept Invitation</h1>

        {invite ? (
          <div
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "16px",
              padding: "14px 16px",
              marginBottom: "18px",
            }}
          >
            <div><strong>Name:</strong> {invite.full_name}</div>
            <div><strong>Email:</strong> {invite.email}</div>
            <div><strong>Role:</strong> {invite.role}</div>
            <div><strong>Expires:</strong> {new Date(invite.expires_at).toLocaleString()}</div>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "14px" }}>
          <div>
            <label style={labelStyle}>Create Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create password"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" disabled={submitting || !invite} style={buttonStyle}>
              {submitting ? "Creating Account..." : "Accept Invitation"}
            </button>
            <span style={{ opacity: 0.85 }}>{status}</span>
          </div>

          {error ? <div style={errorStyle}>{error}</div> : null}
        </form>
      </div>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background:
    "linear-gradient(135deg, rgba(0,25,70,1) 0%, rgba(2,18,47,1) 45%, rgba(8,42,102,1) 100%)",
  color: "#e8eefc",
  padding: "28px",
}

const cardStyle: React.CSSProperties = {
  maxWidth: "760px",
  margin: "80px auto 0",
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(81, 133, 255, 0.25)",
  borderRadius: "24px",
  padding: "24px",
}

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "8px",
  fontWeight: 700,
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  color: "#e8eefc",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: "14px",
  padding: "14px 16px",
  fontSize: "16px",
  outline: "none",
}

const buttonStyle: React.CSSProperties = {
  color: "#fff",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  border: "none",
  padding: "12px 18px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: 700,
}

const errorStyle: React.CSSProperties = {
  background: "rgba(150, 30, 30, 0.22)",
  border: "1px solid rgba(255, 120, 120, 0.35)",
  color: "#ffd1d1",
  borderRadius: "14px",
  padding: "12px 14px",
}
