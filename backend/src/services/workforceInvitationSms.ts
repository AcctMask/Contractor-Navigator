import { sendSMS } from "./twilioService"
import type { WorkforceLanguage } from "./workforceTranslation"

export async function sendWorkforceInvitationSms(input: {
  phone: string
  name: string
  jobId: number
  language: WorkforceLanguage
  acceptanceUrl: string
}) {
  const body =
    input.language === "es"
      ? `Navigator: ${input.name}, ha sido asignado al trabajo #${input.jobId}. Su asignación ya está activa. Para acceder a los detalles del trabajo, confirme su invitación aquí: ${input.acceptanceUrl}`
      : `Navigator: ${input.name}, you have been assigned to job #${input.jobId}. Your assignment is already active. To access job details, accept your invitation here: ${input.acceptanceUrl}`

  return sendSMS(input.phone, body)
}
