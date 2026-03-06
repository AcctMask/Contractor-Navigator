import { pool } from "../db/db";
async function timeline(tenantId, jobId, kind, message, meta = {}) {
    await pool.query(`insert into timeline_events (tenant_id, job_id, kind, message, meta, created_at)
     values ($1,$2,$3,$4,$5::jsonb,now())`, [tenantId, jobId, kind, message, JSON.stringify(meta || {})]);
}
async function getJobContext(tenantId, jobId) {
    const { rows } = await pool.query(`
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
    `, [tenantId, jobId]);
    return rows[0] || null;
}
function renderTemplate(tpl, vars) {
    return String(tpl || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
        const v = vars[key];
        return v === undefined || v === null ? "" : String(v);
    });
}
async function sendOutboundStub(tenantId, jobId, channel, message, meta = {}) {
    await timeline(tenantId, jobId, "workflow_message_sent_stub", `Outbound via ${channel}`, {
        message,
        ...meta,
    });
}
async function claimDueActions(limit = 25) {
    const { rows } = await pool.query(`
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
    `, [limit]);
    return rows;
}
async function markDone(actionId) {
    await pool.query(`update scheduled_actions
        set status='done',
            updated_at=now()
      where id=$1`, [actionId]);
}
async function markFailed(actionId, err) {
    await pool.query(`update scheduled_actions
        set status='failed',
            updated_at=now(),
            payload = coalesce(payload,'{}'::jsonb) || $2::jsonb
      where id=$1`, [actionId, JSON.stringify({ error: String(err?.message || err) })]);
}
async function runWorkflowStep(action) {
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
async function runAction(action) {
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
    const actions = await claimDueActions(limit);
    for (const action of actions) {
        try {
            await runAction(action);
            await markDone(action.id);
        }
        catch (err) {
            await timeline(action.tenant_id, action.job_id, "scheduled_action_failed", "scheduler error", {
                error: String(err?.message || err),
                action_id: action.id,
            });
            await markFailed(action.id, err);
        }
    }
}
//# sourceMappingURL=scheduler.js.map