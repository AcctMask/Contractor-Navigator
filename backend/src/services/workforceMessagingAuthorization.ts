import { pool } from "../db/db"

export type WorkforceMessagingActor = {
  id: number
  tenant_id: number
  role: string
  is_active: boolean
}

const MANAGEMENT_ROLES = new Set([
  "platform_owner",
  "tenant_admin",
  "admin",
  "manager",
])

/**
 * Authorizes access to a specific workforce conversation.
 *
 * Management may access conversations within its tenant.
 * Subcontractors must retain an active assignment and
 * membership in the conversation's subcontractor company.
 *
 * This function does not send messages or modify records.
 */
export async function canAccessWorkforceConversation(
  actor: WorkforceMessagingActor,
  conversationId: number
): Promise<boolean> {
  if (!Number.isSafeInteger(actor?.id) || actor.id <= 0) {
    return false
  }
  if (!Number.isSafeInteger(actor?.tenant_id) || actor.tenant_id <= 0) {
    return false
  }
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
    return false
  }

  const currentUser = await pool.query(
    `select role, is_active
     from app_users
     where id = $1 and tenant_id = $2
     limit 1`,
    [actor.id, actor.tenant_id]
  )

  if (!currentUser.rowCount || !currentUser.rows[0].is_active) {
    return false
  }

  const currentRole = String(currentUser.rows[0].role)

  const result = await pool.query(
    `
    select 1
    from workforce_conversations wc
    join jobs j
      on j.id = wc.job_id
     and j.tenant_id = wc.tenant_id
    where wc.id = $1
      and wc.tenant_id = $2
      and (
        $3::boolean
        or (
          $4::text = 'subcontractor'
          and exists (
            select 1
            from subcontractor_company_users scu
            join subcontractor_companies sc
              on sc.id = scu.subcontractor_company_id
             and sc.tenant_id = wc.tenant_id
            where scu.subcontractor_company_id =
              wc.subcontractor_company_id
              and scu.app_user_id = $5
          )
          and exists (
            select 1
            from crew_assignments ca
            where ca.id = wc.crew_assignment_id
              and ca.tenant_id = wc.tenant_id
              and ca.job_id = wc.job_id
              and ca.app_user_id = $5
              and ca.status in ('PENDING', 'active')
          )
        )
      )
    limit 1
    `,
    [
      conversationId,
      actor.tenant_id,
      MANAGEMENT_ROLES.has(currentRole),
      currentRole,
      actor.id,
    ]
  )

  return Boolean(result.rowCount)
}
