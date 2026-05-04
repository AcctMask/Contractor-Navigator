import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import type { CSSProperties, ReactNode } from "react"
import UsersPage from "./pages/Users"
import JobAdminPage from "./pages/JobAdmin"
import JobDetailPage from "./pages/JobDetail"
import DashboardPage from "./pages/Dashboard"
import DeveloperSettingsPage from "./pages/DeveloperSettings"
import LoginPage from "./pages/Login"
import AcceptInvitePage from "./pages/AcceptInvite"
import DocumentPipelinePage from "./pages/DocumentPipeline"
import CalendarPage from "./pages/Calendar"
import ReportsPage from "./pages/Reports"
import CommercialPipelinePage from "./pages/CommercialPipeline"
import StormPage from "./pages/Storm"
import RoofIntelligencePage from "./pages/RoofIntelligence"
import SocialPage from "./pages/Social"
import EstimatorPage from "./pages/Estimator"
import TimelinePage from "./pages/Timeline"
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
    <div style={headerWrap}>
      <div style={{ fontSize: "14px", opacity: 0.85 }}>Actual Assistant</div>

      <div style={headerLinks}>
        {authed ? (
          <>
            <Link to="/" style={location.pathname === "/" ? activeLinkStyle : mutedLinkStyle}>
              Command Center
            </Link>

            <Link to="/job-admin" style={location.pathname === "/job-admin" ? activeLinkStyle : mutedLinkStyle}>
              Jobs
            </Link>

            <Link to="/calendar" style={location.pathname === "/calendar" ? activeLinkStyle : mutedLinkStyle}>
              Calendar
            </Link>

            <Link to="/developer-settings" style={location.pathname === "/developer-settings" ? activeLinkStyle : mutedLinkStyle}>
              Developer Settings
            </Link>

            <Link to="/document-pipeline" style={location.pathname === "/document-pipeline" ? activeLinkStyle : mutedLinkStyle}>
              Documents
            </Link>

            <Link to="/users" style={location.pathname === "/users" ? activeLinkStyle : mutedLinkStyle}>
              Users
            </Link>

            <Link to="/reports" style={location.pathname === "/reports" ? activeLinkStyle : mutedLinkStyle}>
              Reports
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

function ProtectedPage({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <div style={pageStyle}>
        <HeaderBar />
        {children}
      </div>
    </ProtectedRoute>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ProtectedPage><DashboardPage /></ProtectedPage>} />
      <Route path="/commercial" element={<ProtectedPage><CommercialPipelinePage /></ProtectedPage>} />
      <Route path="/users" element={<ProtectedPage><UsersPage /></ProtectedPage>} />
      <Route path="/reports" element={<ProtectedPage><ReportsPage /></ProtectedPage>} />
      <Route path="/job-admin" element={<ProtectedPage><JobAdminPage /></ProtectedPage>} />
      <Route path="/job/:id" element={<ProtectedPage><JobDetailPage /></ProtectedPage>} />
      <Route path="/calendar" element={<ProtectedPage><CalendarPage /></ProtectedPage>} />
      <Route path="/developer-settings" element={<ProtectedPage><DeveloperSettingsPage /></ProtectedPage>} />
      <Route path="/document-pipeline" element={<ProtectedPage><DocumentPipelinePage /></ProtectedPage>} />
      <Route path="/storm" element={<ProtectedPage><StormPage /></ProtectedPage>} />
      <Route path="/roof-intelligence" element={<ProtectedPage><RoofIntelligencePage /></ProtectedPage>} />
      <Route path="/social" element={<ProtectedPage><SocialPage /></ProtectedPage>} />
      <Route path="/estimator" element={<ProtectedPage><EstimatorPage /></ProtectedPage>} />
      <Route path="/timeline" element={<ProtectedPage><TimelinePage /></ProtectedPage>} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
      <Route path="/sign/:id" element={<SignDocument />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

const headerWrap: CSSProperties = {
  maxWidth: "1200px",
  margin: "0 auto 24px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
}

const headerLinks: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  alignItems: "center",
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background:
    "linear-gradient(135deg, rgba(0,25,70,1) 0%, rgba(2,18,47,1) 45%, rgba(8,42,102,1) 100%)",
  color: "#e8eefc",
  padding: "28px",
}

const activeLinkStyle: CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  padding: "10px 16px",
  borderRadius: "14px",
  display: "inline-block",
  border: "none",
}

const mutedLinkStyle: CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "10px 16px",
  borderRadius: "14px",
  display: "inline-block",
}

const logoutButtonStyle: CSSProperties = {
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "10px 16px",
  borderRadius: "14px",
  cursor: "pointer",
}
