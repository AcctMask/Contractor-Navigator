-- Apply to the Commercial store used by Navigator (COMMERCIAL_DATABASE_URL,
-- or DATABASE_URL when no separate store is configured). The AA Commercial
-- Engine already writes these columns. Do not infer ownership for legacy
-- rows or set a tenant default. Untagged rows are excluded from signed-in routes.
begin;
alter table commercial_targets add column if not exists tenant_slug text;
alter table commercial_email_queue add column if not exists tenant_slug text;
create index if not exists navigator_commercial_targets_tenant_idx on commercial_targets(tenant_slug,id);
create index if not exists navigator_commercial_queue_tenant_idx on commercial_email_queue(tenant_slug,target_id);
commit;
