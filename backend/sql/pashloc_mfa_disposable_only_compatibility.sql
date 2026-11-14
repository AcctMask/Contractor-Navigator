-- Disposable-only Navigator/PashLoc compatibility repair.
-- Separate from the production/default-off migration. No account creation.
-- Apply only through the verified private connection, after schema inspection.
BEGIN;
DO $guard$
BEGIN
 IF current_database() <> 'pashloc_iv_disposable_mfa_isolated'
    OR current_user <> 'pashloc_iv_disposable_mfa_isolated_user' THEN
  RAISE EXCEPTION 'Refusing non-disposable database or role';
 END IF;
 IF to_regclass('public.tenants') IS NULL
    OR to_regclass('public.app_users') IS NULL
    OR to_regclass('public.pashloc_mfa_pairings') IS NULL THEN
  RAISE EXCEPTION 'Missing isolated MFA prerequisite tables';
 END IF;
END $guard$;
ALTER TABLE public.app_users
 ADD COLUMN IF NOT EXISTS pashloc_mfa_required boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS pashloc_mfa_activated_at timestamptz;
ALTER TABLE public.pashloc_mfa_pairings
 ADD COLUMN IF NOT EXISTS credential_envelope jsonb,
 ADD COLUMN IF NOT EXISTS credential_redeem_proof_hash text,
 ADD COLUMN IF NOT EXISTS credential_recovery_expires_at timestamptz,
 ADD COLUMN IF NOT EXISTS credential_retry_attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS credential_retry_nonce_hash text,
 ADD COLUMN IF NOT EXISTS credential_retry_nonce_expires_at timestamptz;
DO $verify$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='app_users' AND column_name='pashloc_mfa_required')
 OR NOT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='pashloc_mfa_pairings' AND column_name='credential_envelope') THEN
  RAISE EXCEPTION 'Isolated MFA compatibility verification failed';
 END IF;
END $verify$;
COMMIT;
