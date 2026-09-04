import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import {
  useEffect,
  useState,
} from "react"
import type {
  CSSProperties,
  ReactNode,
} from "react"
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
import TermsPage from "./pages/Terms"
import CommercialPipelinePage from "./pages/CommercialPipeline"
import StormPage from "./pages/Storm"
import RoofIntelligencePage from "./pages/RoofIntelligence"
import SocialPage from "./pages/Social"
import EstimatorPage from "./pages/Estimator"
import TimelinePage from "./pages/Timeline"
import ProtectedRoute from "./components/ProtectedRoute"
import {
  clearToken,
  getToken,
  isLoggedIn,
} from "./lib/auth"
import { useTenant } from "./context/TenantContext"
import { useCompanyDna } from "./context/CompanyDnaContext"
import SignDocument from "./pages/SignDocument"
import FieldPortalPage from "./pages/FieldPortal"
import { openFinancialOperations } from "./lib/financialOperations"

function HeaderBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const authed = isLoggedIn()
  const {
    tenantSlug,
    tenantName,
    changeTenant,
  } = useTenant()

  const [currentUser, setCurrentUser] =
    useState<any>(null)

  const [platformTenants, setPlatformTenants] =
    useState<any[]>([])

  const [tenantDirectoryError, setTenantDirectoryError] =
    useState("")

  const API_BASE =
    import.meta.env.VITE_API_BASE

  useEffect(() => {
    if (!authed) {
      setCurrentUser(null)
      setPlatformTenants([])
      return
    }

    const token = getToken()

    if (!token) {
      return
    }

    void fetch(
      `${API_BASE}/auth/me`,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,
        },
      },
    )
      .then(async (response) => {
        const data = await response.json()

        if (!response.ok || !data?.ok) {
          throw new Error(
            data?.error ||
              "Current user could not be loaded.",
          )
        }

        setCurrentUser(data.user)

        if (
          data.user?.role !==
          "platform_owner"
        ) {
          setPlatformTenants([])
          return null
        }

        return fetch(
          `${API_BASE}/platform/tenants`,
          {
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          },
        )
      })
      .then(async (response) => {
        if (!response) {
          return
        }

        const data = await response.json()

        if (!response.ok || !data?.ok) {
          throw new Error(
            data?.error ||
              "Tenant directory could not be loaded.",
          )
        }

        setPlatformTenants(
          Array.isArray(data.tenants)
            ? data.tenants
            : [],
        )

        setTenantDirectoryError("")
      })
      .catch((error) => {
        setTenantDirectoryError(
          error?.message ||
            "Tenant directory could not be loaded.",
        )
      })
  }, [authed])

  function handleTenantChange(
    nextTenantSlug: string,
  ) {
    if (
      !nextTenantSlug ||
      nextTenantSlug === tenantSlug
    ) {
      return
    }

    changeTenant(nextTenantSlug)
    navigate("/")
    window.location.reload()
  }
  const {
    branding,
    workspace,
  } = useCompanyDna()

  function navigationIsActive(
    route: string,
  ) {
    if (route === "/") {
      return location.pathname === "/"
    }

    return (
      location.pathname === route ||
      location.pathname.startsWith(
        `${route}/`,
      )
    )
  }

  function handleLogout() {
    clearToken()
    navigate("/login")
  }

  return (
    <div style={headerWrap}>
      <div>
        <div
          style={{
            fontSize: "14px",
            fontWeight: 800,
          }}
        >
          {branding.business_display_name ||
            tenantName}
        </div>

        <div
          style={{
            marginTop: "3px",
            fontSize: "11px",
            opacity: 0.62,
          }}
        >
          Contractor Navigator
        </div>

        {currentUser?.role ===
          "platform_owner" ? (
          <div
            style={{
              marginTop: "8px",
              display: "grid",
              gap: "5px",
            }}
          >
            <label
              htmlFor="platform-tenant-switcher"
              style={{
                fontSize: "10px",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                opacity: 0.62,
              }}
            >
              Client workspace
            </label>

            <select
              id="platform-tenant-switcher"
              value={tenantSlug}
              onChange={(event) =>
                handleTenantChange(
                  event.target.value,
                )
              }
              style={tenantSwitcherStyle}
            >
              {platformTenants.map(
                (tenant) => (
                  <option
                    key={tenant.slug}
                    value={tenant.slug}
                  >
                    {tenant.display_name ||
                      tenant.name}
                  </option>
                ),
              )}
            </select>

            {tenantDirectoryError ? (
              <span
                style={{
                  color: "#fecaca",
                  fontSize: "10px",
                }}
              >
                {tenantDirectoryError}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={headerLinks}>
        {authed ? (
          <>
            {workspace.navigation.map(
              (item) => (
                <div
                  key={item.id}
                  style={{
                    display: "contents",
                  }}
                >
                  <Link
                    to={item.route}
                    style={
                      navigationIsActive(
                        item.route,
                      )
                        ? activeLinkStyle
                        : mutedLinkStyle
                    }
                  >
                    {item.label}
                  </Link>
                  {item.route === "/" ? (
                    <a
                      href="#"
                      onClick={(event) => {
                        event.preventDefault()
                        void openFinancialOperations()
                      }}
                      style={mutedLinkStyle}
                    >
                      Financial Operations
                    </a>
                  ) : null}
                </div>
              ),
            )}

            <button
              onClick={handleLogout}
              style={logoutButtonStyle}
            >
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

const tenantSwitcherStyle: CSSProperties = {
  minWidth: "190px",
  maxWidth: "260px",
  padding: "7px 9px",
  color: "#f8fafc",
  background: "rgba(15, 23, 42, 0.92)",
  border:
    "1px solid rgba(148, 163, 184, 0.32)",
  borderRadius: "9px",
  fontSize: "12px",
  fontWeight: 700,
}

const CRM_ROLES = ["platform_owner", "tenant_admin", "admin", "manager", "sales", "staff"]

function ProtectedPage({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute roles={CRM_ROLES} unauthorizedTo="/field">
      <div style={pageStyle}>
        <HeaderBar />
        {children}
      </div>
    </ProtectedRoute>
  )
}

function JobDetailProtectedPage({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute
      roles={[...CRM_ROLES, "subcontractor"]}
      unauthorizedTo="/"
    >
      <div style={pageStyle}>
        <HeaderBar />
        {children}
      </div>
    </ProtectedRoute>
  )
}

function FieldProtectedPage({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute roles={["subcontractor"]} unauthorizedTo="/">
      {children}
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
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/job-admin" element={<ProtectedPage><JobAdminPage /></ProtectedPage>} />
      <Route
        path="/job/:id"
        element={
          <JobDetailProtectedPage>
            <JobDetailPage />
          </JobDetailProtectedPage>
        }
      />
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
      <Route path="/field" element={<FieldProtectedPage><FieldPortalPage /></FieldProtectedPage>} />
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
