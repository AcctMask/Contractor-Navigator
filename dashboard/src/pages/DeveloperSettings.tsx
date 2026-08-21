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

type StageFollowupConfig = {
  messages: string[]
  timings_minutes: number[]
}

type DevSettings = {
  stage_followups?: Record<string, StageFollowupConfig>

  lead_messages: string[]
  demo_completed_follow_up_messages: string[]
  estimate_messages: string[]
  contract_messages: string[]
  wa_sent_messages: string[]
  tarp_active_messages: string[]
  tarp_messages: string[]
  weather_report_messages: string[]

  lead_timings_minutes: number[]
  demo_completed_follow_up_timings_minutes: number[]
  estimate_timings_minutes: number[]
  contract_timings_minutes: number[]
  wa_sent_timings_minutes: number[]
  tarp_active_timings_minutes: number[]
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
    workspace,
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

  const [openFollowupPanel, setOpenFollowupPanel] =
    useState<string | null>(null)

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

  function stageKeyForCard(
    card: any,
  ) {
    if (
      card?.filter_type !== "stage" ||
      !card?.filter_value
    ) {
      return ""
    }

    return String(card.filter_value).trim()
  }

  function getStageConfiguration(
    stageKey: string,
  ): StageFollowupConfig {
    const configured =
      settings?.stage_followups?.[stageKey]

    return {
      messages:
        Array.isArray(configured?.messages)
          ? configured!.messages
          : ["", "", "", "", "", "", "", "", "", ""],
      timings_minutes:
        Array.isArray(configured?.timings_minutes)
          ? configured!.timings_minutes
          : [0, 1440, 2880, 4320, 10080, 20160, 30240, 43200, 64800, 129600],
    }
  }

  function updateStageTiming(
    stageKey: string,
    index: number,
    value: string,
  ) {
    if (!settings) return

    const current =
      getStageConfiguration(stageKey)

    const timings =
      [...current.timings_minutes]

    timings[index] = Number(value)

    setSettings({
      ...settings,
      stage_followups: {
        ...(settings.stage_followups || {}),
        [stageKey]: {
          ...current,
          timings_minutes: timings,
        },
      },
    })
  }

  function updateStageMessage(
    stageKey: string,
    index: number,
    value: string,
  ) {
    if (!settings) return

    const current =
      getStageConfiguration(stageKey)

    const messages =
      [...current.messages]

    messages[index] = value

    setSettings({
      ...settings,
      stage_followups: {
        ...(settings.stage_followups || {}),
        [stageKey]: {
          ...current,
          messages,
        },
      },
    })
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

  const renderStageFollowupCard = (
    stageKey: string,
    labelText: string,
  ) => {
    const timingPanel =
      `stage:${stageKey}:timing`

    const messagesPanel =
      `stage:${stageKey}:messages`

    const configuration =
      getStageConfiguration(stageKey)

    return (
      <section
        key={stageKey}
        style={sectionCard}
      >
        <h2 style={sectionTitle}>
          {labelText}
        </h2>

        <div style={{
          color: "#94a3b8",
          fontSize: 12,
          marginBottom: 12,
        }}>
          Stage: {stageKey}
        </div>

        <div style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}>
          <button
            type="button"
            onClick={() =>
              setOpenFollowupPanel(
                openFollowupPanel === timingPanel
                  ? null
                  : timingPanel,
              )
            }
            style={{
              ...button,
              background:
                openFollowupPanel === timingPanel
                  ? "#2563eb"
                  : "#334155",
              color: "white",
            }}
          >
            Timing Sequence
          </button>

          <button
            type="button"
            onClick={() =>
              setOpenFollowupPanel(
                openFollowupPanel === messagesPanel
                  ? null
                  : messagesPanel,
              )
            }
            style={{
              ...button,
              background:
                openFollowupPanel === messagesPanel
                  ? "#2563eb"
                  : "#334155",
              color: "white",
            }}
          >
            Customer Messages
          </button>
        </div>

        {openFollowupPanel === timingPanel ? (
          <div style={{ marginTop: 18 }}>
            {configuration.timings_minutes.map(
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
                      updateStageTiming(
                        stageKey,
                        index,
                        event.target.value,
                      )
                    }
                    style={input}
                  />
                </div>
              ),
            )}
          </div>
        ) : null}

        {openFollowupPanel === messagesPanel ? (
          <div style={{ marginTop: 18 }}>
            {configuration.messages.map(
              (value, index) => (
                <div key={index}>
                  <label style={fieldLabel}>
                    Message {index + 1}
                  </label>

                  <textarea
                    value={value}
                    onChange={(event) =>
                      updateStageMessage(
                        stageKey,
                        index,
                        event.target.value,
                      )
                    }
                    style={textarea}
                  />
                </div>
              ),
            )}
          </div>
        ) : null}
      </section>
    )
  }

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

      {(
        workspace.dashboard
          .pipeline_cards || []
      )
        .map((card) => ({
          card,
          stageKey:
            stageKeyForCard(card),
        }))
        .filter(
          ({ stageKey }) =>
            Boolean(stageKey),
        )
        .map(({ card, stageKey }) =>
          renderStageFollowupCard(
            stageKey,
            card.label,
          ),
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
