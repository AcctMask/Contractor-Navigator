import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

const API = import.meta.env.VITE_API_BASE 
const TENANT = "g2g-roofing"

type DevSettings = {
  alert_sms_to: string
  alert_email_to: string
  lead_timings_minutes: number[]
  estimate_timings_minutes: number[]
  contract_timings_minutes: number[]
  lead_messages: string[]
  estimate_messages: string[]
  contract_messages: string[]
  inbound_auto_replies: {
    estimate_request: string
    inspection_request: string
    callback_request: string
    contract_request: string
    pricing_objection: string
    general_question: string
    buying_signal_only: string
    unknown: string
  }
}

const emptySettings: DevSettings = {
  alert_sms_to: "",
  alert_email_to: "",
  lead_timings_minutes: [0, 30, 240, 1440],
  estimate_timings_minutes: [0, 120, 1440, 4320],
  contract_timings_minutes: [0, 1440, 4320, 7200, 10080],
  lead_messages: ["", "", "", ""],
  estimate_messages: ["", "", "", ""],
  contract_messages: ["", "", "", "", ""],
  inbound_auto_replies: {
    estimate_request: "",
    inspection_request: "",
    callback_request: "",
    contract_request: "",
    pricing_objection: "",
    general_question: "",
    buying_signal_only: "",
    unknown: "",
  },
}

function pageStyle(): React.CSSProperties {
  return {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top right, rgba(37,91,189,0.45), transparent 28%), linear-gradient(180deg, #031126 0%, #04142b 100%)",
    color: "#eef4ff",
    fontFamily: "Inter, system-ui, sans-serif",
    padding: 28,
  }
}

function cardStyle(): React.CSSProperties {
  return {
    background: "linear-gradient(180deg, rgba(14,32,66,0.95), rgba(7,22,48,0.95))",
    border: "1px solid rgba(110,150,255,0.12)",
    borderRadius: 24,
    padding: 22,
    boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
    marginBottom: 20,
  }
}

function labelStyle(): React.CSSProperties {
  return {
    fontSize: 14,
    fontWeight: 800,
    color: "#bcd0f7",
    marginBottom: 8,
    display: "block",
  }
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    color: "#eef4ff",
    fontSize: 15,
    boxSizing: "border-box",
  }
}

function textAreaStyle(): React.CSSProperties {
  return {
    ...inputStyle(),
    minHeight: 90,
    resize: "vertical" as const,
  }
}

export default function DeveloperSettingsPage() {
  const [settings, setSettings] = useState<DevSettings>(emptySettings)
  const [status, setStatus] = useState("Loading...")

  useEffect(() => {
    fetch(`${API}/admin/dev-settings/${TENANT}`)
      .then((r) => r.json())
      .then((data) => {
        setSettings(data.settings)
        setStatus("Loaded")
      })
      .catch(() => setStatus("Failed to load"))
  }, [])

  function updateMessage(
    group: "lead_messages" | "estimate_messages" | "contract_messages",
    index: number,
    value: string
  ) {
    setSettings((prev) => {
      const next = [...prev[group]]
      next[index] = value
      return { ...prev, [group]: next }
    })
  }

  function updateTiming(
    group: "lead_timings_minutes" | "estimate_timings_minutes" | "contract_timings_minutes",
    index: number,
    value: string
  ) {
    setSettings((prev) => {
      const next = [...prev[group]]
      next[index] = Number(value)
      return { ...prev, [group]: next }
    })
  }

  function updateInboundReply(
    key: keyof DevSettings["inbound_auto_replies"],
    value: string
  ) {
    setSettings((prev) => ({
      ...prev,
      inbound_auto_replies: {
        ...prev.inbound_auto_replies,
        [key]: value,
      },
    }))
  }

  async function saveSettings() {
    setStatus("Saving...")

    const res = await fetch(`${API}/admin/dev-settings/${TENANT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    })

    const data = await res.json()

    if (data.ok) {
      setSettings(data.settings)
      setStatus("Saved")
    } else {
      setStatus("Save failed")
    }
  }

  return (
    <div style={pageStyle()}>
      <div style={{ marginBottom: 18 }}>
        <Link to="/" style={{ color: "#9fc2ff", textDecoration: "none", fontWeight: 700 }}>
          ← Back to Dashboard
        </Link>
      </div>

      <div style={cardStyle()}>
        <div style={{ fontSize: 30, fontWeight: 900, marginBottom: 6 }}>Developer Settings</div>
        <div style={{ color: "#9db2d9" }}>
          Edit message wording, timing, alert destinations, and inbound auto-replies without changing code.
        </div>
      </div>

      <div style={cardStyle()}>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 16 }}>Alert Destinations</div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle()}>Alert SMS To</label>
          <input
            style={inputStyle()}
            value={settings.alert_sms_to}
            onChange={(e) => setSettings({ ...settings, alert_sms_to: e.target.value })}
          />
        </div>

        <div>
          <label style={labelStyle()}>Alert Email To</label>
          <input
            style={inputStyle()}
            value={settings.alert_email_to}
            onChange={(e) => setSettings({ ...settings, alert_email_to: e.target.value })}
          />
        </div>
      </div>

      <div style={cardStyle()}>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 16 }}>Lead Timing (minutes)</div>
        {settings.lead_timings_minutes.map((value, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <label style={labelStyle()}>Lead Message {i + 1} Delay</label>
            <input
              style={inputStyle()}
              type="number"
              value={value}
              onChange={(e) => updateTiming("lead_timings_minutes", i, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div style={cardStyle()}>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 16 }}>Estimate Timing (minutes)</div>
        {settings.estimate_timings_minutes.map((value, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <label style={labelStyle()}>Estimate Message {i + 1} Delay</label>
            <input
              style={inputStyle()}
              type="number"
              value={value}
              onChange={(e) => updateTiming("estimate_timings_minutes", i, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div style={cardStyle()}>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 16 }}>Contract Timing (minutes)</div>
        {settings.contract_timings_minutes.map((value, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <label style={labelStyle()}>Contract Message {i + 1} Delay</label>
            <input
              style={inputStyle()}
              type="number"
              value={value}
              onChange={(e) => updateTiming("contract_timings_minutes", i, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div style={cardStyle()}>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 16 }}>Lead Messages</div>
        {settings.lead_messages.map((value, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <label style={labelStyle()}>Lead Message {i + 1}</label>
            <textarea
              style={textAreaStyle()}
              value={value}
              onChange={(e) => updateMessage("lead_messages", i, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div style={cardStyle()}>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 16 }}>Estimate Messages</div>
        {settings.estimate_messages.map((value, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <label style={labelStyle()}>Estimate Message {i + 1}</label>
            <textarea
              style={textAreaStyle()}
              value={value}
              onChange={(e) => updateMessage("estimate_messages", i, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div style={cardStyle()}>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 16 }}>Contract Messages</div>
        {settings.contract_messages.map((value, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <label style={labelStyle()}>Contract Message {i + 1}</label>
            <textarea
              style={textAreaStyle()}
              value={value}
              onChange={(e) => updateMessage("contract_messages", i, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div style={cardStyle()}>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 16 }}>Inbound Auto-Replies</div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle()}>Estimate Request</label>
          <textarea
            style={textAreaStyle()}
            value={settings.inbound_auto_replies.estimate_request}
            onChange={(e) => updateInboundReply("estimate_request", e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle()}>Inspection Request</label>
          <textarea
            style={textAreaStyle()}
            value={settings.inbound_auto_replies.inspection_request}
            onChange={(e) => updateInboundReply("inspection_request", e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle()}>Callback Request</label>
          <textarea
            style={textAreaStyle()}
            value={settings.inbound_auto_replies.callback_request}
            onChange={(e) => updateInboundReply("callback_request", e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle()}>Contract Request</label>
          <textarea
            style={textAreaStyle()}
            value={settings.inbound_auto_replies.contract_request}
            onChange={(e) => updateInboundReply("contract_request", e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle()}>Pricing Objection</label>
          <textarea
            style={textAreaStyle()}
            value={settings.inbound_auto_replies.pricing_objection}
            onChange={(e) => updateInboundReply("pricing_objection", e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle()}>General Question</label>
          <textarea
            style={textAreaStyle()}
            value={settings.inbound_auto_replies.general_question}
            onChange={(e) => updateInboundReply("general_question", e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle()}>Buying Signal Only</label>
          <textarea
            style={textAreaStyle()}
            value={settings.inbound_auto_replies.buying_signal_only}
            onChange={(e) => updateInboundReply("buying_signal_only", e.target.value)}
          />
        </div>

        <div>
          <label style={labelStyle()}>Unknown Message</label>
          <textarea
            style={textAreaStyle()}
            value={settings.inbound_auto_replies.unknown}
            onChange={(e) => updateInboundReply("unknown", e.target.value)}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <button
          onClick={saveSettings}
          style={{
            padding: "14px 18px",
            borderRadius: 14,
            border: "1px solid rgba(78,146,255,0.9)",
            background: "linear-gradient(135deg, #2d6cff, #44b7ff)",
            color: "#fff",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Save Settings
        </button>

        <div style={{ color: "#b8c9ea", fontWeight: 700 }}>{status}</div>
      </div>
    </div>
  )
}
