import { useState } from "react"
import { useNavigate } from "react-router-dom"

const API = "http://localhost:8787"
const TENANT = "g2g-roofing"

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [status, setStatus] = useState("")

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setStatus("Signing in...")

    const res = await fetch(`${API}/auth/${TENANT}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })

    const data = await res.json()

    if (!data.ok) {
      setStatus(data.error || "Login failed")
      return
    }

    localStorage.setItem("copilot_token", data.token)
    localStorage.setItem("copilot_user", JSON.stringify(data.user))
    setStatus("Signed in")
    navigate("/")
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(circle at top right, rgba(37,91,189,0.45), transparent 28%), linear-gradient(180deg, #031126 0%, #04142b 100%)",
        color: "#eef4ff",
        fontFamily: "Inter, system-ui, sans-serif",
        padding: 24,
      }}
    >
      <form
        onSubmit={handleLogin}
        style={{
          width: 460,
          maxWidth: "100%",
          background: "linear-gradient(180deg, rgba(14,32,66,0.95), rgba(7,22,48,0.95))",
          border: "1px solid rgba(110,150,255,0.12)",
          borderRadius: 24,
          padding: 28,
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 900, marginBottom: 8 }}>Co-Pilot Login</div>
        <div style={{ color: "#9db2d9", marginBottom: 22 }}>Sign in to Good2Go Roofing</div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 800 }}>Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)",
              color: "#eef4ff",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 800 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)",
              color: "#eef4ff",
              boxSizing: "border-box",
            }}
          />
        </div>

        <button
          type="submit"
          style={{
            width: "100%",
            padding: "14px 18px",
            borderRadius: 14,
            border: "1px solid rgba(78,146,255,0.9)",
            background: "linear-gradient(135deg, #2d6cff, #44b7ff)",
            color: "#fff",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Sign In
        </button>

        <div style={{ marginTop: 16, color: "#b8c9ea", fontWeight: 700 }}>{status}</div>
      </form>
    </div>
  )
}
