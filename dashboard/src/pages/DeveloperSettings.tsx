import {
  useEffect,
  useState,
} from "react"
import { getToken } from "../lib/auth"
import { useTenant } from "../context/TenantContext"
import { useCompanyDna } from "../context/CompanyDnaContext"

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://contractor-navigator.onrender.com"

type DevSettings = {
  lead_messages: string[]
  estimate_messages: string[]
  contract_messages: string[]
  tarp_messages: string[]
  weather_report_messages: string[]

  lead_timings_minutes: number[]
  estimate_timings_minutes: number[]
  contract_timings_minutes: number[]
  tarp_timings_minutes: number[]
  weather_report_timings_minutes: number[]
}

export default function DeveloperSettings() {
  const {
    tenantSlug,
    tenantName,
  } = useTenant()

  const {
    branding,
    workflowDefaults,
  } = useCompanyDna()

  const [settings, setSettings] =
    useState<DevSettings | null>(null)

  const [loading, setLoading] =
    useState(true)

  const [loadError, setLoadError] =
    useState("")

  const [saveStatus, setSaveStatus] =
    useState("")

  const [saveError, setSaveError] =
    useState("")

  const [currentPassword, setCurrentPassword] =
    useState("")

  const [newPassword, setNewPassword] =
    useState("")

  const [confirmPassword, setConfirmPassword] =
    useState("")

  const [passwordStatus, setPasswordStatus] =
    useState("")

  const [passwordError, setPasswordError] =
    useState("")

  const displayName =
    branding.business_display_name ||
    tenantName

  useEffect(() => {
    let cancelled = false

    async function loadSettings() {
      setLoading(true)
      setSettings(null)
      setLoadError("")
      setSaveStatus("")
      setSaveError("")

      const token = getToken()

      if (!token) {
        setLoadError(
          "Authentication token was not found.",
        )
        setLoading(false)
        return
      }

      try {
        const response = await fetch(
          `${API_BASE}/admin/dev-settings/${tenantSlug}`,
          {
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          },
        )

        const data = await response.json()

        if (!response.ok || !data?.ok) {
          throw new Error(
            data?.error ||
              "AI follow-up settings could not be loaded.",
          )
        }

        if (!cancelled) {
          setSettings(data.settings)
        }
      } catch (error: any) {
        if (!cancelled) {
          setLoadError(
            error?.message ||
              "AI follow-up settings could not be loaded.",
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadSettings()

    return () => {
      cancelled = true
    }
  }, [tenantSlug])

  function updateTiming(
    key: keyof DevSettings,
    index: number,
    value: string,
  ) {
    if (!settings) {
      return
    }

    const updated = {
      ...settings,
      [key]: [
        ...(settings[key] as number[]),
      ],
    }

    ;(updated[key] as number[])[index] =
      Number(value)

    setSettings(updated)
  }

  function updateMessage(
    key: keyof DevSettings,
    index: number,
    value: string,
  ) {
    if (!settings) {
      return
    }

    const updated = {
      ...settings,
      [key]: [
        ...(settings[key] as string[]),
      ],
    }

    ;(updated[key] as string[])[index] =
      value

    setSettings(updated)
  }

  async function save() {
    if (!settings) {
      return
    }

    setSaveStatus("")
    setSaveError("")

    const token = getToken()

    if (!token) {
      setSaveError(
        "Authentication token was not found.",
      )
      return
    }

    try {
      const response = await fetch(
        `${API_BASE}/admin/dev-settings/${tenantSlug}`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${token}`,
          },
          body: JSON.stringify(settings),
        },
      )

      const data = await response.json()

      if (!response.ok || !data?.ok) {
        throw new Error(
          data?.error ||
            "AI follow-up settings could not be saved.",
        )
      }

      setSettings(data.settings)
      setSaveStatus(
        `${displayName} AI follow-up settings saved successfully.`,
      )
    } catch (error: any) {
      setSaveError(
        error?.message ||
          "AI follow-up settings could not be saved.",
      )
    }
  }

  async function changePassword() {
    setPasswordError("")
    setPasswordStatus("")

    if (
      !currentPassword ||
      !newPassword ||
      !confirmPassword
    ) {
      setPasswordError(
        "All password fields are required",
      )
      return
    }

    if (
      newPassword !== confirmPassword
    ) {
      setPasswordError(
        "New passwords do not match",
      )
      return
    }

    const response = await fetch(
      `${API_BASE}/auth/change-password`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Authorization:
            `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      },
    )

    const data = await response.json()

    if (!response.ok || !data.ok) {
      setPasswordError(
        data?.error ||
          "Password change failed",
      )
      return
    }

    setPasswordStatus(
      "Password updated successfully",
    )
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
  }

  const section = (
    title: string,
    content: React.ReactNode,
  ) => (
    <section style={sectionCard}>
      <h2 style={sectionTitle}>
        {title}
      </h2>
      {content}
    </section>
  )

  const renderTiming = (
    key: keyof DevSettings,
    labelText: string,
  ) =>
    section(
      `${labelText} Timing (minutes)`,
      (settings?.[key] as number[]).map(
        (value, index) => (
          <div key={index}>
            <label style={fieldLabel}>
              Message {index + 1}
            </label>

            <input
              type="number"
              min="0"
              value={value}
              onChange={(event) =>
                updateTiming(
                  key,
                  index,
                  event.target.value,
                )
              }
              style={input}
            />
          </div>
        ),
      ),
    )

  const renderMessages = (
    key: keyof DevSettings,
    labelText: string,
  ) =>
    section(
      `${labelText} Messages`,
      (settings?.[key] as string[]).map(
        (value, index) => (
          <div key={index}>
            <label style={fieldLabel}>
              Message {index + 1}
            </label>

            <textarea
              value={value}
              onChange={(event) =>
                updateMessage(
                  key,
                  index,
                  event.target.value,
                )
              }
              style={textarea}
            />
          </div>
        ),
      ),
    )

  if (loading) {
    return (
      <div style={page}>
        Loading {displayName} AI follow-up
        settings…
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={page}>
        <div style={errorCard}>
          {loadError}
        </div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div style={page}>
        Settings were not returned.
      </div>
    )
  }

  const prospectLabel =
    workflowDefaults.customer_term ||
    "Customer"

  const proposalLabel =
    workflowDefaults.estimate_term ||
    "Estimate"

  const agreementLabel =
    workflowDefaults.agreement_term ||
    "Contract"

  return (
    <div style={page}>
      <header style={header}>
        <div style={eyebrow}>
          {displayName}
        </div>

        <h1 style={title}>
          AI Follow-Up Settings
        </h1>

        <p style={subtitle}>
          You are editing messages and timing
          only for the selected client workspace:
          {" "}
          <strong>{tenantSlug}</strong>.
        </p>
      </header>

      <div style={card}>
        <h2 style={sectionTitle}>
          Change Your Password
        </h2>

        <label style={fieldLabel}>
          Current Password
        </label>

        <input
          type="password"
          value={currentPassword}
          onChange={(event) =>
            setCurrentPassword(
              event.target.value,
            )
          }
          style={input}
        />

        <label style={fieldLabel}>
          New Password
        </label>

        <input
          type="password"
          value={newPassword}
          onChange={(event) =>
            setNewPassword(
              event.target.value,
            )
          }
          style={input}
        />

        <label style={fieldLabel}>
          Confirm New Password
        </label>

        <input
          type="password"
          value={confirmPassword}
          onChange={(event) =>
            setConfirmPassword(
              event.target.value,
            )
          }
          style={input}
        />

        <button
          onClick={changePassword}
          style={button}
        >
          Update Password
        </button>

        {passwordStatus ? (
          <p style={successText}>
            {passwordStatus}
          </p>
        ) : null}

        {passwordError ? (
          <p style={errorText}>
            {passwordError}
          </p>
        ) : null}
      </div>

      {renderTiming(
        "lead_timings_minutes",
        `${prospectLabel} / Initial Interest`,
      )}

      {renderMessages(
        "lead_messages",
        `${prospectLabel} / Initial Interest`,
      )}

      {renderTiming(
        "weather_report_timings_minutes",
        "Special Report or Evidence",
      )}

      {renderMessages(
        "weather_report_messages",
        "Special Report or Evidence",
      )}

      {renderTiming(
        "estimate_timings_minutes",
        proposalLabel,
      )}

      {renderMessages(
        "estimate_messages",
        proposalLabel,
      )}

      {renderTiming(
        "contract_timings_minutes",
        agreementLabel,
      )}

      {renderMessages(
        "contract_messages",
        agreementLabel,
      )}

      {renderTiming(
        "tarp_timings_minutes",
        "Post-Service or Next Step",
      )}

      {renderMessages(
        "tarp_messages",
        "Post-Service or Next Step",
      )}

      <div style={saveBar}>
        <button
          onClick={save}
          style={primaryButton}
        >
          Save {displayName} Settings
        </button>

        {saveStatus ? (
          <span style={successText}>
            {saveStatus}
          </span>
        ) : null}

        {saveError ? (
          <span style={errorText}>
            {saveError}
          </span>
        ) : null}
      </div>
    </div>
  )
}

const page: React.CSSProperties = {
  padding: 40,
  maxWidth: 1050,
  margin: "0 auto",
  color: "#f8fafc",
}

const header: React.CSSProperties = {
  marginBottom: 28,
}

const eyebrow: React.CSSProperties = {
  color: "#60a5fa",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
}

const title: React.CSSProperties = {
  margin: "8px 0",
  fontSize: 34,
}

const subtitle: React.CSSProperties = {
  color: "#cbd5e1",
  lineHeight: 1.5,
}

const card: React.CSSProperties = {
  background: "#111827",
  border:
    "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 14,
  padding: 20,
  marginBottom: 30,
}

const sectionCard: React.CSSProperties = {
  ...card,
  marginBottom: 22,
}

const sectionTitle: React.CSSProperties = {
  marginTop: 0,
}

const fieldLabel: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
  marginTop: 12,
  color: "#cbd5e1",
  fontWeight: 700,
}

const input: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  padding: 10,
  marginBottom: 12,
  fontSize: 16,
  color: "#f8fafc",
  background: "#0f172a",
  border:
    "1px solid rgba(148, 163, 184, 0.3)",
  borderRadius: 8,
}

const textarea: React.CSSProperties = {
  ...input,
  minHeight: 84,
  resize: "vertical",
  lineHeight: 1.45,
}

const button: React.CSSProperties = {
  padding: "10px 16px",
  border: 0,
  borderRadius: 9,
  cursor: "pointer",
  fontWeight: 800,
}

const primaryButton: React.CSSProperties = {
  ...button,
  color: "white",
  background:
    "linear-gradient(90deg, #2563eb, #38bdf8)",
}

const saveBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap",
  paddingBottom: 30,
}

const successText: React.CSSProperties = {
  color: "#4ade80",
}

const errorText: React.CSSProperties = {
  color: "#f87171",
}

const errorCard: React.CSSProperties = {
  ...card,
  color: "#fecaca",
  border:
    "1px solid rgba(248, 113, 113, 0.45)",
}
