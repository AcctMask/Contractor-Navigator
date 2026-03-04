import { pool } from "../db/db";

/**
 * Scheduler:
 * - Claims scheduled_actions due now (pending + run_at <= now())
 * - Runs them
 * - Logs everything into timeline
 *
 * Outbound messaging is STILL stubbed (timeline only).
 * When Twilio is ready, we swap the stub sender with Twilio sender,
 * but only for allowlisted beta testers at first.
 */

type ScheduledActionRow = {
  id: number;
  tenant_id: number;
  job_id: number | null;
  action_key: string;
  run_at: string;
  status: string;
  payload: any;
};

async function timeline(
  tenantId: number,
  jobId: number | null,
  kind: string,
  message: string,
  meta: any = {}
) {
  await pool.query(
    `insert into timeline (tenant_id, job_id, kind, message, meta)
     values ($1,$2,$3,$4,$5)`,
    [tenantId, jobId, kind, message, meta]
  );
}

async function getJobContext(tenantId: number, jobId: number) {
  const { rows } = await pool.query(
    `select id, tenant_id, external_job_id, stage, zip, name, phone, email
       from jobs
      where tenant_id=$1 and id=$2
      limit 1`,
    [tenantId, jobId]
  );
  return rows[0] || null;
}

async function isDnc(tenantId: number, phone?: string | null, email?: string | null) {
  if (!phone && !email) return false;

  const { rows } = await pool.query(
    `select id
       from dnc
      where tenant_id=$1
        and (
          ($2::text is not null and kind='phone' and value=$2)
          or
          ($3::text is not null and kind='email' and value=$3)
        )
      limit 1`,
    [tenantId, phone || null, email || null]
  );
  return rows.length > 0;
}

function renderTemplate(tpl: string, vars: Record<string, any>) {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

async function sendOutboundStub(
  tenantId: number,
  jobId: number | null,
  channel: "sms" | "email",
  to: { phone?: string | null; email?: string | null; name?: string | null },
  message: string,
  meta: any = {}
) {
  await timeline(tenantId, jobId, "workflow_message_sent_stub", `Outbound via ${channel}`, {
    channel,
    to,
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
    `update scheduled_actions set status='done', updated_at=now() where id=$1`,
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

async function runAction(action: ScheduledActionRow) {
  const payload = action.payload || {};
  const tenantId = action.tenant_id;
  const jobId = action.job_id;

  await timeline(tenantId, jobId, "scheduled_action_run", `${action.action_key} (job_id=${jobId})`, {
    action_id: action.id,
    run_at: action.run_at,
    payload,
  });

  // Only workflow steps are implemented now
  if (action.action_key !== "workflow_step") {
    await timeline(tenantId, jobId, "scheduled_action_done", `${action.action_key} (job_id=${jobId})`, {
      action_id: action.id,
      note: "No-op handler (add implementation later)",
    });
    return;
  }

  if (!jobId) {
    await timeline(tenantId, null, "scheduled_action_failed", `workflow_step missing job_id`, {
      action_id: action.id,
    });
    return;
  }

  const ctx = await getJobContext(tenantId, jobId);
  if (!ctx) {
    await timeline(tenantId, jobId, "scheduled_action_failed", `job not found`, {
      action_id: action.id,
    });
    return;
  }

  // DNC check (you are NOT adding yourself, so this should be false)
  const dnc = await isDnc(tenantId, ctx.phone, ctx.email);
  if (dnc) {
    await timeline(
      tenantId,
      jobId,
      "message_skipped_dnc",
      `Skipped ${payload.workflow_key || "workflow"} step ${payload.step_order ?? "?"} due to DNC`,
      {
        action_id: action.id,
        workflow_key: payload.workflow_key,
        step_order: payload.step_order,
        channel: payload.channel,
        phone: ctx.phone || null,
        email: ctx.email || null,
      }
    );
    return;
  }

  // Respect per-step enable flag if present
  if (payload.enabled === false) {
    await timeline(
      tenantId,
      jobId,
      "message_skipped_disabled",
      `Skipped ${payload.workflow_key || "workflow"} step ${payload.step_order ?? "?"} because step is disabled`,
      { action_id: action.id, workflow_key: payload.workflow_key, step_order: payload.step_order }
    );
    return;
  }

  const vars = {
    name: ctx.name || payload.name || "",
    zip: ctx.zip || payload.zip || "",
    job_id: ctx.external_job_id || payload.job_external_id || "",
    stage: ctx.stage || "",
  };

  const template = String(payload.message_template || "");
  const msg = renderTemplate(template, vars).trim();
  const channel: "sms" | "email" = payload.channel === "email" ? "email" : "sms";

  if (!msg) {
    await timeline(
      tenantId,
      jobId,
      "message_skipped_empty",
      `Skipped ${payload.workflow_key || "workflow"} step ${payload.step_order ?? "?"} because template rendered empty`,
      { action_id: action.id, workflow_key: payload.workflow_key, step_order: payload.step_order }
    );
    return;
  }

  await sendOutboundStub(
    tenantId,
    jobId,
    channel,
    { phone: ctx.phone || null, email: ctx.email || null, name: ctx.name || null },
    msg,
    {
      workflow_key: payload.workflow_key,
      step_order: payload.step_order,
      step_name: payload.step_name,
      job_external_id: ctx.external_job_id || null,
    }
  );

  await timeline(tenantId, jobId, "scheduled_action_done", `workflow_step (job_id=${jobId})`, {
    action_id: action.id,
  });
}

/** Main tick function */
export async function tickScheduler(limit = 25) {
  const claimed = await claimDueActions(limit);

  for (const action of claimed) {
    try {
      await runAction(action);
      await markDone(action.id);
    } catch (err: any) {
      await markFailed(action.id, err);
      await timeline(
        action.tenant_id,
        action.job_id,
        "scheduled_action_failed",
        `${action.action_key} failed (job_id=${action.job_id})`,
        { action_id: action.id, error: String(err?.message || err) }
      );
    }
  }

  return { ok: true, claimed: claimed.length };
}

/**
 * IMPORTANT:
 * /admin/tick expects runSchedulerTick()
 * This alias prevents the exact crash you saw.
 */
export async function runSchedulerTick() {
  return tickScheduler(25);
}
