/**
 * Navigator 2.7 crew invitation input contract.
 *
 * Validation only. No database changes, SMS, or email.
 * Job authorization must be checked before an invitation
 * can be created by a future API route.
 */

export type CrewInvitationInput = {
  full_name: string
  mobile_phone: string
  crew_role: "lead" | "member"
  preferred_language: "en" | "es"
  job_id: number
}

export function normalizeCrewPhone(value: string): string | null {
  if (typeof value !== "string") return null

  const digits = value.replace(/\D/g, "")
  const tenDigits =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits

  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(tenDigits)) {
    return null
  }

  return `+1${tenDigits}`
}

export function validateCrewInvitation(
  input: CrewInvitationInput
): string | null {
  if (!input || typeof input !== "object") {
    return "Invitation details required"
  }

  if (
    typeof input.full_name !== "string" ||
    !input.full_name.trim() ||
    input.full_name.trim().length > 150
  ) {
    return "Enter a crew member name"
  }

  if (
    typeof input.mobile_phone !== "string" ||
    !normalizeCrewPhone(input.mobile_phone)
  ) {
    return "Enter a valid US mobile number"
  }

  if (!["lead", "member"].includes(input.crew_role)) {
    return "Choose Crew Lead or Crew Member"
  }

  if (!["en", "es"].includes(input.preferred_language)) {
    return "Choose English or Español"
  }

  if (!Number.isSafeInteger(input.job_id) || input.job_id <= 0) {
    return "Choose an assigned job"
  }

  return null
}
