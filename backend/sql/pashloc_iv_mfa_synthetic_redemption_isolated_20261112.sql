-- Isolated synthetic redemption persistence ONLY. No genuine secrets.
-- Requires isolated schema + pairing protocol migrations.
alter table pashloc_mfa_pairings
 add column if not exists synthetic_envelope jsonb,
 add column if not exists synthetic_redeem_proof_hash text,
 add column if not exists synthetic_approval_id text,
 add column if not exists synthetic_account_id text;
-- Exactly one immutable envelope is stored on first valid redemption.
-- All same-device retries return its existing bytes; never re-encrypt.
-- No production migration authorization.
