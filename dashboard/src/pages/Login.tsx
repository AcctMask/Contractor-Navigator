import { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { getMe, login, PashLocLoginError, pollSignedLogin, requestEnrollment, setToken, type EnrollmentGrant, type SignedLogin } from "../lib/auth"
import { useLanguage } from "../context/LanguageContext"
import type { WorkforceTranslationKey } from "../lib/workforceLanguage"
import {
  getTenantSlug,
  setTenantSlug,
  tenantDisplayName,
} from "../lib/tenant"

export default function LoginPage() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const { t } = useLanguage()
  const [workspace, setWorkspace] = useState(() => {
    const queryTenant =
      new URLSearchParams(
        window.location.search,
      ).get("tenant")

    return queryTenant || getTenantSlug()
  })
  const [email, setEmail] = useState(() => typeof state?.enrollmentEmail === "string" ? state.enrollmentEmail : "")
  const [password, setPassword] = useState("")
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [enrollment, setEnrollment] = useState<EnrollmentGrant | null>(null)
  const [mfaChallenge, setMfaChallenge] = useState<SignedLogin | null>(null)
  const [mfaError, setMfaError] = useState<WorkforceTranslationKey | null>(null)
  const [qrFailed, setQrFailed] = useState(false)
  const qrContainer = useRef<HTMLDivElement>(null)
  const pendingPoll = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!mfaChallenge) return
    const controller = new AbortController()
    pendingPoll.current = controller
    let timer: ReturnType<typeof setTimeout>
    const fail = (key: WorkforceTranslationKey) => {
      setMfaChallenge(null)
      setMfaError(key)
    }
    const poll = async () => {
      if (controller.signal.aborted) return
      try {
        // The API clock is authoritative, including for approval expiry.
        const result = await pollSignedLogin(mfaChallenge, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]))
        if (controller.signal.aborted) return
        if (result.state === "approved") {
          setTenantSlug(mfaChallenge.tenant)
          setToken(result.token)
          const user = await getMe()
          if (!controller.signal.aborted) navigate(user?.role === "crew" ? "/crew" : "/")
        } else if (result.state === "pending") timer = setTimeout(poll, 1500)
        else fail(result.state === "denied" ? "pashLocDenied" : "pashLocExpired")
      } catch {
        if (!controller.signal.aborted) fail("pashLocUnavailable")
      }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [mfaChallenge, navigate])

  useEffect(() => {
    const phoneUrl = mfaChallenge?.phoneUrl ?? enrollment?.enrollmentLink
    if (!phoneUrl || !qrContainer.current) return
    const container = qrContainer.current
    const browser = window as Window & { QRCode?: new (
      node: HTMLElement, options: { text: string; width: number; height: number; correctLevel: number },
    ) => unknown }
    const draw = () => {
      try {
        if (!browser.QRCode) throw new Error("QR renderer unavailable")
        container.replaceChildren()
        new browser.QRCode(container, { text: phoneUrl, width: 224, height: 224, correctLevel: 1 })
      } catch { setQrFailed(true) }
    }
    if (browser.QRCode) { draw(); return }
    const script = document.createElement("script")
    script.src = "/vendor/qrcode.js"
    script.onload = draw
    script.onerror = () => setQrFailed(true)
    document.head.append(script)
    return () => { script.onload = script.onerror = null; script.remove() }
  }, [mfaChallenge, enrollment])

  useEffect(() => {
    if (!enrollment) return
    const timer = setTimeout(() => {
      setEnrollment(null)
      setMfaError("pashLocEnrollmentExpired")
    }, Math.max(0, Math.min(300000, Date.parse(enrollment.expiresAt) - Date.now())))
    return () => clearTimeout(timer)
  }, [enrollment])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError("")
    setMfaError(null)
    setStatus("Logging in...")

    try {
      const tenantSlug =
        setTenantSlug(workspace)

      setStatus(
        `Logging into ${tenantDisplayName(
          tenantSlug,
        )}...`,
      )

      const result = await login(email.trim(), password)
      if (result?.mfa_required === true) {
        setQrFailed(false)
        setPassword("")
        if ("enrollmentToken" in result) {
          setEnrollment(await requestEnrollment(result.enrollmentToken, AbortSignal.timeout(10000)))
        } else {
          setMfaChallenge(result)
        }
        setStatus("")
        return
      }
      setStatus("Login successful")
      const user = await getMe()
      navigate(user?.role === "crew" ? "/crew" : "/")
    } catch (err: any) {
      if (err instanceof PashLocLoginError) {
        setPassword("")
        setMfaError(err.reason === "enrollment" ? "pashLocEnrollment" : "pashLocUnavailable")
        setStatus("")
      } else {
        setError(err?.message || "Login failed")
        setStatus("Login failed")
      }
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

        {mfaError && <div role="alert" style={errorStyle}>{t(mfaError)}</div>}
        {enrollment ? (
          <section style={{ display: "grid", gap: "14px", marginTop: "18px" }}>
            <h2>{t("pashLocRegisterTitle")}</h2>
            <p>{t("pashLocRegisterInstructions")}</p>
            <div ref={qrContainer} role="img" aria-label={t("pashLocRegisterTitle")}
              style={{ width: 224, minHeight: 224, padding: 12, background: "white", boxSizing: "content-box" }} />
            {qrFailed && <p role="status">{t("pashLocRegisterQrUnavailable")}</p>}
            <a style={{ color: "#a9d4ff" }} href={enrollment.enrollmentLink} target="_blank" rel="noopener noreferrer">
              {t("pashLocRegisterOpen")}
            </a>
            <div>{t("pashLocRegisterCode")} <code>{enrollment.oneTimeGrant}</code></div>
            <p>{t("pashLocRegisterNext")}</p>
            <button type="button" onClick={() => setEnrollment(null)} style={buttonStyle}>
              {t("pashLocRegisterContinue")}
            </button>
          </section>
        ) : mfaChallenge ? (
          <section style={{ display: "grid", gap: "14px", marginTop: "18px" }}>
            <h2>{t("pashLocTitle")}</h2>
            <p>{t("pashLocScan")}</p>
            <div ref={qrContainer} role="img" aria-label={t("pashLocTitle")}
              style={{ width: 224, minHeight: 224, padding: 12, background: "white", boxSizing: "content-box" }} />
            {qrFailed && <p role="status">{t("pashLocQrUnavailable")}</p>}
            <a style={{ color: "#a9d4ff" }} href={mfaChallenge.phoneUrl} target="_blank" rel="noopener noreferrer">
              {t("pashLocOpen")}
            </a>
            <p role="status">{t("pashLocWaiting")} · {mfaChallenge.reference.slice(-6).toUpperCase()}</p>
            <button type="button" onClick={() => { pendingPoll.current?.abort(); setMfaChallenge(null) }} style={buttonStyle}>
              {t("pashLocBack")}
            </button>
          </section>
        ) : <form onSubmit={handleSubmit} style={{ display: "grid", gap: "14px", marginTop: "18px" }}>
          <div>
            <label style={labelStyle}>
              Company Workspace
            </label>

            <input
              value={workspace}
              onChange={(e) =>
                setWorkspace(e.target.value)
              }
              placeholder="company-workspace"
              autoComplete="organization"
              style={inputStyle}
            />

            <div
              style={{
                marginTop: "7px",
                fontSize: "13px",
                opacity: 0.7,
              }}
            >
              {tenantDisplayName(workspace)}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourcompany.com"
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
        </form>}
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
