import { pool } from "../db/db"

/**
 * Navigator Stage Since authority.
 *
 * jobs.stage remains the authoritative physical stage.
 *
 * This observer owns only current_stage_entered_at.
 * It does not own stage transitions, AI Follow-Up,
 * Calendar automation, documents, or workflow behavior.
 */
export async function ensureStageSinceAuthority() {
  await pool.query(`
    alter table jobs
    add column if not exists current_stage_entered_at timestamptz
  `)

  await pool.query(`
    create or replace function sync_job_stage_since()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'INSERT' then
        if nullif(btrim(coalesce(new.stage, '')), '') is not null then
          new.current_stage_entered_at :=
            coalesce(new.current_stage_entered_at, now());
        end if;

        return new;
      end if;

      if new.stage is distinct from old.stage then
        new.current_stage_entered_at := now();
      end if;

      return new;
    end;
    $$;
  `)

  await pool.query(`
    drop trigger if exists jobs_sync_stage_since on jobs;

    create trigger jobs_sync_stage_since
    before insert or update of stage
    on jobs
    for each row
    execute function sync_job_stage_since();
  `)
}
