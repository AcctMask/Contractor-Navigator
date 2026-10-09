import { useState } from "react"
import { getToken } from "../lib/auth"
import { getTenantSlug } from "../lib/tenant"

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://contractor-navigator.onrender.com"

type Props = {
  text: string
  jobId: string
  language: "en" | "es"
  onUseTranslation?: (translated: string) => void
}

export default function TranslateMessage({ text, jobId, language, onUseTranslation }: Props) {
  const [translation, setTranslation] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function translate() {
    if (loading || !text.trim()) return

    setLoading(true)
    setError("")
    setTranslation("")

    try {
      const response = await fetch(
        `${API_BASE}/assets/${getTenantSlug()}/job/${jobId}/translate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ text, toLanguage: language }),
        }
      )

      const data = await response.json()

      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "Translation unavailable")
      }

      setTranslation(String(data.translated || ""))
    } catch (err) {
      const detail = err instanceof Error ? err.message : ""
      const safeDetail =
        detail.includes("Invalid incoming translation response")
          ? language === "es"
            ? "No se pudo interpretar la respuesta de traducción."
            : "The translation response could not be interpreted."
          : language === "es"
            ? "No se pudo traducir este mensaje."
            : "Unable to translate this message."
      setError(safeDetail)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={translate}
        disabled={loading}
        style={{
          cursor: loading ? "wait" : "pointer",
          padding: "5px 10px",
          border: "1px solid #94a3b8",
          borderRadius: 6,
          background: "#334155",
          color: "#ffffff",
          fontSize: 12,
        }}
      >
        {loading
          ? language === "es" ? "Traduciendo..." : "Translating..."
          : language === "es" ? "Traducir al español" : "Translate to English"}
      </button>

      {translation && (
        <div style={{ marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
          <strong>{language === "es" ? "Traducción:" : "Translation:"}</strong>
          <div>{translation}</div>
        </div>
      )}

      {translation && onUseTranslation && (
        <button
          type="button"
          onClick={() => onUseTranslation(translation)}
          style={{
            marginTop: 8,
            padding: "5px 10px",
            cursor: "pointer",
            border: "1px solid #94a3b8",
            borderRadius: 6,
            background: "#334155",
            color: "#ffffff",
          }}
        >
          {language === "es" ? "Usar traducción" : "Use translation"}
        </button>
      )}

      {error && (
        <div role="alert" style={{ marginTop: 6, color: "#b91c1c" }}>
          {error}
        </div>
      )}
    </div>
  )
}
