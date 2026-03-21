import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

const API = "http://localhost:8787"

export default function AcceptInvitePage() {
  const { token = "" } = useParams()
  const navigate = useNavigate()
  const [invite, setInvite] = useState<any>(null)
  const [password, setPassword] = useState("")
  const [status, setStatus] = useState("Loading invitation...")

  useEffect(() => {
    fetch(`${API}/auth/invite/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          setStatus(data.error || "Invitation not found")
          return
        }
        setInvite(data.invite)
        setStatus("Invitation loaded")
      })
      .catch(() => setStatus("Failed to load invitation"))
  }, [token])

  async function acceptInvite(e: React.FormEvent) {
    e.preventDefault()
    setStatus("Creating account...")

    const res = await fetch(`${API}/auth/accept-invite/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    })

    const data = await res.json()

    if (!data.ok) {
      setStatus(data.error || "Failed to accept invite")
      return
    }

    localStorage.setItem("copilot_token", data.token)
    localStorage.setItem("copilot_user", JSON.stringify(data.user))
    setStatus("Account created")
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
        onSubmit={acceptInvite}
        style={{
          width: 520,
          maxWidth: "100%",
          background: "linear-gradient(180deg, rgba(14,32,66,0.95), rgba(7,22,48,0.95))",
          border: "1px solid rgba(110,150,255,0.12)",
          borderRadius: 24,
          padding: 28,
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 900, marginBottom: 8 }}>Accept Invitation</div>

        {invite ? (
          <>
            <div style={{ color: "#9db2d9", marginBottom: 10 }}>
              {invite.full_name} • {invite.email}
            </div>
            <div style={{ color: "#9db2d9", marginBottom: 22 }}>
              Role: {invite.role} • Tenant: {invite.tenant_slug}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 800 }}>
                Create Password
              </label>
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
              Create Account
            </button>
          </>
        ) : (
          <div style={{ color: "#b8c9ea" }}>No invitation details available yet.</div>
        )}

        <div style={{ marginTop: 16, color: "#b8c9ea", fontWeight: 700 }}>{status}</div>
      </form>
    </div>
  )
}
