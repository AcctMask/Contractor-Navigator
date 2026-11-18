-- PashLoc IV signed cross-device approval: isolated acceptance ONLY.
-- Do not run against production. No existing MFA tables are changed.
DO $$
BEGIN
  IF current_database() <> 'pashloc_iv_disposable_mfa_isolated' THEN
    RAISE EXCEPTION 'PashLoc signed approval migration is acceptance-only';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pashloc_signed_devices (
  id bigserial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  app_user_id integer NOT NULL REFERENCES app_users(id),
  device_id text NOT NULL UNIQUE,
  public_jwk jsonb NOT NULL,
  proof_verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signed_device_public_only CHECK (
    public_jwk->>'kty'='EC' AND public_jwk->>'crv'='P-256'
    AND NOT public_jwk ? 'd'
  ),
  CONSTRAINT signed_device_scope UNIQUE(id,tenant_id,app_user_id)
);
CREATE INDEX IF NOT EXISTS pashloc_signed_devices_active
  ON pashloc_signed_devices(tenant_id,app_user_id)
  WHERE proof_verified_at IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS pashloc_signed_challenges (
  id bigserial PRIMARY KEY,
  challenge_id text NOT NULL UNIQUE,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  app_user_id integer NOT NULL REFERENCES app_users(id),
  browser_session_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  approved_device_id bigint,
  decision text CHECK (decision IN ('approve','deny')),
  decided_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signed_challenge_device_scope
    FOREIGN KEY(approved_device_id,tenant_id,app_user_id)
    REFERENCES pashloc_signed_devices(id,tenant_id,app_user_id),
  CONSTRAINT signed_challenge_session_hash CHECK(browser_session_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS pashloc_signed_challenges_pending
 ON pashloc_signed_challenges(tenant_id,app_user_id,expires_at)
 WHERE consumed_at IS NULL;
