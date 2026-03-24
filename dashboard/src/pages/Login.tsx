import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { login } from "../lib/auth"

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError("")
    setStatus("Logging in...")

    try {
      await login(email.trim(), password)
      setStatus("Login successful")
      navigate("/job-admin")
    } catch (err: any) {
      setError(err?.message || "Login failed")
      setStatus("Login failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ fontSize: "15px", opacity: 0.8, marginBottom: "8px" }}>
          Contractor Autopilot
        </div>
        <h1 style={{ marginTop: 0, fontSize: "42px", lineHeight: 1.1 }}>Login</h1>
        <p style={{ marginTop: "12px", fontSize: "18px", opacity: 0.88 }}>
          Sign in to manage invitations, jobs, and staff controls.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "14px", marginTop: "18px" }}>
          <div>
            <label style={labelStyle}>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="michelle@g2groofing.com"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" disabled={submitting} style={buttonStyle}>
              {submitting ? "Signing In..." : "Login"}
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
  maxWidth: "720px",
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
