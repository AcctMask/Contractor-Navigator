-- AA-PASHLOC-ENROLL-V1: isolated restricted browser session store.
-- APPLY ONLY TO A DEDICATED ISOLATED DATABASE AFTER REVIEW.
-- Does not alter production authentication or create Navigator JWTs.
create table if not exists pashloc_mfa_restricted_browser_sessions (
  id bigserial primary key,
  session_hash text not null unique check (session_hash ~ '^[a-f0-9]{64}$'),
  csrf_hash text not null check (csrf_hash ~ '^[a-f0-9]{64}$'),
  tenant_id bigint not null,
  app_user_id bigint not null,
  challenge_hash text not null check (challenge_hash ~ '^[a-f0-9]{64}$'),
  purpose text not null check (purpose in ('enroll','verify')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index if not exists pashloc_mfa_restricted_browser_scope_idx
  on pashloc_mfa_restricted_browser_sessions (tenant_id,app_user_id,expires_at)
  where revoked_at is null;
-- Issuance must occur only AFTER independently verified Navigator credentials,
-- before full JWT issuance. No public session-creation endpoint is permitted.
