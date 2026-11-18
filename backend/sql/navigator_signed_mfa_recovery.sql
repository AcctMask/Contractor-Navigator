-- Parameterized operations query. Not a migration or public API.
-- Run after identity proofing and only with explicit account recovery approval.
-- Bind $1=existing account id, $2=existing tenant id, $3=expected current MFA epoch.
-- Require exactly one returned row. No other account is changed.
-- Moving the epoch forward invalidates pre-recovery sessions and challenges.
update app_users
set navigator_mfa_required = false, navigator_mfa_epoch = navigator_mfa_epoch + 1
where id = $1 and tenant_id = $2 and navigator_mfa_epoch = $3
  and is_active and navigator_mfa_required
returning id, tenant_id, navigator_mfa_epoch;
