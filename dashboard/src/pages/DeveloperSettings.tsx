import { useEffect, useState } from "react"

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787"

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
