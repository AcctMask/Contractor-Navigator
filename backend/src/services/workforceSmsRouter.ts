import { pool } from "../db/db"

export type WorkforceRole = "tenant" | "sub" | "crew"

export type WorkforceDirection =
  | "crew-tenant"
  | "tenant-crew"
  | "sub-tenant"
  | "tenant-sub"
  | "crew-sub"
  | "sub-crew"

export function workforceDirection(
  from: WorkforceRole,
  to: WorkforceRole
): WorkforceDirection | null {
  if (from === to) return null
  return `${from}-${to}` as WorkforceDirection
}

export function workforceNote(
  from: WorkforceRole,
  to: WorkforceRole,
  message: string
) {
  const direction = workforceDirection(from, to)
  if (!direction) throw new Error("Invalid workforce direction")

  return `From: ${from.toUpperCase()} → To: ${to.toUpperCase()}\n${message}`
}

/**
 * Finds an unambiguous active crew assignment for an inbound phone.
 *
 * This is lookup-only. It does not intercept customer SMS,
 * create notes, or send messages.
 */
export async function resolveInboundCrew(
  tenantId: number,
  fromPhone: string
) {
  const digits = fromPhone.replace(/[^0-9]/g, "")
  if (digits.length !== 10 &&
      !(digits.length === 11 && digits.startsWith("1"))) {
    return null
  }

  const result = await pool.query(
    `
    select distinct
      m.id as crew_member_id,
      a.job_id,
      a.subcontractor_company_id,
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
      and right(regexp_replace(m.mobile_phone, '[^0-9]', '', 'g'), 10)
          = right(regexp_replace($2, '[^0-9]', '', 'g'), 10)
      and m.is_active = true
      and m.invitation_status = 'active'
      and a.status = 'active'
    limit 2
    `,
    [tenantId, fromPhone]
  )

  if (result.rows.length !== 1) return null

  return result.rows[0]
}
