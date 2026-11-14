import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { login, verifyPashLocLogin, startPashLocEnrollment, approvePashLocEnrollment, confirmPashLocEnrollment } from "../lib/auth"
import type { PashLocEnrollment } from "../lib/auth"
import {
  getTenantSlug,
  setTenantSlug,
  tenantDisplayName,
} from "../lib/tenant"

export default function LoginPage() {
  const navigate = useNavigate()
  const [workspace, setWorkspace] = useState(() => {
    const queryTenant =
      new URLSearchParams(
        window.location.search,
      ).get("tenant")

    return queryTenant || getTenantSlug()
  })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [mfaChallenge, setMfaChallenge] = useState("")
  const [mfaEnrollmentRequired, setMfaEnrollmentRequired] = useState(false)
  const [mfaCode, setMfaCode] = useState("")
  const [enrollment, setEnrollment] = useState<PashLocEnrollment | null>(null)
  const [deviceCode, setDeviceCode] = useState("")
  const [deviceApproved, setDeviceApproved] = useState(false)
  const pashlocPhoneUrl = enrollment
    ? `https://pashloc-iv.vercel.app/?mode=enroll&issuer=Navigator&pairing=${encodeURIComponent(enrollment.pairing_ref)}`
    : ""


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError("")
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
      let enrollmentChallenge = ""
      if (result?.mfa_required && result.enrollment_required) {
        const session = await startPashLocEnrollment(tenantSlug,email.trim(),password)
        setEnrollment(session)
        enrollmentChallenge = session.challenge_id
      }
      if (result?.mfa_required) {
        setMfaChallenge(result.enrollment_required ? enrollmentChallenge : result.challenge_id)
        setMfaEnrollmentRequired(Boolean(result.enrollment_required))
        setPassword("")
        setStatus(result.enrollment_required ? "PashLoc enrollment required" : "Enter your PashLoc code")
        return
      }
      setStatus("Login successful")
      navigate("/")
    } catch (err: any) {
      setError(err?.message || "Login failed")
      setStatus("Login failed")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError("")
    try {
      await verifyPashLocLogin(mfaChallenge, mfaCode.trim())
      setMfaChallenge("")
      setMfaCode("")
      navigate("/")
    } catch (err: any) {
      setError(err?.message || "PashLoc verification failed")
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

        {mfaChallenge ? (
          <form onSubmit={handleMfaVerify} style={{display:"grid",gap:"14px",marginTop:"18px"}}>
            <h2 style={{margin:0}}>PashLoc security verification</h2>
            {mfaEnrollmentRequired ? (
              <div style={{display:"grid",gap:"12px"}}>
                <p>Connect your PashLoc iPhone account to Navigator. Your normal Navigator session remains locked until enrollment is complete.</p>
                {enrollment ? <>
                  <p>Pairing reference (expires {new Date(enrollment.expires_at).toLocaleTimeString()}):</p>
                  <code style={{overflowWrap:"anywhere",fontSize:"12px"}}>{enrollment.pairing_ref}</code>
                  <p>On your iPhone, open this PashLoc enrollment link. The link identifies the pending pairing; your Navigator password and security secret are never placed in it.</p>
                  <a href={pashlocPhoneUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" style={{color:"#a9d4ff",overflowWrap:"anywhere"}}>Open PashLoc enrollment</a>
                  <button type="button" style={{...buttonStyle,background:"#304a78"}} onClick={async()=>{
                    try{await navigator.clipboard.writeText(pashlocPhoneUrl);setStatus("PashLoc enrollment link copied. Open it on your iPhone.")}catch{setError("Unable to copy the link. Open the link directly instead.")}
                  }}>Copy iPhone enrollment link</button>
                  <p>Open PashLoc on your iPhone to claim this pairing. Enter the eight-digit number shown on the phone here.</p>
                  <label style={labelStyle}>Eight-digit device approval</label>
                  <input value={deviceCode} onChange={e=>setDeviceCode(e.target.value.replace(/\D/g,"").slice(0,8))} inputMode="numeric" maxLength={8} style={inputStyle}/>
                  <button type="button" style={buttonStyle} disabled={submitting || deviceCode.length!==8} onClick={async()=>{
                    setSubmitting(true);setError("");try{await approvePashLocEnrollment(enrollment,deviceCode);setDeviceApproved(true)}catch(err:any){setError(err.message)}finally{setSubmitting(false)}
                  }}>Approve this iPhone</button>
                  {deviceApproved ? <>
                    <label style={labelStyle}>First six-digit PashLoc code</label>
                    <input value={mfaCode} onChange={e=>setMfaCode(e.target.value.replace(/\D/g,"").slice(0,6))} inputMode="numeric" maxLength={6} style={inputStyle}/>
                    <button type="button" style={buttonStyle} disabled={submitting || mfaCode.length!==6} onClick={async()=>{
                      setSubmitting(true);setError("");try{await confirmPashLocEnrollment(enrollment,mfaCode);setEnrollment(null);setMfaChallenge("");setMfaCode("");setDeviceCode("");setDeviceApproved(false);setMfaEnrollmentRequired(false);setStatus("PashLoc enrolled. Sign in again with a fresh code.")}catch(err:any){setError(err.message)}finally{setSubmitting(false)}
                    }}>Complete PashLoc enrollment</button>
                  </> : null}
                </> : <p>Enrollment is unavailable. Please try signing in again.</p>}
              </div>
            ) : (
              <>
                <p>Open PashLoc on your iPhone and enter the current six-digit code. You do not need to scan another QR.</p>
                <label style={labelStyle} htmlFor="pashloc-code">Six-digit PashLoc code</label>
                <input id="pashloc-code" value={mfaCode} onChange={e=>setMfaCode(e.target.value.replace(/\D/g,"").slice(0,6))}
                  inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required style={inputStyle}/>
                <button type="submit" disabled={submitting || mfaCode.length!==6} style={buttonStyle}>Verify and open Navigator</button>
              </>
            )}
            <button type="button" style={{...buttonStyle,background:"#304a78"}} onClick={()=>{setMfaChallenge("");setMfaCode("");setError("");setStatus("");setMfaEnrollmentRequired(false);setEnrollment(null);setDeviceApproved(false);setDeviceCode("")}}>Back to sign in</button>
            {error ? <div style={errorStyle}>{error}</div> : null}
          </form>
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
