import { pool } from "../db/db"
import {
  workforceDirection,
  workforceNote,
  type WorkforceRole,
} from "./workforceSmsRouter"

export async function recordWorkforceSmsNote(input: {
  tenantId: number
  jobId: number
  from: WorkforceRole
  to: WorkforceRole
  message: string
  providerMessageSid?: string | null
  senderAppUserId?: number | null
  recipientAppUserId?: number | null
  crewMemberId?: number | null
  subcontractorCompanyId?: number | null
}) {
  const direction = workforceDirection(input.from, input.to)

  if (!direction || !input.message.trim()) {
    throw new Error("Invalid workforce SMS note")
  }

  // A job must belong to the specified tenant.
  const job = await pool.query(
    `
    select id
    from jobs
    where id = $1
      and tenant_id = $2
    limit 1
    `,
    [input.jobId, input.tenantId]
  )

  if (job.rowCount !== 1) {
    throw new Error("Workforce SMS job not found")
  }

  const note = workforceNote(
    input.from,
    input.to,
    input.message.trim()
  )

  await pool.query(
    `
    insert into timeline_events
      (tenant_id, job_id, kind, message, meta, created_at)
    values
      ($1, $2, $3, $4, $5::jsonb, now())
    `,
    [
      input.tenantId,
      input.jobId,
      "workforce_sms",
      note,
      JSON.stringify({
        channel: "sms",
        direction,
        from_role: input.from,
        to_role: input.to,
        provider_message_sid: input.providerMessageSid || null,
        sender_app_user_id: input.senderAppUserId ?? null,
        recipient_app_user_id: input.recipientAppUserId ?? null,
        crew_member_id: input.crewMemberId ?? null,
        subcontractor_company_id: input.subcontractorCompanyId ?? null,
      }),
    ]
  )

  return { ok: true, direction }
}
