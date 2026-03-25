import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import UsersPage from "./pages/Users"
import JobAdminPage from "./pages/JobAdmin"
import JobDetailPage from "./pages/JobDetail"
import DashboardPage from "./pages/Dashboard"
import DeveloperSettingsPage from "./pages/DeveloperSettings"
import LoginPage from "./pages/Login"
import AcceptInvitePage from "./pages/AcceptInvite"
import DocumentPipelinePage from "./pages/DocumentPipeline"
import ProtectedRoute from "./components/ProtectedRoute"
import { clearToken, isLoggedIn } from "./lib/auth"
import SignDocument from "./pages/SignDocument"

function HeaderBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const authed = isLoggedIn()

  function handleLogout() {
    clearToken()
    navigate("/login")
  }

  return (
    <div
      style={{
        maxWidth: "1200px",
        margin: "0 auto 24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "12px",
        flexWrap: "wrap",
      }}
    >
      <div style={{ fontSize: "14px", opacity: 0.85 }}>Contractor Autopilot</div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
        {authed ? (
          <>
            <Link to="/" style={location.pathname === "/" ? activeLinkStyle : mutedLinkStyle}>
              Command Center
            </Link>

            <Link
              to="/job-admin"
              style={location.pathname === "/job-admin" ? activeLinkStyle : mutedLinkStyle}
            >
              Jobs
            </Link>

            <Link
              to="/developer-settings"
              style={location.pathname === "/developer-settings" ? activeLinkStyle : mutedLinkStyle}
            >
              Developer Settings
            </Link>

            <Link
              to="/document-pipeline"
              style={location.pathname === "/document-pipeline" ? activeLinkStyle : mutedLinkStyle}
            >
              Documents
            </Link>

            <Link
              to="/users"
              style={location.pathname === "/users" ? activeLinkStyle : mutedLinkStyle}
            >
              Users
            </Link>

            <button onClick={handleLogout} style={logoutButtonStyle}>
              Logout
            </button>
          </>
        ) : (
          <Link to="/login" style={activeLinkStyle}>
            Login
          </Link>
        )}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <div style={pageStyle}>
              <HeaderBar />
              <DashboardPage />
            </div>
          </ProtectedRoute>
        }
      />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />

      <Route
        path="/users"
        element={
          <ProtectedRoute>
            <div style={pageStyle}>
              <HeaderBar />
              <UsersPage />
            </div>
          </ProtectedRoute>
        }
      />

      <Route
        path="/job-admin"
        element={
          <ProtectedRoute>
            <div style={pageStyle}>
              <HeaderBar />
              <JobAdminPage />
            </div>
          </ProtectedRoute>
        }
      />

      <Route
        path="/job/:id"
        element={
          <ProtectedRoute>
            <div style={pageStyle}>
              <HeaderBar />
              <JobDetailPage />
            </div>
          </ProtectedRoute>
        }
      />

      <Route
        path="/developer-settings"
        element={
          <ProtectedRoute>
            <div style={pageStyle}>
              <HeaderBar />
              <DeveloperSettingsPage />
            </div>
          </ProtectedRoute>
        }
      />

      <Route
        path="/document-pipeline"
        element={
          <ProtectedRoute>
            <div style={pageStyle}>
              <HeaderBar />
              <DocumentPipelinePage />
            </div>
          </ProtectedRoute>
        }
      />

      <Route path="/sign/:id" element={<SignDocument />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background:
    "linear-gradient(135deg, rgba(0,25,70,1) 0%, rgba(2,18,47,1) 45%, rgba(8,42,102,1) 100%)",
  color: "#e8eefc",
  padding: "28px",
}

const activeLinkStyle: React.CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  padding: "10px 16px",
  borderRadius: "14px",
  display: "inline-block",
  border: "none",
}

const mutedLinkStyle: React.CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "10px 16px",
  borderRadius: "14px",
  display: "inline-block",
}

const logoutButtonStyle: React.CSSProperties = {
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "10px 16px",
  borderRadius: "14px",
  cursor: "pointer",
}
