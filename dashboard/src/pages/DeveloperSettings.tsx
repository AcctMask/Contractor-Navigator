import { useEffect, useState } from "react"
import { getToken } from "../lib/auth"

const API_BASE = import.meta.env.VITE_API_BASE || "https://contractor-navigator.onrender.com"

type DevSettings = {
  lead_messages: string[]
  estimate_messages: string[]
  contract_messages: string[]
  tarp_messages: string[]

  lead_timings_minutes: number[]
  estimate_timings_minutes: number[]
  contract_timings_minutes: number[]
  tarp_timings_minutes: number[]
}

export default function DeveloperSettings() {
  const [settings, setSettings] = useState<DevSettings | null>(null)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordStatus, setPasswordStatus] = useState("")
  const [passwordError, setPasswordError] = useState("")

  useEffect(() => {
    fetch(`${API_BASE}/admin/dev-settings/g2g-roofing`)
      .then(res => res.json())
      .then(data => setSettings(data.settings))
  }, [])

  function updateTiming(
    key: keyof DevSettings,
    index: number,
    value: string
  ) {
    if (!settings) return
    const updated = { ...settings }
    ;(updated[key] as number[])[index] = Number(value)
    setSettings(updated)
  }

  function updateMessage(
    key: keyof DevSettings,
    index: number,
    value: string
  ) {
    if (!settings) return
    const updated = { ...settings }
    ;(updated[key] as string[])[index] = value
    setSettings(updated)
  }

  function save() {
    fetch(`${API_BASE}/admin/dev-settings/g2g-roofing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    })
  }

  async function changePassword() {
    setPasswordError("")
    setPasswordStatus("")

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("All password fields are required")
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match")
      return
    }

    const res = await fetch(`${API_BASE}/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      setPasswordError(data?.error || "Password change failed")
      return
    }

    setPasswordStatus("Password updated successfully")
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
  }

  if (!settings) return <div style={{ padding: 20 }}>Loading...</div>

  const section = (title: string, content: any) => (
    <div style={{ marginBottom: 40 }}>
      <h2>{title}</h2>
      {content}
    </div>
  )

  const renderTiming = (key: keyof DevSettings, label: string) =>
    section(
      label + " Timing (minutes)",
      (settings[key] as number[]).map((v, i) => (
        <div key={i}>
          <input
            type="number"
            value={v}
            onChange={e => updateTiming(key, i, e.target.value)}
          />
        </div>
      ))
    )

  const renderMessages = (key: keyof DevSettings, label: string) =>
    section(
      label + " Messages",
      (settings[key] as string[]).map((v, i) => (
        <div key={i}>
          <textarea
            value={v}
            onChange={e => updateMessage(key, i, e.target.value)}
            style={{ width: "100%", height: 60 }}
          />
        </div>
      ))
    )

  return (
    <div style={{ padding: 40 }}>
      <div style={card}>
        <h2>Change Password</h2>

        <label style={label}>Current Password</label>
        <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={input} />

        <label style={label}>New Password</label>
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={input} />

        <label style={label}>Confirm New Password</label>
        <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={input} />

        <button onClick={changePassword}>Update Password</button>

        {passwordStatus ? <p style={{ color: "#4ade80" }}>{passwordStatus}</p> : null}
        {passwordError ? <p style={{ color: "#f87171" }}>{passwordError}</p> : null}
      </div>

      {renderTiming("lead_timings_minutes", "Lead")}
      {renderMessages("lead_messages", "Lead")}

      {renderTiming("estimate_timings_minutes", "Estimate")}
      {renderMessages("estimate_messages", "Estimate")}

      {renderTiming("contract_timings_minutes", "Contract")}
      {renderMessages("contract_messages", "Contract")}

      {renderTiming("tarp_timings_minutes", "Tarp Complete")}
      {renderMessages("tarp_messages", "Tarp Complete")}

      <button onClick={save}>Save Settings</button>

    </div>
  )
}


const card: React.CSSProperties = {
  background: "#111827",
  color: "white",
  borderRadius: 14,
  padding: 20,
  marginBottom: 30,
}

const label: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
}

const input: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  padding: 10,
  marginBottom: 12,
  fontSize: 16,
}
