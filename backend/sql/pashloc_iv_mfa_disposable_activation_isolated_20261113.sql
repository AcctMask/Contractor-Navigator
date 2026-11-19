-- Dedicated disposable Navigator MFA database only. Do not apply in production.
alter table pashloc_mfa_pairings add column if not exists browser_approval_id text unique;
alter table pashloc_mfa_enrollments
 add column if not exists delivery_pairing_id bigint unique references pashloc_mfa_pairings(id);

create table if not exists pashloc_mfa_disposable_sessions (
 session_hash text primary key,
 enrollment_id bigint not null references pashloc_mfa_enrollments(id) on delete cascade,
 expires_at timestamptz not null
);

create table if not exists pashloc_mfa_request_limits (
 bucket text not null,
 window_start timestamptz not null,
 hits integer not null,
 primary key(bucket,window_start)
);
create index if not exists pashloc_mfa_request_limits_expiry
 on pashloc_mfa_request_limits(window_start);
