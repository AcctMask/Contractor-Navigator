-- Additive Navigator MFA schema. Apply before the integration backend.
begin;
alter table tenants add column if not exists navigator_mfa_mandatory boolean not null default false;
alter table app_users add column if not exists navigator_mfa_required boolean not null default false;
alter table app_users add column if not exists navigator_mfa_epoch bigint not null default 0;

create table if not exists navigator_signed_devices (
  device_id text primary key check (device_id ~ '^[A-Za-z0-9_-]{43}$'),
  tenant_id bigint not null references tenants(id) on delete cascade,
  app_user_id bigint not null references app_users(id) on delete cascade,
  public_jwk jsonb not null check (jsonb_typeof(public_jwk) = 'object' and not public_jwk ? 'd'),
  proof_verified_at timestamptz not null,
  revoked_at timestamptz
);
create unique index if not exists navigator_signed_one_active_device
  on navigator_signed_devices (tenant_id, app_user_id) where revoked_at is null;

create table if not exists navigator_signed_challenges (
  reference text primary key,
  browser_hash text not null,
  tenant_id bigint not null references tenants(id) on delete cascade,
  app_user_id bigint not null references app_users(id) on delete cascade,
  device_id text not null references navigator_signed_devices(device_id) on delete cascade,
  policy_epoch bigint not null,
  password_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  decision text check (decision in ('approve', 'deny')),
  consumed_at timestamptz
);
create index if not exists navigator_signed_recent_challenges
  on navigator_signed_challenges (app_user_id, created_at);
create table if not exists navigator_signed_enrollment_grants (
  reference text primary key check (reference ~ '^[A-Za-z0-9_-]{43}$'),
  grant_hash text not null check (grant_hash ~ '^[a-f0-9]{64}$'),
  tenant_id bigint not null references tenants(id) on delete cascade,
  app_user_id bigint not null references app_users(id) on delete cascade,
  policy_epoch bigint not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table navigator_signed_enrollment_grants add column if not exists authorization_id uuid;
create unique index if not exists navigator_signed_one_grant_per_authorization
  on navigator_signed_enrollment_grants (authorization_id) where authorization_id is not null;

create table if not exists navigator_mfa_policy_audit (
  tenant_id bigint primary key references tenants(id),
  actor_user_id bigint not null references app_users(id),
  required_at timestamptz not null default clock_timestamp()
);

create table if not exists navigator_mfa_recovery_audit (
  tenant_id bigint not null references tenants(id),
  app_user_id bigint not null references app_users(id),
  new_epoch bigint not null,
  recovered_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id,app_user_id,new_epoch)
);

-- Reactivation cannot revive a session issued before deactivation.
create or replace function navigator_mfa_invalidate_on_active_change() returns trigger language plpgsql as $
begin
  if exists (select 1 from tenants t where t.id=new.tenant_id and t.navigator_mfa_mandatory) then
    new.navigator_mfa_epoch := greatest(new.navigator_mfa_epoch, old.navigator_mfa_epoch + 1);
  end if;
  return new;
end
$;
drop trigger if exists navigator_mfa_active_change on app_users;
create trigger navigator_mfa_active_change before update of is_active on app_users
for each row when (old.is_active is distinct from new.is_active)
execute function navigator_mfa_invalidate_on_active_change();

-- Audit must commit atomically with device enrollment.
create table if not exists navigator_signed_device_binding_audit (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references tenants(id),
  app_user_id bigint not null references app_users(id),
  device_id text not null,
  binding_method text not null check (binding_method in ('fresh_device_registration', 'acceptance_key_proof')),
  enrollment_reference_hash text not null check (enrollment_reference_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, app_user_id, enrollment_reference_hash)
);
commit;
