import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { setToken } from "../lib/auth"

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://contractor-navigator.onrender.com"

export default function WorkforceAcceptInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [language, setLanguage] = useState<"en" | "es">("en")
  const [loading, setLoading] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState("")
  const [password, setPassword] = useState("")

  const spanish = language === "es"

  async function accept() {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      setError(spanish ? "Invitación no válida." : "Invalid invitation.")
      return
    }

    if (password.length < 10 || password.length > 128) {
      setError(
        spanish
          ? "La contraseña debe tener entre 10 y 128 caracteres."
          : "Password must contain 10 to 128 characters."
      )
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
          body: JSON.stringify({ token, password }),
        }
      )

      const result = await response.json()

      if (!response.ok || !result.ok) {
        throw new Error("Invitation could not be accepted")
      }

      if (!result.account_activated || !result.token) {
        throw new Error("Crew account activation failed")
      }

      setToken(result.token)
      setAccepted(true)
      navigate("/crew", { replace: true })
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
              ? "Su cuenta personal fue creada. El acceso a trabajos estará disponible cuando se complete el inicio de sesión."
              : "Your personal account was created. Job access will be available when sign-in integration is completed."}
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
          <label style={{ display: "block", marginBottom: 16 }}>
            {spanish
              ? "Crear contraseña (mínimo 10 caracteres)"
              : "Create password (at least 10 characters)"}
            <input
              type="password"
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                padding: 12,
                marginTop: 8,
              }}
            />
          </label>
          <button
            onClick={accept}
            disabled={loading || password.length < 10}
          >
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
