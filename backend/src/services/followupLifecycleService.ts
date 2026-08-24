import { pool } from "../db/db"
import {
  getDeveloperSettings,
  saveDeveloperSettings,
} from "./devSettingsService"

/*
 * NAVIGATOR CORPORATE FOLLOW-UP AUTHORITY
 *
 * Corporate invariant:
 *
 *   jobs.stage transition
 *     -> destination stage
 *     -> tenant AI Follow-Up configuration
 *     -> AI responsibility / fresh workflow clock
 *
 * Stage names, messages and timing belong to the tenant.
 * The transition behavior belongs to Navigator.
 *
 * This initializer is intentionally idempotent and runs before the
 * follow-up scheduler starts.
 */

async function persistNormalizedTenantStageFollowups() {
  const tenants = await pool.query(`
    select distinct tenant_id
    from developer_settings
    order by tenant_id
  `)

  for (const row of tenants.rows) {
    const tenantId = Number(row.tenant_id)

    if (!Number.isFinite(tenantId)) {
      continue
    }

    const settings = await getDeveloperSettings(tenantId)

    /*
     * getDeveloperSettings() performs backward-compatible normalization,
     * including legacy follow-up fields -> stage_followups.
     *
     * Persist the normalized representation so PostgreSQL corporate
     * authority sees the same tenant configuration as application code.
     */
    await saveDeveloperSettings(tenantId, settings)
  }

  return tenants.rowCount || 0
}

async function installCorporateStageTransitionAuthority() {
  await pool.query(`
    create or replace function sync_job_followup_workflow()
    returns trigger
    language plpgsql
    as $$
    declare
      stage_key text;
      stage_config jsonb;
      has_messages boolean := false;
      has_timings boolean := false;
    begin
      stage_key := nullif(btrim(coalesce(new.stage, '')), '');

      if tg_op = 'INSERT' then
        if stage_key is null then
          return new;
        end if;

      elsif new.stage is not distinct from old.stage then
        new.active_followup_workflow :=
          old.active_followup_workflow;

        new.followup_workflow_started_at :=
          old.followup_workflow_started_at;

        return new;
      end if;

      if stage_key is null then
        new.active_followup_workflow := null;
        new.followup_workflow_started_at := null;
        return new;
      end if;

      select
        settings->'stage_followups'->stage_key
      into stage_config
      from developer_settings
      where tenant_id = new.tenant_id
      limit 1;

      if stage_config is not null then
        has_messages :=
          jsonb_typeof(stage_config->'messages') = 'array'
          and exists (
            select 1
            from jsonb_array_elements_text(
              stage_config->'messages'
            ) as message(value)
            where nullif(btrim(message.value), '') is not null
          );

        has_timings :=
          jsonb_typeof(stage_config->'timings_minutes') = 'array'
          and jsonb_array_length(
            stage_config->'timings_minutes'
          ) > 0;
      end if;

      if has_messages and has_timings then
        new.active_followup_workflow := stage_key;
        new.followup_workflow_started_at := now();
      else
        new.active_followup_workflow := null;
        new.followup_workflow_started_at := null;
      end if;

      return new;
    end;
    $$;

    drop trigger if exists jobs_sync_followup_workflow on jobs;

    create trigger jobs_sync_followup_workflow
    before insert or update of stage
    on jobs
    for each row
    execute function sync_job_followup_workflow();
  `)
}

export async function ensureFollowupLifecycleAuthority() {
  const normalizedTenantCount =
    await persistNormalizedTenantStageFollowups()

  await installCorporateStageTransitionAuthority()

  console.log(
    `[Navigator] Corporate follow-up authority ready; normalized tenants=${normalizedTenantCount}`,
  )
}
