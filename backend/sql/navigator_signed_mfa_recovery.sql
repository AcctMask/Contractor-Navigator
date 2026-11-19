-- Account-specific recovery. Bind $1=account id, $2=tenant id, $3=expected MFA epoch.
-- Requires an authorized operator, verified identity and recorded approval.
-- Require exactly one changed row. Tenant policy never changes.
with changed as (
  update app_users u
  set navigator_mfa_required = case when t.navigator_mfa_mandatory then u.navigator_mfa_required else false end,
      navigator_mfa_epoch = u.navigator_mfa_epoch + 1
  from tenants t
  where u.tenant_id=t.id and u.id=$1 and u.tenant_id=$2 and u.navigator_mfa_epoch=$3
    and u.is_active and (u.navigator_mfa_required or t.navigator_mfa_mandatory)
  returning u.id, u.tenant_id, u.navigator_mfa_epoch, t.navigator_mfa_mandatory
), revoked as (
  update navigator_signed_devices d set revoked_at=clock_timestamp()
  from changed c where d.app_user_id=c.id and d.tenant_id=c.tenant_id
    and c.navigator_mfa_mandatory and d.revoked_at is null
), grants as (
  update navigator_signed_enrollment_grants g set used_at=clock_timestamp()
  from changed c where g.app_user_id=c.id and g.tenant_id=c.tenant_id and g.used_at is null
), challenges as (
  update navigator_signed_challenges h set consumed_at=clock_timestamp()
  from changed c where h.app_user_id=c.id and h.tenant_id=c.tenant_id and c.navigator_mfa_mandatory and h.consumed_at is null
), audit as (
  insert into navigator_mfa_recovery_audit (tenant_id,app_user_id,new_epoch)
  select tenant_id,id,navigator_mfa_epoch from changed where navigator_mfa_mandatory
)
select id,tenant_id,navigator_mfa_epoch from changed;
