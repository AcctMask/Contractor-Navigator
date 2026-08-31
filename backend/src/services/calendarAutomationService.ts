import { pool } from "../db/db"

type CalendarEventRow = {
  id: number
  job_id?: number | null
  title?: string | null
  start_time?: string | Date | null
  end_time?: string | Date | null
  event_type?: string | null
  automation_managed?: boolean | null
  automation_stage_key?: string | null
}

function sameInstant(a: any, b: any) {
  if (!a && !b) return true
  if (!a || !b) return false

  const aTime = new Date(a).getTime()
  const bTime = new Date(b).getTime()

  if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
    return String(a) === String(b)
  }

  return aTime === bTime
}

function eastern(value: any) {
  if (!value) return "not set"

  const d = new Date(value)

  if (Number.isNaN(d.getTime())) {
    return String(value)
  }

  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export async function ensureCalendarAutomationFoundation() {
  await pool.query(`
    create table if not exists calendar_stage_automations (
      id bigserial primary key,
      tenant_id bigint not null references tenants(id) on delete cascade,
      stage_key text not null,
      event_type text not null default 'general',
      event_label text not null default 'Scheduled',
      duration_value integer not null default 1,
      duration_unit text not null default 'hours',
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, stage_key),
      check (duration_value > 0),
      check (
        duration_unit in (
          'minutes',
          'hours',
          'days',
          'weeks',
          'months'
        )
      )
    )
  `)

  await pool.query(`
    alter table calendar_events
      add column if not exists automation_managed boolean not null default false,
      add column if not exists automation_stage_key text null
  `)

  /*
   * Initial tenant calendar policy.
   *
   * Corporate mechanism is universal.
   * Business meaning remains tenant-owned.
   *
   * Good2Go:
   *   in_production -> Production -> 2 days
   *
   * ON CONFLICT intentionally does nothing so a later human/configuration
   * change is never reset by application startup.
   */
  await pool.query(`
    insert into calendar_stage_automations (
      tenant_id,
      stage_key,
      event_type,
      event_label,
      duration_value,
      duration_unit,
      enabled,
      created_at,
      updated_at
    )
    select
      t.id,
      'in_production',
      'production',
      'Production',
      2,
      'days',
      true,
      now(),
      now()
    from tenants t
    where t.slug = 'g2g-roofing'
    on conflict (tenant_id, stage_key) do nothing
  `)

  await pool.query(`
    create unique index if not exists
      idx_calendar_events_stage_automation_unique
    on calendar_events (
      tenant_id,
      job_id,
      automation_stage_key
    )
    where
      automation_managed = true
      and job_id is not null
      and automation_stage_key is not null
  `)

  /*
   * CORPORATE CALENDAR AUTOMATION INVARIANT
   *
   * A real jobs.stage transition is the event.
   * Calendar meaning belongs to tenant configuration.
   *
   * This is intentionally independent of the proven
   * sync_job_followup_workflow() lifecycle.
   *
   * Calendar failure must never block a legitimate stage transition.
   */
  await pool.query(`
    create or replace function sync_stage_calendar_automation()
    returns trigger
    language plpgsql
    as $$
    declare
      cfg record;
      customer_name_value text;
      event_title_value text;
      event_location_value text;
      event_start_value timestamptz;
      event_end_value timestamptz;
      duration_value interval;

      existing_event_id bigint;
      existing_start timestamptz;
      existing_end timestamptz;
    begin
      if new.stage is null then
        return new;
      end if;

      if tg_op = 'UPDATE'
         and new.stage is not distinct from old.stage then
        return new;
      end if;

      select
        csa.stage_key,
        csa.event_type,
        csa.event_label,
        csa.duration_value,
        csa.duration_unit
      into cfg
      from calendar_stage_automations csa
      where csa.tenant_id = new.tenant_id
        and csa.stage_key = new.stage
        and csa.enabled = true
      limit 1;

      if not found then
        return new;
      end if;

      duration_value :=
        case cfg.duration_unit
          when 'minutes' then make_interval(mins => cfg.duration_value)
          when 'hours'   then make_interval(hours => cfg.duration_value)
          when 'days'    then make_interval(days => cfg.duration_value)
          when 'weeks'   then make_interval(days => cfg.duration_value * 7)
          when 'months'  then make_interval(months => cfg.duration_value)
          else make_interval(hours => 1)
        end;

      select nullif(trim(c.full_name), '')
      into customer_name_value
      from customers c
      where c.tenant_id = new.tenant_id
        and c.id = new.customer_id
      limit 1;

      event_title_value :=
        coalesce(
          customer_name_value,
          'Job #' || new.id::text
        )
        || ' — '
        || cfg.event_label;

      event_location_value :=
        concat_ws(
          ', ',
          nullif(trim(new.address1), ''),
          nullif(trim(new.city), ''),
          nullif(trim(new.state), ''),
          nullif(trim(new.zip), '')
        );

      event_start_value := now();
      event_end_value := event_start_value + duration_value;

      select
        ce.id,
        ce.start_time,
        ce.end_time
      into
        existing_event_id,
        existing_start,
        existing_end
      from calendar_events ce
      where ce.tenant_id = new.tenant_id
        and ce.job_id = new.id
        and ce.automation_managed = true
        and ce.automation_stage_key = cfg.stage_key
      order by ce.id desc
      limit 1;

      if existing_event_id is null then
        insert into calendar_events (
          tenant_id,
          job_id,
          title,
          start_time,
          end_time,
          location,
          notes,
          event_type,
          automation_managed,
          automation_stage_key,
          created_at,
          updated_at
        )
        values (
          new.tenant_id,
          new.id,
          event_title_value,
          event_start_value,
          event_end_value,
          nullif(event_location_value, ''),
          'Automatically scheduled when job entered stage: ' || cfg.stage_key,
          cfg.event_type,
          true,
          cfg.stage_key,
          now(),
          now()
        );

        insert into timeline_events (
          tenant_id,
          job_id,
          kind,
          message,
          meta,
          created_at
        )
        values (
          new.tenant_id,
          new.id,
          'calendar_stage_event_created',
          event_title_value
            || ' scheduled from '
            || to_char(
                 event_start_value at time zone 'America/New_York',
                 'Mon DD, YYYY FMHH12:MI AM'
               )
            || ' through '
            || to_char(
                 event_end_value at time zone 'America/New_York',
                 'Mon DD, YYYY FMHH12:MI AM'
               ),
          jsonb_build_object(
            'stage', cfg.stage_key,
            'event_type', cfg.event_type,
            'event_label', cfg.event_label,
            'start_time', event_start_value,
            'end_time', event_end_value,
            'duration_value', cfg.duration_value,
            'duration_unit', cfg.duration_unit,
            'customer_name', customer_name_value,
            'source', 'stage_calendar_automation'
          ),
          now()
        );
      else
        update calendar_events
        set
          title = event_title_value,
          start_time = event_start_value,
          end_time = event_end_value,
          location = nullif(event_location_value, ''),
          event_type = cfg.event_type,
          updated_at = now()
        where tenant_id = new.tenant_id
          and id = existing_event_id;

        insert into timeline_events (
          tenant_id,
          job_id,
          kind,
          message,
          meta,
          created_at
        )
        values (
          new.tenant_id,
          new.id,
          'calendar_stage_event_rescheduled',
          event_title_value
            || ' rescheduled after re-entering '
            || cfg.stage_key
            || ' from '
            || to_char(
                 existing_start at time zone 'America/New_York',
                 'Mon DD, YYYY FMHH12:MI AM'
               )
            || ' to '
            || to_char(
                 event_start_value at time zone 'America/New_York',
                 'Mon DD, YYYY FMHH12:MI AM'
               ),
          jsonb_build_object(
            'stage', cfg.stage_key,
            'event_type', cfg.event_type,
            'event_label', cfg.event_label,
            'old_start_time', existing_start,
            'old_end_time', existing_end,
            'new_start_time', event_start_value,
            'new_end_time', event_end_value,
            'customer_name', customer_name_value,
            'source', 'stage_calendar_automation_reentry'
          ),
          now()
        );
      end if;

      return new;

    exception
      when others then
        raise warning
          'Stage calendar automation failed for tenant %, job %, stage %: %',
          new.tenant_id,
          new.id,
          new.stage,
          sqlerrm;

        /*
         * Constitutional non-interference:
         * calendar enhancement failure may not prevent
         * the legitimate jobs.stage transition.
         */
        return new;
    end;
    $$;
  `)

  await pool.query(`
    drop trigger if exists jobs_sync_stage_calendar_automation on jobs;

    create trigger jobs_sync_stage_calendar_automation
    after insert or update of stage
    on jobs
    for each row
    execute function sync_stage_calendar_automation();
  `)
}

export async function recordCalendarRescheduleActivity(args: {
  tenantId: number
  before: CalendarEventRow
  after: CalendarEventRow
  source?: string
  actor?: {
    actor_name?: string | null
    actor_email?: string | null
    actor_user_id?: number | string | null
  }
}) {
  const { tenantId, before, after } = args

  if (!after.job_id) return

  const startChanged =
    !sameInstant(before.start_time, after.start_time)

  const endChanged =
    !sameInstant(before.end_time, after.end_time)

  if (!startChanged && !endChanged) return

  const title =
    String(after.title || before.title || "Calendar event")

  const message =
    `${title} changed from `
    + `${eastern(before.start_time)} – ${eastern(before.end_time)} `
    + `to ${eastern(after.start_time)} – ${eastern(after.end_time)}`

  await pool.query(
    `
    insert into timeline_events (
      tenant_id,
      job_id,
      kind,
      message,
      meta,
      created_at
    )
    values (
      $1,
      $2,
      'calendar_event_rescheduled',
      $3,
      $4::jsonb,
      now()
    )
    `,
    [
      tenantId,
      Number(after.job_id),
      message,
      JSON.stringify({
        calendar_event_id: after.id,
        event_type: after.event_type || null,
        automation_managed:
          Boolean(after.automation_managed),
        automation_stage_key:
          after.automation_stage_key || null,
        old_start_time: before.start_time || null,
        old_end_time: before.end_time || null,
        new_start_time: after.start_time || null,
        new_end_time: after.end_time || null,
        source: args.source || "calendar_update",
        ...(args.actor || {}),
      }),
    ]
  )
}
