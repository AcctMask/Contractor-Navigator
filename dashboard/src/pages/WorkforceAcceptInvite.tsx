import { useState } from "react"
import { useParams } from "react-router-dom"

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://contractor-navigator.onrender.com"

export default function WorkforceAcceptInvite() {
  const { token } = useParams<{ token: string }>()
  const [language, setLanguage] = useState<"en" | "es">("en")
  const [loading, setLoading] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState("")

  const spanish = language === "es"

  async function accept() {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      setError(spanish ? "Invitación no válida." : "Invalid invitation.")
      return
    }

    setLoading(true)
    setError("")

    try {
      const response = await fetch(
        `${API_BASE}/workforce/crew/accept-invite`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        }
      )

      const result = await response.json()

      if (!response.ok || !result.ok) {
        throw new Error("Invitation could not be accepted")
      }

      setAccepted(true)
    } catch {
      setError(
        spanish
          ? "La invitación venció, ya se utilizó o fue revocada."
          : "This invitation expired, was already used, or was revoked."
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{
      maxWidth: 520,
      margin: "80px auto",
      padding: 24,
      fontFamily: "Arial, sans-serif",
    }}>
      <h1>Navigator — {spanish ? "Equipo" : "Crew"}</h1>

      <button onClick={() => setLanguage(
        spanish ? "en" : "es"
      )}>
        {spanish ? "English" : "Español"}
      </button>

      {accepted ? (
        <>
          <h2>{spanish ? "Invitación aceptada" : "Invitation accepted"}</h2>
          <p>
            {spanish
              ? "Su invitación fue confirmada. Su asignación ya estaba activa."
              : "Your invitation is confirmed. Your assignment was already active."}
          </p>
          <p>
            {spanish
              ? "El acceso al trabajo depende de los permisos de su cuenta."
              : "Job access is subject to your account permissions."}
          </p>
        </>
      ) : (
        <>
          <h2>
            {spanish ? "Confirmar acceso" : "Confirm access"}
          </h2>
          <p>
            {spanish
              ? "Su asignación no depende de aceptar esta invitación. Confirmarla es un paso para obtener acceso personal."
              : "Your assignment does not depend on accepting this invitation. Confirmation is a step toward personal access."}
          </p>
          <button onClick={accept} disabled={loading}>
            {loading
              ? (spanish ? "Procesando..." : "Processing...")
              : (spanish ? "Aceptar invitación" : "Accept invitation")}
          </button>
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </main>
  )
}
