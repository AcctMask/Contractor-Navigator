DO $$
BEGIN
  IF current_database() <> 'pashloc_iv_disposable_mfa_isolated' THEN
    RAISE EXCEPTION 'Signed enrollment migration is acceptance-only';
  END IF;
END $$;

ALTER TABLE pashloc_signed_challenges
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'login'
  CHECK (purpose IN ('login','register'));

CREATE TABLE IF NOT EXISTS pashloc_signed_enrollment_grants (
  grant_hash text PRIMARY KEY CHECK(grant_hash ~ '^[a-f0-9]{64}$'),
  tenant_id integer NOT NULL REFERENCES tenants(id),
  app_user_id integer NOT NULL REFERENCES app_users(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pashloc_signed_one_current_device
 ON pashloc_signed_devices(tenant_id,app_user_id)
 WHERE proof_verified_at IS NOT NULL AND revoked_at IS NULL;
