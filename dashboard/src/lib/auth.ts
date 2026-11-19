import {
  getTenantSlug,
  setTenantSlug,
  tenantLoginPath,
} from "./tenant"

const API_BASE = import.meta.env.VITE_API_BASE
const TOKEN_KEY = "contractor_autopilot_token"

export type AuthUser = {
  id: number
  tenant_id: number
  email: string
  full_name: string
  role: string
  is_active: boolean
  preferred_language?: "en" | "es"
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ""
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
  window.dispatchEvent(new Event("contractor-navigator-auth-change"))
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  window.dispatchEvent(new Event("contractor-navigator-auth-change"))
}

export function isLoggedIn() {
  return !!getToken()
}

export type SignedLogin = {
  mfa_required: true
  reference: string
  browserProof: string
  phoneUrl: string
  expiresAt: string
  tenant: string
}
export type RestrictedEnrollment = {
  mfa_required: true
  enrollment_required: true
  enrollmentToken: string
}
export type EnrollmentGrant = { enrollmentLink: string; oneTimeGrant: string; expiresAt: string }

export async function requestEnrollment(enrollmentToken: string, signal: AbortSignal): Promise<EnrollmentGrant> {
  const response = await fetch(`${API_BASE}/auth/restricted-enrollment/signed`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enrollmentToken }), credentials: "omit", cache: "no-store",
    referrerPolicy: "no-referrer", signal,
  })
  const result = await response.json()
  if (!response.ok || result?.ok !== true || !opaque(result.oneTimeGrant) ||
      typeof result.enrollmentLink !== "string" || typeof result.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(result.expiresAt))) throw new PashLocLoginError("enrollment")
  const link = new URL(result.enrollmentLink)
  if (!/^#navigator-register=[A-Za-z0-9_-]{43}$/.test(link.hash) ||
      link.protocol !== "https:" || link.origin !== import.meta.env.VITE_NAVIGATOR_MFA_PHONE_ORIGIN ||
      link.username || link.password || link.pathname !== "/" || link.search)
    throw new PashLocLoginError("enrollment")
  return { enrollmentLink: link.href, oneTimeGrant: result.oneTimeGrant, expiresAt: result.expiresAt }
}

export class PashLocLoginError extends Error {
  readonly reason: "enrollment" | "unavailable"
  constructor(reason: "enrollment" | "unavailable") { super(reason); this.reason = reason }
}
const opaque = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
function validPhoneUrl(value: unknown, reference: string) {
  try {
    const url = new URL(String(value))
    const phoneOrigin = import.meta.env.VITE_NAVIGATOR_MFA_PHONE_ORIGIN
    return url.protocol === "https:" && url.origin === phoneOrigin && !url.username && !url.password &&
      url.pathname === "/" && !url.search && url.hash === "#navigator-sign=" + reference
  } catch { return false }
}

export async function login(email: string, password: string): Promise<SignedLogin | RestrictedEnrollment | { mfa_required: false }> {
  const tenant = getTenantSlug()
  const res = await fetch(`${API_BASE}${tenantLoginPath(tenant)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
    }),
  })

  const json = await res.json()

  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || "Login failed")
  }

  if (json?.mfa_required === true) {
    // Never retain a previous session while an MFA challenge is pending.
    clearToken()
    if (json.enrollment_required === true) {
      if (json.token || typeof json.enrollmentToken !== "string" || !json.enrollmentToken)
        throw new PashLocLoginError("enrollment")
      return { mfa_required: true, enrollment_required: true, enrollmentToken: json.enrollmentToken }
    }
    if (json.token || json.method !== "pashloc_signed" || !opaque(json.reference) || !opaque(json.browserProof) ||
        !validPhoneUrl(json.phoneUrl, json.reference) || !Number.isFinite(Date.parse(json.expiresAt))) {
      throw new PashLocLoginError("unavailable")
    }
    return {
      mfa_required: true, reference: json.reference, browserProof: json.browserProof,
      phoneUrl: json.phoneUrl, expiresAt: json.expiresAt, tenant,
    } satisfies SignedLogin
  }
  if (typeof json?.token !== "string" || !json.token) {
    throw new Error("Login failed")
  }

  setTenantSlug(tenant)
  setToken(json.token)
  return { mfa_required: false }
}

export async function pollSignedLogin(request: SignedLogin, signal: AbortSignal): Promise<
  { state: "pending" | "denied" | "expired" } | { state: "approved"; token: string }
> {
  const response = await fetch(`${API_BASE}/auth/mfa/signed/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference: request.reference, browserProof: request.browserProof }),
    credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal,
  })
  if (response.status === 410) return { state: "expired" }
  const result = await response.json()
  if (!response.ok || result?.ok !== true) throw new PashLocLoginError("unavailable")
  if (response.status === 202 && result.state === "pending" && !result.token) return { state: "pending" }
  if (result.state === "denied" && !result.token) return { state: "denied" }
  if (result.state === "approved" && typeof result.token === "string" && result.token &&
      result.tenantSlug === request.tenant)
    return { state: "approved", token: result.token }
  throw new PashLocLoginError("unavailable")
}

export async function acceptInvite(inviteToken: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/accept-invite/${inviteToken}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      password,
    }),
  })

  const json = await res.json()

  if (!res.ok || json?.ok !== true || (!json.token && json?.mfa_required !== true)) {
    throw new Error(json?.error || "Accept invitation failed")
  }

  if (json.mfa_required === true) clearToken()
  else setToken(json.token)
  return json
}

export async function saveMyPreferredLanguage(
  language: "en" | "es"
): Promise<AuthUser> {
  const token = getToken()

  if (!token) {
    throw new Error("Not signed in")
  }

  const res = await fetch(`${API_BASE}/auth/me/language`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      preferred_language: language,
    }),
  })

  const json = await res.json()

  if (!res.ok || !json?.ok) {
    throw new Error(
      json?.error || "Unable to save language preference"
    )
  }

  return json.user
}

export async function getMe(): Promise<AuthUser | null> {
  const token = getToken()
  if (!token) return null

  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  const json = await res.json()

  if (!res.ok) {
    clearToken()
    return null
  }

  return json.user || null
}

export async function fetchInvite(inviteToken: string) {
  const res = await fetch(`${API_BASE}/auth/invite/${inviteToken}`)
  const json = await res.json()

  if (!res.ok) {
    throw new Error(json?.error || "Invite not found")
  }

  return json.invite
}
