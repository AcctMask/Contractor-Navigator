import type { CSSProperties } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import UsersPage from "./pages/Users"

function HomePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(135deg, rgba(0,25,70,1) 0%, rgba(2,18,47,1) 45%, rgba(8,42,102,1) 100%)",
        color: "#e8eefc",
        padding: "28px",
      }}
    >
      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
          background: "rgba(8, 22, 59, 0.92)",
          border: "1px solid rgba(81, 133, 255, 0.25)",
          borderRadius: "24px",
          padding: "24px",
        }}
      >
        <div style={{ fontSize: "15px", opacity: 0.8, marginBottom: "8px" }}>
          Co-Pilot
        </div>
        <h1 style={{ margin: 0, fontSize: "44px", lineHeight: 1.08 }}>
          Dashboard
        </h1>
        <p style={{ fontSize: "18px", opacity: 0.88 }}>
          Main dashboard route is alive. Users & Invitations page is wired below.
        </p>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "18px" }}>
          <a href="/users" style={linkStyle}>
            Open Users
          </a>
          <a href="/accept-invite/test" style={linkStyleMuted}>
            Accept Invite Test Route
          </a>
        </div>
      </div>
    </div>
  )
}

function AcceptInvitePlaceholder() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(135deg, rgba(0,25,70,1) 0%, rgba(2,18,47,1) 45%, rgba(8,42,102,1) 100%)",
        color: "#e8eefc",
        padding: "28px",
      }}
    >
      <div
        style={{
          maxWidth: "720px",
          margin: "80px auto 0",
          background: "rgba(8, 22, 59, 0.92)",
          border: "1px solid rgba(81, 133, 255, 0.25)",
          borderRadius: "24px",
          padding: "24px",
        }}
      >
        <h1 style={{ marginTop: 0 }}>Accept Invitation</h1>
        <p>This route exists. We can wire the full accept-invite UI next.</p>
        <a href="/" style={linkStyle}>
          Back to Dashboard
        </a>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/users" element={<UsersPage />} />
      <Route path="/accept-invite/:token" element={<AcceptInvitePlaceholder />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

const linkStyle: CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  padding: "10px 16px",
  borderRadius: "14px",
  display: "inline-block",
}

const linkStyleMuted: CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "10px 16px",
  borderRadius: "14px",
  display: "inline-block",
}
