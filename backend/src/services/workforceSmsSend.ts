import { pool } from "../db/db"
import { sendSMS } from "./twilioService"
import { recordWorkforceSmsNote } from "./workforceSmsNotes"
import {
  translateWorkforceMessage,
  type WorkforceLanguage,
} from "./workforceTranslation"

export async function sendJobCrewSms(input: {
  tenantId: number
  jobId: number
  crewMemberId: number
  senderLanguage: WorkforceLanguage
  senderRole: "tenant" | "sub"
  message: string
}) {
  const original = input.message.trim()
  if (!original) throw new Error("SMS message cannot be empty")

  const result = await pool.query(
    `
    select
      m.id,
      m.mobile_phone,
      m.preferred_language
    from workforce_crew_members m
    join workforce_crew_job_assignments a
      on a.crew_member_id = m.id
     and a.tenant_id = m.tenant_id
     and a.subcontractor_company_id =
         m.subcontractor_company_id
    join jobs j
      on j.id = a.job_id
     and j.tenant_id = a.tenant_id
    where m.tenant_id = $1
      and a.job_id = $2
      and m.id = $3
      and m.is_active = true
      and a.status = 'active'
    limit 1
    `,
    [input.tenantId, input.jobId, input.crewMemberId]
  )

  if (result.rowCount !== 1) {
    throw new Error("Crew member is not assigned to this job")
  }

  const crew = result.rows[0]
  if (!crew.mobile_phone) {
    throw new Error("Crew member has no registered phone number")
  }

  const recipientLanguage: WorkforceLanguage =
    crew.preferred_language === "es" ? "es" : "en"

  const translation = await translateWorkforceMessage({
    text: original,
    fromLanguage: input.senderLanguage,
    toLanguage: recipientLanguage,
  })

  const sent = await sendSMS(
    String(crew.mobile_phone),
    translation.translated
  )

  await recordWorkforceSmsNote({
    tenantId: input.tenantId,
    jobId: input.jobId,
    from: input.senderRole,
    to: "crew",
    message:
      translation.translatedByAi
        ? `Original: ${translation.original}\nTranslation: ${translation.translated}`
        : translation.original,
    providerMessageSid: sent.sid,
  })

  return {
    ok: true,
    jobId: input.jobId,
    crewMemberId: input.crewMemberId,
    messageSid: sent.sid,
    translated: translation.translatedByAi,
  }
}
