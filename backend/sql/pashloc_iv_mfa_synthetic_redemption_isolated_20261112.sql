-- Isolated synthetic redemption persistence ONLY. No genuine secrets.
-- Requires isolated schema + pairing protocol migrations.
alter table pashloc_mfa_pairings
 add column if not exists synthetic_envelope jsonb,
 add column if not exists synthetic_redeem_proof_hash text,
 add column if not exists synthetic_approval_id text,
 add column if not exists synthetic_account_id text,
 add column if not exists synthetic_recovery_expires_at timestamptz,
 add column if not exists synthetic_retry_attempts integer not null default 0,
 add column if not exists synthetic_retry_nonce_hash text,
 add column if not exists synthetic_retry_nonce_expires_at timestamptz;
-- The initial device/approval binding is immutable once the envelope exists.
-- Each retry challenge is single-use and must be signed by that same device.
-- Exactly one immutable envelope is stored on first valid redemption.
-- All same-device retries return its existing bytes; never re-encrypt.
-- Retry authority is bounded by synthetic_recovery_expires_at and an attempt cap.
-- No production migration authorization.
