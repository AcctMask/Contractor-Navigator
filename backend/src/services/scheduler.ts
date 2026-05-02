import { pool } from "../db/db";

type ScheduledActionRow = {
  id: number;
  tenant_id: number;
  job_id: number | null;
  action_key: string;
  run_at: string;
  status: string;
  payload: any;
};

const QUIET_TIME_ZONE = "America/New_York";
const QUIET_START_HOUR = 19; // 7 PM
const QUIET_END_HOUR = 7;    // 7 AM

function easternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: QUIET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function isQuietHours(date = new Date()) {
  const { hour } = easternParts(date);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

function nextQuietHoursEndIso(date = new Date()) {
  const p = easternParts(date);

  // If after 7 PM Eastern, next opening is tomorrow 7 AM Eastern.
  // If before 7 AM Eastern, opening is today 7 AM Eastern.
  const dayOffset = p.hour >= QUIET_START_HOUR ? 1 : 0;

  const approxUtc = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset, QUIET_END_HOUR + 5, 0, 0));
  return approxUtc.toISOString();
}

async function pushDueActionsToQuietHoursEnd(limit = 250) {
  const nextRunAt = nextQuietHoursEndIso();

  const result = await pool.query(
    `
    update scheduled_actions
       set run_at = $1::timestamptz,
           updated_at = now(),
           payload = coalesce(payload,'{}'::jsonb) || $2::jsonb
     where status = 'pending'
       and run_at <= now()
     returning id, tenant_id, job_id, action_key
    `,
    [
      nextRunAt,
      JSON.stringify({
        quiet_hours_delayed: true,
        quiet_hours_timezone: QUIET_TIME_ZONE,
        delayed_until: nextRunAt,
      }),
    ]
  );

  for (const row of result.rows.slice(0, limit)) {
    await timeline(
      row.tenant_id,
      row.job_id,
      "scheduled_action_delayed_quiet_hours",
      `Scheduled action delayed until ${nextRunAt} due to quiet hours.`,
      {
        action_id: row.id,
        action_key: row.action_key,
        delayed_until: nextRunAt,
        timezone: QUIET_TIME_ZONE,
      }
    );
  }

  return result.rowCount || 0;
}

async function timeline(
  tenantId: number,
  jobId: number | null,
  kind: string,
  message: string,
  meta: any = {}
) {
  await pool.query(
    `insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
     values ($1,$2,$3,$4,$5::jsonb,now())`,
    [tenantId, jobId, kind, message, JSON.stringify(meta || {})]
  );
}

async function getJobContext(tenantId: number, jobId: number) {
  const { rows } = await pool.query(
    `
    select
      j.id,
      j.external_job_id,
      j.stage,
      j.zip,
      c.full_name as name
    from jobs j
    left join customers c
      on c.id = j.customer_id
     and c.tenant_id = j.tenant_id
    where j.tenant_id=$1
      and j.id=$2
    limit 1
    `,
    [tenantId, jobId]
  );
  return rows[0] || null;
}

function renderTemplate(tpl: string, vars: Record<string, any>) {
  return String(tpl || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

async function sendOutboundStub(
  tenantId: number,
  jobId: number | null,
  channel: "sms" | "email",
  message: string,
  meta: any = {}
) {
  await timeline(tenantId, jobId, "workflow_message_sent_stub", `Outbound via ${channel}`, {
    message,
    ...meta,
  });
}

async function claimDueActions(limit = 25): Promise<ScheduledActionRow[]> {
  const { rows } = await pool.query(
    `
    with cte as (
      select id
        from scheduled_actions
       where status='pending'
         and run_at <= now()
       order by run_at asc
       limit $1
       for update skip locked
    )
    update scheduled_actions sa
       set status='running',
           updated_at=now()
      from cte
     where sa.id=cte.id
    returning sa.id, sa.tenant_id, sa.job_id, sa.action_key, sa.run_at, sa.status, sa.payload
    `,
    [limit]
  );
  return rows as ScheduledActionRow[];
}

async function markDone(actionId: number) {
  await pool.query(
    `update scheduled_actions
        set status='done',
            updated_at=now()
      where id=$1`,
    [actionId]
  );
}

async function markFailed(actionId: number, err: any) {
  await pool.query(
    `update scheduled_actions
        set status='failed',
            updated_at=now(),
            payload = coalesce(payload,'{}'::jsonb) || $2::jsonb
      where id=$1`,
    [actionId, JSON.stringify({ error: String(err?.message || err) })]
  );
}

async function runWorkflowStep(action: ScheduledActionRow) {
  const payload = action.payload || {};
  const tenantId = action.tenant_id;
  const jobId = action.job_id;

  if (!jobId) {
    await timeline(tenantId, null, "scheduled_action_failed", "workflow_step missing job_id", {
      action_id: action.id,
    });
    return;
  }

  const ctx = await getJobContext(tenantId, jobId);
  if (!ctx) {
    await timeline(tenantId, jobId, "scheduled_action_failed", "job not found", {
      action_id: action.id,
    });
    return;
  }

  const vars = {
    name: ctx.name || "",
    zip: ctx.zip || "",
    job_id: ctx.external_job_id || "",
    stage: ctx.stage || "",
  };

  const template = String(payload.message_template || "");
  const msg = renderTemplate(template, vars).trim();

  if (!msg) {
    await timeline(tenantId, jobId, "message_skipped_empty", "template rendered empty", {
      action_id: action.id,
      workflow_key: payload.workflow_key || null,
      step_order: payload.step_order ?? null,
    });
    return;
  }

  await sendOutboundStub(tenantId, jobId, "sms", msg, {
    action_id: action.id,
    workflow_key: payload.workflow_key || null,
    step_order: payload.step_order ?? null,
  });
}

async function runAction(action: ScheduledActionRow) {
  const tenantId = action.tenant_id;
  const jobId = action.job_id;

  await timeline(tenantId, jobId, "scheduled_action_run", `${action.action_key} (job_id=${jobId})`, {
    action_id: action.id,
    run_at: action.run_at,
  });

  if (action.action_key === "workflow_step") {
    await runWorkflowStep(action);
  }

  await timeline(tenantId, jobId, "scheduled_action_done", `${action.action_key} (job_id=${jobId})`, {
    action_id: action.id,
  });
}

export async function schedulerTick(limit = 25) {
  if (isQuietHours()) {
    const delayed = await pushDueActionsToQuietHoursEnd();
    if (delayed > 0) {
      console.log(`Quiet hours active — delayed ${delayed} scheduled actions until 7 AM Eastern`);
    }
    return { ok: true, delayed, quiet_hours: true };
  }

  const actions = await claimDueActions(limit);

  for (const action of actions) {
    try {
      await runAction(action);
      await markDone(action.id);
    } catch (err: any) {
      await timeline(action.tenant_id, action.job_id, "scheduled_action_failed", "scheduler error", {
        error: String(err?.message || err),
        action_id: action.id,
      });
      await markFailed(action.id, err);
    }
  }
}
