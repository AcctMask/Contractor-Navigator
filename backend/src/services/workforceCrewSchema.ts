import { pool } from "../db/db"

/**
 * Navigator 2.7 individual crew member records.
 *
 * Separate from app_users authentication.
 * Not connected to startup or any API route.
 * No database operations execute unless explicitly called.
 */
export async function ensureWorkforceCrewTables() {
  await pool.query(`
    create table if not exists workforce_crew_members (
      id bigserial primary key,
      tenant_id bigint not null references tenants(id),
      subcontractor_company_id bigint not null,
      full_name text not null,
      mobile_phone text,
      crew_role text not null default 'member'
        check (crew_role in ('lead', 'member')),
      invitation_status text not null default 'invited'
        check (invitation_status in ('invited', 'active', 'disabled')),
      invited_by_user_id bigint references app_users(id),
      invited_at timestamptz,
      accepted_at timestamptz,
      preferred_language text not null default 'en'
        check (preferred_language in ('en', 'es')),
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint workforce_crew_company_tenant_fk
        foreign key (subcontractor_company_id, tenant_id)
        references subcontractor_companies(id, tenant_id),
      constraint workforce_crew_identity_unique
        unique (id, tenant_id, subcontractor_company_id)
    )
  `)

  await pool.query(`
    create table if not exists workforce_crew_job_assignments (
      id bigserial primary key,
      tenant_id bigint not null references tenants(id),
      job_id bigint not null,
      subcontractor_company_id bigint not null,
      crew_member_id bigint not null,
      status text not null default 'active'
        check (status in ('active', 'revoked')),
      assigned_by_user_id bigint references app_users(id),
      assigned_at timestamptz not null default now(),
      revoked_at timestamptz,
      constraint workforce_crew_job_member_fk
        foreign key (
          crew_member_id, tenant_id, subcontractor_company_id
        )
        references workforce_crew_members(
          id, tenant_id, subcontractor_company_id
        ),
      constraint workforce_crew_job_company_fk
        foreign key (subcontractor_company_id, tenant_id)
        references subcontractor_companies(id, tenant_id)
    )
  `)

  await pool.query(`
    create index if not exists idx_workforce_crew_job_access
    on workforce_crew_job_assignments
      (tenant_id, job_id, subcontractor_company_id, status)
  `)

  await pool.query(`
    create index if not exists idx_workforce_crew_company
    on workforce_crew_members
      (tenant_id, subcontractor_company_id)
  `)
}
