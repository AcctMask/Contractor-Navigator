-- Navigator 4.5 PashLoc integration schema, default OFF.
-- REVIEW AND APPLY EXPLICITLY with an authorized migration role.
-- This script does not activate MFA or create accounts, credentials or secrets.
-- Apply transactionally; do not connect the disposable isolated database.
BEGIN;
ALTER TABLE app_users
 ADD COLUMN IF NOT EXISTS pashloc_mfa_required boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS pashloc_mfa_activated_at timestamptz;
CREATE TABLE IF NOT EXISTS pashloc_mfa_enrollments (
 id bigserial PRIMARY KEY,
 tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 app_user_id bigint NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 account_id text NOT NULL UNIQUE,
 encrypted_secret bytea NOT NULL,
 encryption_key_version text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','revoked')),
 last_accepted_step bigint,
 created_at timestamptz NOT NULL DEFAULT now(),
 confirmed_at timestamptz,
 delivery_pairing_id bigint,
 UNIQUE(tenant_id,app_user_id)
);
CREATE TABLE IF NOT EXISTS pashloc_mfa_challenges (
 id bigserial PRIMARY KEY,
 tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 app_user_id bigint NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 challenge_hash text NOT NULL UNIQUE,
 purpose text NOT NULL CHECK(purpose IN ('enroll','verify','recover')),
 expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 max_attempts integer NOT NULL DEFAULT 5,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(attempts >= 0 AND max_attempts BETWEEN 1 AND 10)
);
CREATE TABLE IF NOT EXISTS pashloc_mfa_pairings (
 id bigserial PRIMARY KEY,
 challenge_id bigint NOT NULL REFERENCES pashloc_mfa_challenges(id) ON DELETE CASCADE,
 pairing_hash text NOT NULL UNIQUE,
 claimant_hash text UNIQUE,
 expires_at timestamptz NOT NULL,
 claimed_at timestamptz,
 browser_approved_at timestamptz,
 redeemed_at timestamptz,
 device_public_jwk jsonb,
 device_ecdh_public_jwk jsonb,
 device_ecdh_key_fingerprint text,
 device_key_fingerprint text,
 claim_id_hash text,
 confirmation_code_hash text,
 confirmation_attempts integer NOT NULL DEFAULT 0,
 denied_at timestamptz,
 redemption_nonce_hash text,
 redemption_nonce_expires_at timestamptz,
 redemption_nonce_consumed_at timestamptz,
 browser_approval_id text UNIQUE,
 credential_envelope jsonb,
 credential_redeem_proof_hash text,
 credential_recovery_expires_at timestamptz,
 credential_retry_attempts integer NOT NULL DEFAULT 0,
 credential_retry_nonce_hash text,
 credential_retry_nonce_expires_at timestamptz,
 synthetic_envelope jsonb,
 synthetic_redeem_proof_hash text,
 synthetic_approval_id text,
 synthetic_account_id text,
 synthetic_recovery_expires_at timestamptz,
 synthetic_retry_attempts integer NOT NULL DEFAULT 0,
 synthetic_retry_nonce_hash text,
 synthetic_retry_nonce_expires_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS pashloc_pairings_claim_id_unique
 ON pashloc_mfa_pairings(claim_id_hash) WHERE claim_id_hash IS NOT NULL;
DO $mfa$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pashloc_mfa_enrollments_delivery_pairing_fk') THEN
  ALTER TABLE pashloc_mfa_enrollments ADD CONSTRAINT pashloc_mfa_enrollments_delivery_pairing_fk
   FOREIGN KEY (delivery_pairing_id) REFERENCES pashloc_mfa_pairings(id);
 END IF;
END $mfa$;
CREATE UNIQUE INDEX IF NOT EXISTS pashloc_mfa_delivery_pairing_unique
 ON pashloc_mfa_enrollments(delivery_pairing_id) WHERE delivery_pairing_id IS NOT NULL;
-- Device proof nonces must be single-use before an iPhone claim can be accepted.
CREATE TABLE IF NOT EXISTS pashloc_mfa_device_claim_nonces (
 id bigserial PRIMARY KEY,
 pairing_hash text NOT NULL,
 nonce_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(pairing_hash,nonce_hash)
);
CREATE INDEX IF NOT EXISTS pashloc_mfa_device_claim_nonces_expiry
 ON pashloc_mfa_device_claim_nonces(expires_at);
CREATE TABLE IF NOT EXISTS pashloc_mfa_restricted_browser_sessions (
 id bigserial PRIMARY KEY,
 session_hash text NOT NULL UNIQUE CHECK(session_hash ~ '^[a-f0-9]{64}$'),
 csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[a-f0-9]{64}$'),
 tenant_id bigint NOT NULL,
 app_user_id bigint NOT NULL,
 challenge_hash text NOT NULL CHECK(challenge_hash ~ '^[a-f0-9]{64}$'),
 purpose text NOT NULL CHECK(purpose IN ('enroll','verify')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 CHECK(expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS pashloc_mfa_restricted_browser_scope_idx
 ON pashloc_mfa_restricted_browser_sessions(tenant_id,app_user_id,expires_at)
 WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS pashloc_mfa_recovery_codes (
 id bigserial PRIMARY KEY,
 tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 app_user_id bigint NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 code_hash text NOT NULL UNIQUE,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pashloc_mfa_recovery_account_idx
 ON pashloc_mfa_recovery_codes(tenant_id,app_user_id)
 WHERE consumed_at IS NULL;
CREATE TABLE IF NOT EXISTS pashloc_mfa_audit_events (
 id bigserial PRIMARY KEY,
 tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 app_user_id bigint REFERENCES app_users(id) ON DELETE SET NULL,
 event_type text NOT NULL,
 event_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pashloc_mfa_request_limits (
 bucket text NOT NULL,
 window_start timestamptz NOT NULL,
 hits integer NOT NULL,
 PRIMARY KEY(bucket,window_start)
);
CREATE INDEX IF NOT EXISTS pashloc_mfa_request_limits_expiry
 ON pashloc_mfa_request_limits(window_start);
COMMIT;
