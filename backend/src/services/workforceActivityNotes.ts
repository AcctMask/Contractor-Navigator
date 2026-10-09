import type { PoolClient } from "pg"

export type WorkforceActivity =
  | "invited"
  | "assigned"
  | "accepted"
  | "revoked"
  | "reassigned"

export async function recordWorkforceActivity(
  client: PoolClient,
  input: {
    tenantId: number
    jobId: number
    actorUserId: number | null
    actorName: string
    subjectName: string
    subjectRole: "subcontractor" | "crew_lead" | "crew_member"
    action: WorkforceActivity
    assignmentId?: number | null
  }
) {
  const actionText: Record<WorkforceActivity, string> = {
    invited: "invited",
    assigned: "assigned",
    accepted: "accepted the invitation for",
    revoked: "revoked the assignment of",
    reassigned: "reassigned",
  }

  const roleText = {
    subcontractor: "subcontractor",
    crew_lead: "Crew Lead",
    crew_member: "crew member",
  }[input.subjectRole]

  const message =
    input.action === "accepted"
      ? `${input.subjectName} accepted the invitation for Job #${input.jobId} and gained job access eligibility.`
      : `${input.actorName} ${actionText[input.action]} ${input.subjectName} (${roleText}) for Job #${input.jobId}.`

  await client.query(
    `
    insert into timeline_events
      (tenant_id, job_id, kind, message, meta, created_at)
    select
      $1, $2, 'workforce_activity', $3, $4::jsonb, now()
    where exists (
      select 1
      from jobs
      where id = $2 and tenant_id = $1
    )
    `,
    [
      input.tenantId,
      input.jobId,
      message,
      JSON.stringify({
        category: "workforce",
        action: input.action,
        actor_user_id: input.actorUserId,
        actor_name: input.actorName,
        subject_name: input.subjectName,
        subject_role: input.subjectRole,
        assignment_id: input.assignmentId ?? null,
      }),
    ]
  )
}
