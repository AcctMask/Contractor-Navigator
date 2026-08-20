import { getMe, getToken } from "../lib/auth"
import { useEffect, useMemo, useState } from "react"
import { getTenantSlug } from "../lib/tenant"

const API_BASE = import.meta.env.VITE_API_BASE 
type UserRow = {
  id?: string | number | null
  email: string
  full_name?: string | null
  role: string
  is_active?: boolean
  deactivated_at?: string | null
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

function getAppOrigin() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin
  }
  return "https://contractor-navigator.vercel.app"
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
  const [copied, setCopied] = useState(false)

  const [currentUserId, setCurrentUserId] =
    useState<number | null>(null)

  const [selectedUser, setSelectedUser] =
    useState<UserRow | null>(null)

  const [managedRole, setManagedRole] =
    useState("staff")

  const [newPassword, setNewPassword] =
    useState("")

  const [
    confirmNewPassword,
    setConfirmNewPassword,
  ] = useState("")

  const [managing, setManaging] =
    useState(false)

  const [
    manageStatus,
    setManageStatus,
  ] = useState("")

  const [
    manageError,
    setManageError,
  ] = useState("")

  const activeUsers =
    useMemo(
      () =>
        users.filter(
          (user) =>
            user.is_active !== false
        ),
      [users]
    )

  const formerUsers =
    useMemo(
      () =>
        users.filter(
          (user) =>
            user.is_active === false
        ),
      [users]
    )

  const invitePreviewUrl = useMemo(() => {
    const latest = invitations.find((item) => !item.accepted_at && item.invite_token)
    if (!latest?.invite_token) return ""
    return `${getAppOrigin()}/accept-invite/${latest.invite_token}`
  }, [invitations])

  async function loadAll() {
    setLoading(true)
    setError("")
    setStatus("Loading users and invitations...")

    try {
      const token = getToken()
      const authHeaders = {
        Authorization: `Bearer ${token}`,
      }

      const [
        usersRes,
        invitesRes,
        currentUser,
      ] = await Promise.all([
        fetch(
          `${API_BASE}/auth/${getTenantSlug()}/users`,
          {
            headers:
              authHeaders,
          }
        ),
        fetch(
          `${API_BASE}/auth/${getTenantSlug()}/invitations`,
          {
            headers:
              authHeaders,
          }
        ),
        getMe(),
      ])

      const usersJson =
        await usersRes.json()

      const invitesJson =
        await invitesRes.json()

      if (
        !usersRes.ok ||
        !usersJson?.ok
      ) {
        throw new Error(
          usersJson?.error ||
            "Failed to load users"
        )
      }

      if (
        !invitesRes.ok ||
        !invitesJson?.ok
      ) {
        throw new Error(
          invitesJson?.error ||
            "Failed to load invitations"
        )
      }

      setUsers(
        Array.isArray(
          usersJson.users
        )
          ? usersJson.users
          : []
      )

      setInvitations(
        Array.isArray(
          invitesJson.invitations
        )
          ? invitesJson.invitations
          : []
      )

      setCurrentUserId(
        currentUser?.id ??
          null
      )

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
    setCopied(false)
    setStatus("Creating invitation...")

    try {
      const token = getToken()

      const res = await fetch(`${API_BASE}/auth/${getTenantSlug()}/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
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

      const finalStatus =
        json?.email_sent
          ? json?.tenant_notification_sent
            ? "Invitation emailed successfully"
            : "Invitation emailed; confirmation notice was not sent"
          : "Invitation created — email was not sent"

      await loadAll()

      setStatus(finalStatus)

      if (!json?.email_sent) {
        setError(
          json?.email_error ||
            "Invitation was created, but the email was not sent. Copy Invite URL remains available."
        )
      } else if (
        !json?.tenant_notification_sent &&
        json?.tenant_notification_error
      ) {
        setError(
          json.tenant_notification_error
        )
      }
    } catch (err: any) {
      console.error(err)
      setError(err?.message || "Invite failed")
      setStatus("Invite failed")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopyInvite() {
    if (!invitePreviewUrl) return

    try {
      await navigator.clipboard.writeText(invitePreviewUrl)
      setCopied(true)
      setStatus("Invite URL copied")
    } catch (err: any) {
      console.error(err)
      setError(err?.message || "Could not copy invite URL")
    }
  }

  function openManageUser(
    user: UserRow
  ) {
    setSelectedUser(user)
    setManagedRole(
      user.role ||
        "staff"
    )
    setNewPassword("")
    setConfirmNewPassword("")
    setManageError("")
    setManageStatus("")
  }

  function closeManageUser() {
    setSelectedUser(null)
    setNewPassword("")
    setConfirmNewPassword("")
    setManageError("")
    setManageStatus("")
  }

  async function saveManagedRole() {
    if (
      !selectedUser?.id
    ) {
      return
    }

    setManaging(true)
    setManageError("")
    setManageStatus(
      "Saving role..."
    )

    try {
      const res =
        await fetch(
          `${API_BASE}/auth/${getTenantSlug()}/users/${selectedUser.id}/role`,
          {
            method:
              "PATCH",
            headers: {
              "Content-Type":
                "application/json",
              Authorization:
                `Bearer ${getToken()}`,
            },
            body:
              JSON.stringify({
                role:
                  managedRole,
              }),
          }
        )

      const json =
        await res.json()
          .catch(() => ({}))

      if (
        !res.ok ||
        !json?.ok
      ) {
        throw new Error(
          json?.error ||
            "Role update failed"
        )
      }

      setSelectedUser(
        json.user
      )

      setManagedRole(
        json.user?.role ||
          managedRole
      )

      setManageStatus(
        "Role updated successfully"
      )

      await loadAll()
    } catch (err: any) {
      setManageError(
        err?.message ||
          "Role update failed"
      )
      setManageStatus("")
    } finally {
      setManaging(false)
    }
  }

  async function resetManagedPassword() {
    if (
      !selectedUser?.id
    ) {
      return
    }

    if (
      newPassword.length < 6
    ) {
      setManageError(
        "New password must be at least 6 characters"
      )
      return
    }

    if (
      newPassword !==
      confirmNewPassword
    ) {
      setManageError(
        "Passwords do not match"
      )
      return
    }

    setManaging(true)
    setManageError("")
    setManageStatus(
      "Resetting password..."
    )

    try {
      const res =
        await fetch(
          `${API_BASE}/auth/${getTenantSlug()}/users/${selectedUser.id}/reset-password`,
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
              Authorization:
                `Bearer ${getToken()}`,
            },
            body:
              JSON.stringify({
                newPassword,
              }),
          }
        )

      const json =
        await res.json()
          .catch(() => ({}))

      if (
        !res.ok ||
        !json?.ok
      ) {
        throw new Error(
          json?.error ||
            "Password reset failed"
        )
      }

      setNewPassword("")
      setConfirmNewPassword("")

      setManageStatus(
        "Password reset successfully"
      )

      await loadAll()
    } catch (err: any) {
      setManageError(
        err?.message ||
          "Password reset failed"
      )
      setManageStatus("")
    } finally {
      setManaging(false)
    }
  }

  async function deactivateManagedUser() {
    if (
      !selectedUser?.id
    ) {
      return
    }

    const confirmed =
      window.confirm(
        `Remove Navigator access for ${selectedUser.full_name || selectedUser.email}? The historical user record will be preserved.`
      )

    if (!confirmed) {
      return
    }

    setManaging(true)
    setManageError("")
    setManageStatus(
      "Removing access..."
    )

    try {
      const res =
        await fetch(
          `${API_BASE}/auth/${getTenantSlug()}/users/${selectedUser.id}/deactivate`,
          {
            method:
              "POST",
            headers: {
              Authorization:
                `Bearer ${getToken()}`,
            },
          }
        )

      const json =
        await res.json()
          .catch(() => ({}))

      if (
        !res.ok ||
        !json?.ok
      ) {
        throw new Error(
          json?.error ||
            "Remove user failed"
        )
      }

      setSelectedUser(
        json.user
      )

      setManageStatus(
        "User access removed. Historical record preserved."
      )

      await loadAll()
    } catch (err: any) {
      setManageError(
        err?.message ||
          "Remove user failed"
      )
      setManageStatus("")
    } finally {
      setManaging(false)
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
                <option value="staff">staff</option>
                <option value="subcontractor">subcontractor</option>
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

                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "12px" }}>
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    style={secondaryButtonStyle}
                  >
                    {copied ? "Copied" : "Copy Invite URL"}
                  </button>

                  <a
                    href={invitePreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={secondaryLinkStyle}
                  >
                    Open Invite
                  </a>
                </div>
              </div>
            ) : null}
          </form>
        </div>

        {selectedUser ? (
          <section style={cardStyle}>
            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                gap:
                  "16px",
                alignItems:
                  "flex-start",
                flexWrap:
                  "wrap",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize:
                      "14px",
                    opacity:
                      0.72,
                    marginBottom:
                      "6px",
                  }}
                >
                  Manage User
                </div>

                <h2
                  style={{
                    margin:
                      0,
                  }}
                >
                  {selectedUser.full_name ||
                    "Unnamed User"}
                </h2>

                <div
                  style={{
                    marginTop:
                      "6px",
                    opacity:
                      0.9,
                  }}
                >
                  {selectedUser.email}
                </div>
              </div>

              <button
                type="button"
                onClick={
                  closeManageUser
                }
                style={
                  secondaryButtonStyle
                }
              >
                Close
              </button>
            </div>

            <div
              style={{
                marginTop:
                  "18px",
                display:
                  "grid",
                gap:
                  "8px",
              }}
            >
              <div>
                <strong>
                  Status:
                </strong>{" "}
                {selectedUser.is_active ===
                false
                  ? "Former User"
                  : "Active"}
              </div>

              <div>
                <strong>
                  User ID:
                </strong>{" "}
                {selectedUser.email}
              </div>

              <div>
                <strong>
                  Joined:
                </strong>{" "}
                {formatDate(
                  selectedUser.created_at
                )}
              </div>

              {selectedUser.is_active ===
              false ? (
                <div>
                  <strong>
                    Access ended:
                  </strong>{" "}
                  {formatDate(
                    selectedUser.deactivated_at
                  )}
                </div>
              ) : null}
            </div>

            {selectedUser.role ===
            "platform_owner" ? (
              <div
                style={{
                  marginTop:
                    "18px",
                  padding:
                    "14px",
                  borderRadius:
                    "14px",
                  background:
                    "rgba(255,255,255,0.05)",
                  border:
                    "1px solid rgba(255,255,255,0.10)",
                }}
              >
                Platform owner is protected.
              </div>
            ) : Number(
                selectedUser.id
              ) ===
              currentUserId ? (
              <div
                style={{
                  marginTop:
                    "18px",
                  padding:
                    "14px",
                  borderRadius:
                    "14px",
                  background:
                    "rgba(255,255,255,0.05)",
                  border:
                    "1px solid rgba(255,255,255,0.10)",
                }}
              >
                This is your account.
                Use your own account
                settings for password
                changes. Self role changes
                and self-removal are
                blocked.
              </div>
            ) : selectedUser.is_active ===
              false ? (
              <div
                style={{
                  marginTop:
                    "18px",
                  padding:
                    "14px",
                  borderRadius:
                    "14px",
                  background:
                    "rgba(255,255,255,0.05)",
                  border:
                    "1px solid rgba(255,255,255,0.10)",
                }}
              >
                This former user's
                historical record is
                retained. No active
                account changes are
                available.
              </div>
            ) : (
              <div
                style={{
                  marginTop:
                    "22px",
                  display:
                    "grid",
                  gap:
                    "24px",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(280px, 1fr))",
                }}
              >
                <div>
                  <h3
                    style={{
                      marginTop:
                        0,
                    }}
                  >
                    Role / Permissions
                  </h3>

                  <select
                    value={
                      managedRole
                    }
                    onChange={(
                      e
                    ) =>
                      setManagedRole(
                        e.target
                          .value
                      )
                    }
                    style={
                      inputStyle
                    }
                  >
                    <option value="admin">
                      admin
                    </option>
                    <option value="sales">
                      sales
                    </option>
                    <option value="manager">
                      manager
                    </option>
                    <option value="staff">
                      staff
                    </option>
                    <option value="subcontractor">
                      subcontractor
                    </option>
                  </select>

                  <button
                    type="button"
                    disabled={
                      managing
                    }
                    onClick={
                      saveManagedRole
                    }
                    style={{
                      ...secondaryButtonStyle,
                      marginTop:
                        "12px",
                    }}
                  >
                    Save Role
                  </button>
                </div>

                <div>
                  <h3
                    style={{
                      marginTop:
                        0,
                    }}
                  >
                    Reset Password
                  </h3>

                  <input
                    type="password"
                    value={
                      newPassword
                    }
                    onChange={(
                      e
                    ) =>
                      setNewPassword(
                        e.target
                          .value
                      )
                    }
                    placeholder="New password"
                    style={
                      inputStyle
                    }
                  />

                  <input
                    type="password"
                    value={
                      confirmNewPassword
                    }
                    onChange={(
                      e
                    ) =>
                      setConfirmNewPassword(
                        e.target
                          .value
                      )
                    }
                    placeholder="Confirm new password"
                    style={{
                      ...inputStyle,
                      marginTop:
                        "10px",
                    }}
                  />

                  <button
                    type="button"
                    disabled={
                      managing
                    }
                    onClick={
                      resetManagedPassword
                    }
                    style={{
                      ...secondaryButtonStyle,
                      marginTop:
                        "12px",
                    }}
                  >
                    Reset Password
                  </button>
                </div>

                <div>
                  <h3
                    style={{
                      marginTop:
                        0,
                    }}
                  >
                    Remove Access
                  </h3>

                  <p
                    style={{
                      opacity:
                        0.78,
                    }}
                  >
                    The user will become
                    a Former User. Their
                    historical record and
                    access dates are
                    preserved.
                  </p>

                  <button
                    type="button"
                    disabled={
                      managing
                    }
                    onClick={
                      deactivateManagedUser
                    }
                    style={{
                      color:
                        "#fff",
                      background:
                        "#991b1b",
                      border:
                        "1px solid rgba(255,255,255,0.12)",
                      padding:
                        "10px 14px",
                      borderRadius:
                        "12px",
                      cursor:
                        "pointer",
                      fontWeight:
                        700,
                    }}
                  >
                    Remove User
                  </button>
                </div>
              </div>
            )}

            {manageStatus ? (
              <div
                style={{
                  marginTop:
                    "18px",
                  color:
                    "#c7f9d4",
                }}
              >
                {manageStatus}
              </div>
            ) : null}

            {manageError ? (
              <div
                style={{
                  marginTop:
                    "18px",
                  color:
                    "#ffd1d1",
                }}
              >
                {manageError}
              </div>
            ) : null}
          </section>
        ) : null}

        <div
          style={{
            display: "grid",
            gap: "24px",
            gridTemplateColumns: "1fr 1fr",
          }}
        >
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>
              Accepted Users
            </h2>

            {loading ? (
              <p>Loading...</p>
            ) : activeUsers.length ? (
              <div
                style={{
                  display: "grid",
                  gap: "12px",
                }}
              >
                {activeUsers.map(
                  (
                    user,
                    index
                  ) => (
                    <button
                      type="button"
                      key={getUserKey(
                        user,
                        index
                      )}
                      onClick={() =>
                        openManageUser(
                          user
                        )
                      }
                      style={{
                        ...rowStyle,
                        color:
                          "#e8eefc",
                        textAlign:
                          "left",
                        cursor:
                          "pointer",
                        width:
                          "100%",
                      }}
                    >
                      <div
                        style={{
                          fontWeight:
                            700,
                        }}
                      >
                        {user.full_name ||
                          "Unnamed User"}
                      </div>

                      <div
                        style={{
                          opacity:
                            0.9,
                        }}
                      >
                        {user.email}
                      </div>

                      <div
                        style={{
                          opacity:
                            0.75,
                        }}
                      >
                        Role:{" "}
                        {user.role}
                      </div>

                      <div
                        style={{
                          opacity:
                            0.65,
                        }}
                      >
                        Joined:{" "}
                        {formatDate(
                          user.created_at
                        )}
                      </div>

                      <div
                        style={{
                          marginTop:
                            "8px",
                          opacity:
                            0.72,
                          fontSize:
                            "13px",
                        }}
                      >
                        Click to manage
                      </div>
                    </button>
                  )
                )}
              </div>
            ) : (
              <p>
                No active users yet.
              </p>
            )}

            <h3
              style={{
                marginTop:
                  "28px",
                marginBottom:
                  "12px",
              }}
            >
              Former Users
            </h3>

            {formerUsers.length ? (
              <div
                style={{
                  display: "grid",
                  gap: "12px",
                }}
              >
                {formerUsers.map(
                  (
                    user,
                    index
                  ) => (
                    <button
                      type="button"
                      key={getUserKey(
                        user,
                        index
                      )}
                      onClick={() =>
                        openManageUser(
                          user
                        )
                      }
                      style={{
                        ...rowStyle,
                        color:
                          "#e8eefc",
                        textAlign:
                          "left",
                        cursor:
                          "pointer",
                        width:
                          "100%",
                        opacity:
                          0.82,
                      }}
                    >
                      <div
                        style={{
                          fontWeight:
                            700,
                        }}
                      >
                        {user.full_name ||
                          "Unnamed User"}
                      </div>

                      <div>
                        {user.email}
                      </div>

                      <div
                        style={{
                          opacity:
                            0.75,
                        }}
                      >
                        Last role:{" "}
                        {user.role}
                      </div>

                      <div
                        style={{
                          opacity:
                            0.65,
                        }}
                      >
                        Joined:{" "}
                        {formatDate(
                          user.created_at
                        )}
                      </div>

                      <div
                        style={{
                          opacity:
                            0.65,
                        }}
                      >
                        Access ended:{" "}
                        {formatDate(
                          user.deactivated_at
                        )}
                      </div>
                    </button>
                  )
                )}
              </div>
            ) : (
              <p
                style={{
                  opacity:
                    0.72,
                }}
              >
                No former users.
              </p>
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
                    <div style={{ opacity: 0.65 }}>Expires: {formatDate(invite.expires_at)}</div>
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

const secondaryButtonStyle: React.CSSProperties = {
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "10px 14px",
  borderRadius: "12px",
  cursor: "pointer",
  fontWeight: 700,
}

const secondaryLinkStyle: React.CSSProperties = {
  textDecoration: "none",
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "10px 14px",
  borderRadius: "12px",
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
}
