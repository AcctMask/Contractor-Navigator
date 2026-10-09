import { pool } from "../db/db"

export type CrewInvitationActor = {
  id: number
  tenant_id: number
}

const MANAGERS = new Set([
  "platform_owner", "tenant_admin", "admin", "manager"
])

/**
 * Authorization check only.
 * No invitations, database writes, or SMS.
 * Tenant policy/delegation must be checked before
 * activating subcontractor invitations.
 */
export async function canInviteCrewToJob(
  actor: CrewInvitationActor,
  companyId: number,
  jobId: number
): Promise<boolean> {
  if (
    !Number.isSafeInteger(actor?.id) || actor.id <= 0 ||
    !Number.isSafeInteger(actor?.tenant_id) || actor.tenant_id <= 0 ||
    !Number.isSafeInteger(companyId) || companyId <= 0 ||
    !Number.isSafeInteger(jobId) || jobId <= 0
  ) return false

  const result = await pool.query(
    `select 1
     from app_users u
     join subcontractor_companies sc
       on sc.id = $3
      and sc.tenant_id = u.tenant_id
     join jobs j
       on j.id = $4
      and j.tenant_id = u.tenant_id
     where u.id = $1
       and u.tenant_id = $2
       and u.is_active = true
       and (
         u.role = any($5::text[])
         or (
           u.role = 'subcontractor'
           and exists (
             select 1
             from subcontractor_company_users scu
             where scu.app_user_id = u.id
               and scu.subcontractor_company_id = sc.id
           )
           and exists (
             select 1
             from crew_assignments ca
             where ca.app_user_id = u.id
               and ca.tenant_id = u.tenant_id
               and ca.job_id = j.id
               and ca.status in ('PENDING', 'active')
           )
         )
       )
     limit 1`,
    [actor.id, actor.tenant_id, companyId, jobId, [...MANAGERS]]
  )

  // Crew-lead delegation requires a verified identity binding.
  // Do not equate workforce_crew_members.id with app_users.id.
  return Boolean(result.rowCount)
}
