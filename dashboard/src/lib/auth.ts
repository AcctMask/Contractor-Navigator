const API_BASE = "http://localhost:8787"
const TOKEN_KEY = "contractor_autopilot_token"

export type AuthUser = {
  id: number
  tenant_id: number
  email: string
  full_name: string
  role: string
  is_active: boolean
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ""
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function isLoggedIn() {
  return !!getToken()
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/g2g-roofing/login`, {
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

  if (!res.ok || !json?.token) {
    throw new Error(json?.error || "Login failed")
  }

  setToken(json.token)
  return json
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

  if (!res.ok || !json?.token) {
    throw new Error(json?.error || "Accept invitation failed")
  }

  setToken(json.token)
  return json
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
