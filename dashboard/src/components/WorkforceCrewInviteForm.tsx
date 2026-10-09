import { useState, type FormEvent } from "react"

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
      setError("Invitation could not be completed. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <h3>Assign Crew Lead or Member</h3>
      <p>Job: {jobLabel}</p>

      <label>
        Name
        <input
          required
          maxLength={150}
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </label>

      <label>
        Mobile Phone
        <input
          required
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
        />
      </label>

      <label>
        Crew Role
        <select
          value={role}
          onChange={e => setRole(e.target.value as "lead" | "member")}
        >
          <option value="member">Crew Member</option>
          <option value="lead">Crew Lead</option>
        </select>
      </label>

      <label>
        Language
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
        {busy ? "Working..." : "Invite"}
      </button>
    </form>
  )
}
