-- PashLoc IV MFA isolated schema proposal. DO NOT APPLY IN PRODUCTION.
-- No login policy or mandatory MFA activation in this file.
create table if not exists pashloc_mfa_enrollments (
 id bigserial primary key,
 tenant_id bigint not null references tenants(id) on delete cascade,
 app_user_id bigint not null references app_users(id) on delete cascade,
 account_id text not null unique,
 encrypted_secret bytea not null,
 encryption_key_version text not null,
 status text not null default 'pending' check(status in ('pending','confirmed','revoked')),
 last_accepted_step bigint,
 created_at timestamptz not null default now(),
 confirmed_at timestamptz,
 unique(tenant_id,app_user_id)
);
create table if not exists pashloc_mfa_challenges (
 id bigserial primary key,
 tenant_id bigint not null references tenants(id) on delete cascade,
 app_user_id bigint not null references app_users(id) on delete cascade,
 challenge_hash text not null unique,
 purpose text not null check(purpose in ('enroll','verify','recover')),
 expires_at timestamptz not null,
 attempts integer not null default 0,
 max_attempts integer not null default 5,
 consumed_at timestamptz,
 created_at timestamptz not null default now(),
 check(attempts>=0 and max_attempts between 1 and 10)
);
create table if not exists pashloc_mfa_pairings (
 id bigserial primary key,
 challenge_id bigint not null references pashloc_mfa_challenges(id) on delete cascade,
 pairing_hash text not null unique,
 claimant_hash text unique,
 expires_at timestamptz not null,
 claimed_at timestamptz,
 browser_approved_at timestamptz,
 redeemed_at timestamptz
);
create table if not exists pashloc_mfa_recovery_codes (
 id bigserial primary key,
 tenant_id bigint not null references tenants(id) on delete cascade,
 app_user_id bigint not null references app_users(id) on delete cascade,
 code_hash text not null unique,
 consumed_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists pashloc_mfa_audit_events (
 id bigserial primary key,
 tenant_id bigint not null references tenants(id) on delete cascade,
 app_user_id bigint references app_users(id) on delete set null,
 event_type text not null,
 event_metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
-- Security Assurance must approve key custody, atomicity, recovery and migration.
