import { useState, type FormEvent } from "react"
import { useLanguage } from "../context/LanguageContext"

export type CrewInviteDetails = {
  full_name: string
  mobile_phone: string
  crew_role: "lead" | "member"
  preferred_language: "en" | "es"
}

type Props = {
  jobLabel: string
  onInvite: (details: CrewInviteDetails) => Promise<void>
  enabled?: boolean
}

export default function WorkforceCrewInviteForm({
  jobLabel,
  onInvite,
  enabled = false,
}: Props) {
  const { language: interfaceLanguage } = useLanguage()
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [role, setRole] = useState<"lead" | "member">("lead")
  const [language, setLanguage] = useState<"en" | "es">("en")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !enabled) return
    setBusy(true)
    setError("")
    try {
      await onInvite({
        full_name: name.trim(),
        mobile_phone: phone.trim(),
        crew_role: role,
        preferred_language: language,
      })
      setName("")
      setPhone("")
    } catch {
      setError(interfaceLanguage === "es" ? "No se pudo completar la invitación. Inténtelo de nuevo." : "Invitation could not be completed. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <h3>{interfaceLanguage === "es" ? "Asignar líder o miembro del equipo" : "Assign Crew Lead or Member"}</h3>
      <p>{interfaceLanguage === "es" ? "Trabajo:" : "Job:"} {jobLabel}</p>

      <label>
        {interfaceLanguage === "es" ? "Nombre" : "Name"}
        <input
          required
          maxLength={150}
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </label>

      <label>
        {interfaceLanguage === "es" ? "Teléfono móvil" : "Mobile Phone"}
        <input
          required
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
        />
      </label>

      <label>
        {interfaceLanguage === "es" ? "Rol del equipo" : "Crew Role"}
        <select
          value={role}
          onChange={e => setRole(e.target.value as "lead" | "member")}
        >
          <option value="member">{interfaceLanguage === "es" ? "Miembro del equipo" : "Crew Member"}</option>
          <option value="lead">{interfaceLanguage === "es" ? "Líder del equipo" : "Crew Lead"}</option>
        </select>
      </label>

      <label>
        {interfaceLanguage === "es" ? "Idioma" : "Language"}
        <select
          value={language}
          onChange={e => setLanguage(e.target.value as "en" | "es")}
        >
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </label>

      {error && <p role="alert">{error}</p>}

      <button type="submit" disabled={busy || !enabled}>
        {busy ? (interfaceLanguage === "es" ? "Procesando..." : "Working...") : (interfaceLanguage === "es" ? "Invitar" : "Invite")}
      </button>
    </form>
  )
}
