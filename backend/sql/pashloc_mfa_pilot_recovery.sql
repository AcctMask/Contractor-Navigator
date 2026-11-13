-- Navigator 4.5: independently executable, account-scoped emergency MFA recovery.
-- Run via an authorized production database administrator, never from a public API.
-- Supply both variables explicitly in psql before running:
--   \set pilot_tenant_id 123
--   \set pilot_user_id 456
-- Review target identity using a separate read-only query before execution.
-- Do not execute for other users. No global authentication changes.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE IF NOT EXISTS pashloc_mfa_admin_recovery_audit (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL,
  app_user_id bigint NOT NULL,
  action text NOT NULL CHECK (action = 'disable_pilot_mfa'),
  reason text NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_name='app_users' AND column_name='pashloc_mfa_required'
 ) THEN
   RAISE EXCEPTION 'MFA policy column not deployed; abort recovery';
 END IF;
END $$;
WITH target AS (
 SELECT id,tenant_id FROM app_users
 WHERE id = :pilot_user_id AND tenant_id = :pilot_tenant_id
   AND is_active = true AND pashloc_mfa_required = true
 FOR UPDATE
), disabled AS (
 UPDATE app_users u SET pashloc_mfa_required=false,
   pashloc_mfa_activated_at=null, updated_at=now()
 FROM target t WHERE u.id=t.id AND u.tenant_id=t.tenant_id
 RETURNING u.id,u.tenant_id
)
INSERT INTO pashloc_mfa_admin_recovery_audit
 (tenant_id,app_user_id,action,reason)
SELECT tenant_id,id,'disable_pilot_mfa',
 'Chairman-authorized emergency account-specific recovery'
FROM disabled
RETURNING tenant_id,app_user_id,performed_at;
COMMIT;
