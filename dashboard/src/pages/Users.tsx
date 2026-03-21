import { useEffect, useMemo, useState } from "react"

const API_BASE = "http://localhost:8787"
const TENANT_SLUG = "g2g-roofing"

type UserRow = {
  id?: string | number | null
  email: string
  full_name?: string | null
  role: string
  is_active?: boolean
  created_at?: string
  updated_at?: string
}

type InvitationRow = {
  id?: string | number | null
  email: string
  full_name?: string | null
  role: string
  invite_token?: string | null
  accepted_at?: string | null
  expires_at?: string | null
  created_at?: string
}

function formatDate(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function getUserKey(user: UserRow, index: number) {
  return String(user.id ?? user.email ?? `user-${index}`)
}

function getInvitationKey(invite: InvitationRow, index: number) {
  return String(invite.id ?? invite.invite_token ?? invite.email ?? `invite-${index}`)
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [invitations, setInvitations] = useState<InvitationRow[]>([])
  const [email, setEmail] = useState("")
  const [fullName, setFullName] = useState("")
  const [role, setRole] = useState("admin")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState("Loading users and invitations...")
  const [error, setError] = useState("")

  const invitePreviewUrl = useMemo(() => {
    const latest = invitations.find((item) => !item.accepted_at && item.invite_token)
    if (!latest?.invite_token) return ""
    return `http://localhost:5173/accept-invite/${latest.invite_token}`
  }, [invitations])

  async function loadAll() {
    setLoading(true)
    setError("")
    setStatus("Loading users and invitations...")

    try {
      const [usersRes, invitesRes] = await Promise.all([
        fetch(`${API_BASE}/auth/${TENANT_SLUG}/users`),
        fetch(`${API_BASE}/auth/${TENANT_SLUG}/invitations`),
      ])

      const usersJson = await usersRes.json()
      const invitesJson = await invitesRes.json()

      setUsers(Array.isArray(usersJson.users) ? usersJson.users : [])
      setInvitations(Array.isArray(invitesJson.invitations) ? invitesJson.invitations : [])
      setStatus("Loaded")
    } catch (err: any) {
      console.error(err)
      setError(err?.message || "Failed to load users page")
      setStatus("Load failed")
    } finally {
      setLoading(false)
    }
  }

  async function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!email.trim()) {
      setError("Email is required")
      return
    }

    setSubmitting(true)
    setError("")
    setStatus("Creating invitation...")

    try {
      const res = await fetch(`${API_BASE}/auth/${TENANT_SLUG}/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          full_name: fullName.trim(),
          role,
        }),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(json?.error || json?.message || "Invite failed")
      }

      setEmail("")
      setFullName("")
      setRole("admin")
      setStatus("Invitation created")
      await loadAll()
    } catch (err: any) {
      console.error(err)
      setError(err?.message || "Invite failed")
      setStatus("Invite failed")
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

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
          maxWidth: "1200px",
          margin: "0 auto",
          display: "grid",
          gap: "24px",
        }}
      >
        <div
          style={{
            background: "rgba(8, 22, 59, 0.9)",
            border: "1px solid rgba(81, 133, 255, 0.25)",
            borderRadius: "24px",
            padding: "24px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          }}
        >
          <div style={{ fontSize: "15px", opacity: 0.8, marginBottom: "8px" }}>
            Admin / Developer
          </div>
          <h1 style={{ margin: 0, fontSize: "42px", lineHeight: 1.1 }}>
            Users & Invitations
          </h1>
          <p style={{ marginTop: "12px", fontSize: "18px", opacity: 0.88 }}>
            Invite team members, review accepted users, and manage who can access the platform.
          </p>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "18px" }}>
            <a
              href="/"
              style={{
                textDecoration: "none",
                color: "#fff",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)",
                padding: "10px 16px",
                borderRadius: "14px",
              }}
            >
              Back to Dashboard
            </a>
            <button
              onClick={loadAll}
              style={{
                color: "#fff",
                background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
                border: "none",
                padding: "10px 16px",
                borderRadius: "14px",
                cursor: "pointer",
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        <div
          style={{
            background: "rgba(8, 22, 59, 0.92)",
            border: "1px solid rgba(81, 133, 255, 0.25)",
            borderRadius: "24px",
            padding: "24px",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: "18px" }}>Create Invitation</h2>

          <form
            onSubmit={handleInviteSubmit}
            style={{
              display: "grid",
              gap: "14px",
            }}
          >
            <div>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: 700 }}>
                Full Name
              </label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Michelle Green"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: 700 }}>
                Email
              </label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="michelle@g2groofing.com"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: 700 }}>
                Role
              </label>
              <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
                <option value="admin">admin</option>
                <option value="sales">sales</option>
                <option value="manager">manager</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  color: "#fff",
                  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
                  border: "none",
                  padding: "12px 18px",
                  borderRadius: "14px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                {submitting ? "Creating..." : "Send Invitation"}
              </button>

              <span style={{ opacity: 0.85 }}>{status}</span>
            </div>

            {error ? (
              <div
                style={{
                  background: "rgba(150, 30, 30, 0.22)",
                  border: "1px solid rgba(255, 120, 120, 0.35)",
                  color: "#ffd1d1",
                  borderRadius: "14px",
                  padding: "12px 14px",
                }}
              >
                {error}
              </div>
            ) : null}

            {invitePreviewUrl ? (
              <div
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "14px",
                  padding: "12px 14px",
                  overflowWrap: "anywhere",
                }}
              >
                <strong>Latest invite URL:</strong>
                <div style={{ marginTop: "8px", opacity: 0.92 }}>{invitePreviewUrl}</div>
              </div>
            ) : null}
          </form>
        </div>

        <div
          style={{
            display: "grid",
            gap: "24px",
            gridTemplateColumns: "1fr 1fr",
          }}
        >
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Accepted Users</h2>
            {loading ? (
              <p>Loading...</p>
            ) : users.length ? (
              <div style={{ display: "grid", gap: "12px" }}>
                {users.map((user, index) => (
                  <div key={getUserKey(user, index)} style={rowStyle}>
                    <div style={{ fontWeight: 700 }}>{user.full_name || "Unnamed User"}</div>
                    <div style={{ opacity: 0.9 }}>{user.email}</div>
                    <div style={{ opacity: 0.75 }}>Role: {user.role}</div>
                    <div style={{ opacity: 0.65 }}>Created: {formatDate(user.created_at)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p>No accepted users yet.</p>
            )}
          </section>

          <section style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Pending Invitations</h2>
            {loading ? (
              <p>Loading...</p>
            ) : invitations.length ? (
              <div style={{ display: "grid", gap: "12px" }}>
                {invitations.map((invite, index) => (
                  <div key={getInvitationKey(invite, index)} style={rowStyle}>
                    <div style={{ fontWeight: 700 }}>{invite.full_name || "Unnamed Invite"}</div>
                    <div style={{ opacity: 0.9 }}>{invite.email}</div>
                    <div style={{ opacity: 0.75 }}>Role: {invite.role}</div>
                    <div style={{ opacity: 0.65 }}>Created: {formatDate(invite.created_at)}</div>
                    <div style={{ opacity: 0.65 }}>Accepted: {formatDate(invite.accepted_at)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p>No invitations found.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
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

const cardStyle: React.CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(81, 133, 255, 0.25)",
  borderRadius: "24px",
  padding: "24px",
  minHeight: "200px",
}

const rowStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "16px",
  padding: "14px 16px",
}
