-- Isolated phone claim challenge: server-generated, single-use nonce.
-- Apply only to isolated Navigator MFA test database after review.
create table if not exists pashloc_mfa_device_claim_nonces (
 id bigserial primary key,
 pairing_hash text not null,
 nonce_hash text not null unique,
 expires_at timestamptz not null,
 consumed_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists pashloc_mfa_claim_nonces_pairing_idx
 on pashloc_mfa_device_claim_nonces(pairing_hash,expires_at);
