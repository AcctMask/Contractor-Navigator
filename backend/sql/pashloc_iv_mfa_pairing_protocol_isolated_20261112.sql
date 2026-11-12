-- PashLoc IV MFA isolated pairing protocol additions (draft).
-- Must be reviewed and applied only to an isolated test database.
-- No production migration authorization.
alter table pashloc_mfa_pairings
  add column if not exists device_public_jwk jsonb,
  add column if not exists device_key_fingerprint text,
  add column if not exists claim_id_hash text,
  add column if not exists confirmation_code_hash text,
  add column if not exists confirmation_attempts integer not null default 0,
  add column if not exists denied_at timestamptz,
  add column if not exists redemption_nonce_hash text,
  add column if not exists redemption_nonce_expires_at timestamptz,
  add column if not exists redemption_nonce_consumed_at timestamptz;
create unique index if not exists pashloc_pairings_claim_id_unique
  on pashloc_mfa_pairings(claim_id_hash) where claim_id_hash is not null;
-- Additional ECDH public key, envelope and idempotency columns are NOT approved.
-- This migration intentionally does not enable plaintext secret redemption.
