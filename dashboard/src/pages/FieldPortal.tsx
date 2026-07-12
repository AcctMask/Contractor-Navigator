import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { clearToken, getMe, type AuthUser } from "../lib/auth"

export default function FieldPortalPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    void getMe().then(setUser)
  }, [])

  function handleLogout() {
    clearToken()
    navigate("/login")
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(135deg, rgba(0,25,70,1) 0%, rgba(2,18,47,1) 45%, rgba(8,42,102,1) 100%)",
        color: "#e8eefc",
        padding: "20px",
      }}
    >
      <div style={{ maxWidth: "760px", margin: "0 auto", display: "grid", gap: "18px" }}>
        <div
          style={{
            background: "rgba(8, 22, 59, 0.94)",
            border: "1px solid rgba(81, 133, 255, 0.28)",
            borderRadius: "22px",
            padding: "22px",
          }}
        >
          <div style={{ fontSize: "14px", opacity: 0.78 }}>Good2Go Roofing</div>
          <h1 style={{ margin: "8px 0 0", fontSize: "36px" }}>My Assigned Jobs</h1>
          <p style={{ marginBottom: 0, opacity: 0.86 }}>
            Welcome{user?.full_name ? `, ${user.full_name}` : ""}. Assigned field work will appear here.
          </p>
        </div>

        <div
          style={{
            background: "rgba(8, 22, 59, 0.92)",
            border: "1px solid rgba(81, 133, 255, 0.24)",
            borderRadius: "22px",
            padding: "22px",
          }}
        >
          <h2 style={{ marginTop: 0 }}>No assigned jobs yet</h2>
          <p style={{ marginBottom: 0, lineHeight: 1.55, opacity: 0.84 }}>
            When the office assigns a job to you, it will appear here with the address,
            assignment notes, photo upload, document upload, and field-note tools.
          </p>
        </div>

        <button
          onClick={handleLogout}
          style={{
            justifySelf: "start",
            color: "#fff",
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.14)",
            padding: "11px 17px",
            borderRadius: "14px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Logout
        </button>
      </div>
    </div>
  )
}
