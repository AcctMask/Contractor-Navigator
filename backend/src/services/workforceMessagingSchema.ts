import { pool } from "../db/db"

/**
 * Navigator 2.7 workforce messaging schema.
 *
 * Not connected to application startup or routes.
 * No SMS delivery and no automatic database execution.
 */
export async function ensureWorkforceMessagingTables() {
  await pool.query(`
    create unique index if not exists
      idx_workforce_company_tenant_identity
    on subcontractor_companies (id, tenant_id)
  `)

  await pool.query(`
    create table if not exists workforce_conversations (
      id bigserial primary key,
      tenant_id bigint not null references tenants(id),
      job_id bigint not null,
      subcontractor_company_id bigint not null
        references subcontractor_companies(id),
      crew_assignment_id bigint,
      created_by_user_id bigint references app_users(id),
      constraint workforce_company_tenant_fk
        foreign key (subcontractor_company_id, tenant_id)
        references subcontractor_companies(id, tenant_id),
      constraint workforce_conversations_identity_unique
        unique (id, tenant_id, job_id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)

  await pool.query(`
    create table if not exists workforce_messages (
      id bigserial primary key,
      conversation_id bigint not null
        references workforce_conversations(id),
      tenant_id bigint not null references tenants(id),
      job_id bigint not null,
      sender_user_id bigint references app_users(id),
      recipient_user_id bigint references app_users(id),
      crew_assignment_id bigint,
      direction text not null
        check (direction in ('outbound', 'inbound')),
      original_language text not null
        check (original_language in ('en', 'es')),
      recipient_language text not null
        check (recipient_language in ('en', 'es')),
      original_text text not null,
      translated_text text,
      translation_reviewed_by bigint references app_users(id),
      delivery_status text not null default 'draft',
      provider_message_sid text,
      created_at timestamptz not null default now(),
      sent_at timestamptz,
      received_at timestamptz,
      constraint workforce_messages_conversation_scope_fk
        foreign key (conversation_id, tenant_id, job_id)
        references workforce_conversations(id, tenant_id, job_id)
    )
  `)

  await pool.query(`
    create index if not exists idx_workforce_conversations_job
    on workforce_conversations (tenant_id, job_id)
  `)

  await pool.query(`
    create index if not exists idx_workforce_messages_conversation
    on workforce_messages (tenant_id, conversation_id, created_at)
  `)
}
