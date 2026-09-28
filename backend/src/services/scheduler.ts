import { pool } from "../db/db"
import {
  reportNavigatorFailure,
  reportNavigatorRecovery,
} from "./navigatorHealthService";
import {
  sendCustomerAcknowledgmentEmail,
  sendActualAssistantNavigatorEmail,
  sendAlertEmail,
} from "./emailService";

import {
  getTenantConversationProfileBySlug,
} from "./companyDnaRuntimeService";
import {
  createDocumentPackageByTenantSlug,
  sendDocumentPackage,
} from "./documentPipelineService";
import { sendSMS } from "./twilioService"

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
         and not (
           action_key = 'initial_external_response'
           and payload->>'kind' = 'ems_document_package'
           and payload->>'source' = 'claims_email_intake'
         )
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

async function claimDueEmsActions(
  limit = 25
): Promise<ScheduledActionRow[]> {
  const { rows } = await pool.query(
    `
    with cte as (
      select id
        from scheduled_actions
       where status = 'pending'
         and run_at <= now()
         and action_key = 'initial_external_response'
         and payload->>'kind' = 'ems_document_package'
         and payload->>'source' = 'claims_email_intake'
       order by run_at asc
       limit $1
       for update skip locked
    )
    update scheduled_actions sa
       set status = 'running',
           updated_at = now()
      from cte
     where sa.id = cte.id
    returning
      sa.id,
      sa.tenant_id,
      sa.job_id,
      sa.action_key,
      sa.run_at,
      sa.status,
      sa.payload
    `,
    [limit]
  )

  return rows as ScheduledActionRow[]
}

async function pushDueEmsActionsToQuietHoursEnd(
  limit = 250
) {
  const nextRunAt = nextQuietHoursEndIso()

  const result = await pool.query(
    `
    with cte as (
      select id
        from scheduled_actions
       where status = 'pending'
         and run_at <= now()
         and action_key = 'initial_external_response'
         and payload->>'kind' = 'ems_document_package'
         and payload->>'source' = 'claims_email_intake'
       order by run_at asc
       limit $1
       for update skip locked
    )
    update scheduled_actions sa
       set run_at = $2::timestamptz,
           updated_at = now(),
           payload =
             coalesce(sa.payload, '{}'::jsonb)
             || $3::jsonb
      from cte
     where sa.id = cte.id
    returning
      sa.id,
      sa.tenant_id,
      sa.job_id,
      sa.action_key
    `,
    [
      limit,
      nextRunAt,
      JSON.stringify({
        quiet_hours_delayed: true,
        quiet_hours_timezone: QUIET_TIME_ZONE,
        delayed_until: nextRunAt,
      }),
    ]
  )

  for (const row of result.rows) {
    await timeline(
      row.tenant_id,
      row.job_id,
      "scheduled_action_delayed_quiet_hours",
      `EMS scheduled action delayed until ${nextRunAt} due to quiet hours.`,
      {
        action_id: row.id,
        action_key: row.action_key,
        delayed_until: nextRunAt,
        timezone: QUIET_TIME_ZONE,
        scheduler_lane: "ems_claims",
      }
    )
  }

  return result.rowCount || 0
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

async function runInitialExternalResponse(
  action: ScheduledActionRow
) {
  const tenantId = action.tenant_id
  const jobId = action.job_id
  const payload = action.payload || {}

  if (!jobId) {
    await timeline(
      tenantId,
      null,
      "initial_external_response_skipped",
      "Initial external response skipped because job_id is missing.",
      {
        action_id: action.id,
      }
    )
    return
  }

  const jobResult = await pool.query(
    `
    select
      j.id,
      j.bot_paused,
      j.bot_pause_reason,
      j.stage
    from jobs j
    where j.tenant_id = $1
      and j.id = $2
    limit 1
    `,
    [
      tenantId,
      jobId,
    ]
  )

  if (!jobResult.rowCount) {
    await timeline(
      tenantId,
      jobId,
      "initial_external_response_skipped",
      "Initial external response skipped because job no longer exists.",
      {
        action_id: action.id,
      }
    )
    return
  }

  const job = jobResult.rows[0]

  if (
    job.bot_paused ||
    ["archived", "disqualified", "not_moving_forward"].includes(
      String(job.stage || "")
    )
  ) {
    await timeline(
      tenantId,
      jobId,
      "initial_external_response_cancelled",
      "Initial automated external response cancelled during the five-minute grace period.",
      {
        action_id: action.id,
        bot_paused: Boolean(job.bot_paused),
        bot_pause_reason:
          job.bot_pause_reason || null,
        stage:
          job.stage || null,
        kind:
          payload.kind || null,
      }
    )
    return
  }

  if (
    payload.kind ===
    "sales_customer_acknowledgment"
  ) {
    const customerEmail =
      String(
        payload.customer_email || ""
      ).trim()

    if (!customerEmail) {
      await timeline(
        tenantId,
        jobId,
        "initial_external_response_skipped",
        "Sales acknowledgment skipped because customer email is unavailable.",
        {
          action_id: action.id,
          kind: payload.kind,
        }
      )
      return
    }

    const result =
      await sendCustomerAcknowledgmentEmail(
        customerEmail,
        String(
          payload.customer_name || "there"
        ),
        {
          propertyAddress:
            payload.property_address || "",
          sourceDetail:
            payload.source_detail || "",
        }
      )

    await timeline(
      tenantId,
      jobId,
      "initial_external_response_sent",
      "Initial sales acknowledgment released after the five-minute grace period.",
      {
        action_id: action.id,
        kind: payload.kind,
        result,
      }
    )

    return
  }

  if (
    payload.kind ===
    "ems_document_package"
  ) {
    const tenantSlug =
      String(
        payload.tenant_slug || ""
      ).trim()

    if (!tenantSlug) {
      throw new Error(
        "EMS initial response missing tenant_slug"
      )
    }

    const documentPackage =
      await createDocumentPackageByTenantSlug(
        tenantSlug,
        jobId,
        "ems_tarp"
      )

    const packageId =
      Number(documentPackage.id)

    const result =
      await sendDocumentPackage(
        tenantSlug,
        jobId,
        packageId
      )

    await timeline(
      tenantId,
      jobId,
      "initial_external_response_sent",
      "EMS WA created from current job data and sent after the five-minute grace period.",
      {
        action_id: action.id,
        kind: payload.kind,
        package_id: packageId,
        result,
      }
    )

    return
  }

  throw new Error(
    `Unsupported initial external response kind: ${String(
      payload.kind || ""
    )}`
  )
}

async function runUserInvitationExpiration(
  action: ScheduledActionRow
) {
  const invitationId =
    Number(
      action.payload
        ?.invitation_id
    )

  if (!invitationId) {
    throw new Error(
      "Invitation expiration action missing invitation_id"
    )
  }

  const result =
    await pool.query(
      `
      select
        i.id,
        i.tenant_id,
        i.email,
        i.full_name,
        i.role,
        i.accepted_at,
        i.expires_at,
        i.invited_by_user_id,
        t.slug as tenant_slug,
        t.name as tenant_name,
        u.email as inviter_email
      from user_invitations i
      join tenants t
        on t.id = i.tenant_id
      left join app_users u
        on u.id =
          i.invited_by_user_id
       and u.tenant_id =
          i.tenant_id
      where i.id = $1
        and i.tenant_id = $2
      limit 1
      `,
      [
        invitationId,
        action.tenant_id,
      ]
    )

  const invitation =
    result.rows[0]

  if (!invitation) {
    await timeline(
      action.tenant_id,
      null,
      "user_invitation_expiration_skipped",
      "Invitation expiration skipped because the invitation no longer exists.",
      {
        action_id:
          action.id,
        invitation_id:
          invitationId,
      }
    )

    return
  }

  if (invitation.accepted_at) {
    await timeline(
      action.tenant_id,
      null,
      "user_invitation_expiration_skipped",
      `${invitation.full_name} already accepted the Navigator invitation.`,
      {
        action_id:
          action.id,
        invitation_id:
          invitation.id,
        accepted_at:
          invitation.accepted_at,
      }
    )

    return
  }

  if (
    new Date(
      invitation.expires_at
    ).getTime() >
    Date.now()
  ) {
    throw new Error(
      "Invitation expiration action ran before expires_at"
    )
  }

  if (!invitation.inviter_email) {
    await timeline(
      action.tenant_id,
      null,
      "user_invitation_expiration_skipped",
      "Invitation expired but the inviter email is unavailable.",
      {
        action_id:
          action.id,
        invitation_id:
          invitation.id,
      }
    )

    return
  }

  let tenantName =
    invitation.tenant_name ||
    invitation.tenant_slug

  try {
    const profile =
      await getTenantConversationProfileBySlug(
        invitation.tenant_slug
      )

    tenantName =
      profile.identity.display_name ||
      profile.identity.business_name ||
      tenantName
  } catch (error) {
    console.error(
      "Invitation expiration tenant profile lookup failed",
      error
    )
  }

  const emailResult =
    await sendActualAssistantNavigatorEmail({
      to:
        invitation.inviter_email,
      subject:
        `${invitation.full_name} did not accept the ${tenantName} Navigator invitation`,
      heading:
        "Navigator invitation expired",
      lines: [
        `${invitation.full_name} (${invitation.email}) did not accept the invitation to join ${tenantName} Navigator as ${invitation.role} before it expired.`,
      ],
    })

  if (!emailResult.ok) {
    throw new Error(
      emailResult.error ||
      "Invitation expiration notification failed"
    )
  }

  await timeline(
    action.tenant_id,
    null,
    "user_invitation_expired",
    `${invitation.full_name} did not accept the Navigator invitation before expiration.`,
    {
      action_id:
        action.id,
      invitation_id:
        invitation.id,
      full_name:
        invitation.full_name,
      email:
        invitation.email,
      role:
        invitation.role,
      invited_by_user_id:
        invitation.invited_by_user_id ||
        null,
    }
  )
}

async function runG2gEstimateNeededReminder(
  action: ScheduledActionRow
) {
  const tenantId = action.tenant_id
  const jobId = action.job_id
  const payload = action.payload || {}

  if (!jobId) {
    await timeline(
      tenantId,
      null,
      "estimate_needed_notification_skipped",
      "Estimate Needed reminder skipped because job_id is missing.",
      {
        action_id: action.id,
      }
    )
    return
  }

  const requestNumber =
    Math.max(
      2,
      Number(payload.request_number || 2)
    )

  const result = await pool.query(
    `
    select
      j.id,
      j.external_job_id,
      j.stage,
      j.zip,
      c.full_name as customer_name,
      t.slug as tenant_slug
    from jobs j
    join tenants t
      on t.id = j.tenant_id
    left join customers c
      on c.id = j.customer_id
     and c.tenant_id = j.tenant_id
    where j.tenant_id = $1
      and j.id = $2
    limit 1
    `,
    [tenantId, jobId]
  )

  if (!result.rowCount) {
    await timeline(
      tenantId,
      jobId,
      "estimate_needed_notification_skipped",
      "Estimate Needed reminder stopped because the job no longer exists.",
      {
        action_id: action.id,
        request_number: requestNumber,
      }
    )
    return
  }

  const job = result.rows[0]

  if (
    String(job.tenant_slug || "") !== "g2g-roofing" ||
    String(job.stage || "") !== "estimate_needed"
  ) {
    await timeline(
      tenantId,
      jobId,
      "estimate_needed_notification_stopped",
      "Estimate Needed reminder cycle stopped because the job is no longer in Estimate Needed.",
      {
        action_id: action.id,
        request_number: requestNumber,
        tenant_slug: job.tenant_slug || null,
        current_stage: job.stage || null,
      }
    )
    return
  }

  const recipient =
    String(
      process.env.G2G_GMAIL_TO ||
      process.env.ALERT_EMAIL_TO ||
      ""
    ).trim()

  if (!recipient) {
    throw new Error(
      "Good2Go Estimate Needed reminder has no notification recipient"
    )
  }

  const customerName =
    String(
      job.customer_name ||
      `Job #${jobId}`
    ).trim()

  const jobReference =
    String(
      job.external_job_id ||
      jobId
    ).trim()

  const subject =
    requestNumber === 2
      ? `2nd Request — Estimate Still Needed: ${customerName}`
      : requestNumber === 3
        ? `3rd Request — Estimate Still Needed: ${customerName}`
        : `Estimate Still Needed — Request #${requestNumber}: ${customerName}`

  const emailResult = await sendAlertEmail(
    recipient,
    subject,
    [
      `Good2Go job ${jobReference} is still in Estimate Needed.`,
      "",
      `Customer: ${customerName}`,
      `Job: ${jobReference}`,
      `ZIP: ${job.zip || "Not supplied"}`,
      "",
      requestNumber <= 3
        ? `This is Estimate Needed request #${requestNumber}.`
        : `This is continuing Estimate Needed reminder #${requestNumber}.`,
    ].join("\n")
  )

  if (!emailResult?.ok) {
    throw new Error(
      emailResult?.error ||
      "Estimate Needed notification email failed"
    )
  }

  await timeline(
    tenantId,
    jobId,
    "estimate_needed_notification_sent",
    `Estimate Needed notification #${requestNumber} sent to Good2Go.`,
    {
      action_id: action.id,
      request_number: requestNumber,
      recipient,
      source: "navigator_system",
      email_result: emailResult,
    }
  )

  const nextDelayHours =
    requestNumber === 2 ? 48 : 72

  await pool.query(
    `
    insert into scheduled_actions
      (
        tenant_id,
        job_id,
        action_key,
        run_at,
        status,
        payload,
        created_at,
        updated_at
      )
    values
      (
        $1,
        $2,
        'g2g_estimate_needed_reminder',
        now() + ($3::text || ' hours')::interval,
        'pending',
        $4::jsonb,
        now(),
        now()
      )
    `,
    [
      tenantId,
      jobId,
      String(nextDelayHours),
      JSON.stringify({
        request_number: requestNumber + 1,
        tenant_slug: "g2g-roofing",
      }),
    ]
  )
}


function easternLocalDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
) {
  const desiredAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    0,
    0
  )

  let candidate = desiredAsUtc

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate))

    const get = (type: string) =>
      Number(
        parts.find((part) => part.type === type)?.value || 0
      )

    const representedAsUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      0,
      0
    )

    const adjustment = desiredAsUtc - representedAsUtc

    if (adjustment === 0) {
      return new Date(candidate)
    }

    candidate += adjustment
  }

  return new Date(candidate)
}

function nextEasternNineAmAfter(reference: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference)

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value || 0)

  const localNoon = new Date(
    Date.UTC(
      get("year"),
      get("month") - 1,
      get("day") + 1,
      12,
      0,
      0,
      0
    )
  )

  const nextDayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(localNoon)

  const nextGet = (type: string) =>
    Number(
      nextDayParts.find((part) => part.type === type)?.value || 0
    )

  return easternLocalDateTimeToUtc(
    nextGet("year"),
    nextGet("month"),
    nextGet("day"),
    9
  )
}

async function scheduleNextTaskOverdueReminder(
  tenantId: number,
  taskId: number,
  reference: Date
) {
  const nextRunAt = nextEasternNineAmAfter(reference)

  await pool.query(
    `
    insert into scheduled_actions (
      tenant_id,
      job_id,
      action_key,
      run_at,
      status,
      payload,
      created_at,
      updated_at
    )
    values (
      $1,
      null,
      'task_sms_reminder',
      $2,
      'pending',
      $3::jsonb,
      now(),
      now()
    )
    `,
    [
      tenantId,
      nextRunAt.toISOString(),
      JSON.stringify({
        task_id: taskId,
        reminder_type: "overdue",
      }),
    ]
  )
}

async function runTaskSmsReminder(action: ScheduledActionRow) {
  const payload =
    typeof action.payload === "string"
      ? JSON.parse(action.payload || "{}")
      : action.payload || {}

  const taskId = Number(payload.task_id)
  const reminderType = String(payload.reminder_type || "")

  if (
    !Number.isFinite(taskId) ||
    taskId <= 0 ||
    !["due_24h", "overdue"].includes(reminderType)
  ) {
    return
  }

  const result = await pool.query(
    `
    select
      ti.id,
      ti.title,
      ti.end_time,
      ti.completed_at,
      ti.assigned_user_id,
      au.mobile_phone,
      task_job.external_job_id,
      task_job.address1 as job_address1,
      task_job.city as job_city,
      task_job.state as job_state,
      task_job.zip as job_zip,
      task_customer.full_name as customer_name,
      task_customer.phone as customer_phone

    from task_items ti
    left join jobs task_job
      on task_job.id = ti.job_id
     and task_job.tenant_id = ti.tenant_id
    left join customers task_customer
      on task_customer.id = task_job.customer_id
     and task_customer.tenant_id = task_job.tenant_id
    left join app_users au
      on au.id = ti.assigned_user_id
     and au.tenant_id = ti.tenant_id
     and au.is_active = true
    where ti.tenant_id = $1
      and ti.id = $2
    limit 1
    `,
    [action.tenant_id, taskId]
  )

  if (!result.rowCount) {
    return
  }

  const task = result.rows[0]

  if (task.completed_at) {
    return
  }

  if (
    !task.assigned_user_id ||
    !task.mobile_phone ||
    !task.end_time
  ) {
    return
  }

  const endTime = new Date(task.end_time)

  if (!Number.isFinite(endTime.getTime())) {
    return
  }

  const now = new Date()

  if (reminderType === "due_24h") {
    const expectedRun =
      endTime.getTime() - 24 * 60 * 60 * 1000

    const actualRun =
      new Date(action.run_at).getTime()

    if (
      !Number.isFinite(actualRun) ||
      Math.abs(actualRun - expectedRun) > 5 * 60 * 1000
    ) {
      return
    }

    if (now.getTime() >= endTime.getTime()) {
      return
    }

    const due = endTime.toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })


  const taskSmsHeading =
    String(action.payload?.kind || action.payload?.type || "")
      .toLowerCase()
      .includes("overdue")
      ? "Navigator Task OVERDUE"
      : "Navigator Task Reminder"

  const taskSmsLines: string[] = [taskSmsHeading]

  const taskExternalJobId = String(
    task?.external_job_id || ""
  ).trim()

  const taskCustomerName = String(
    task?.customer_name || ""
  ).trim()

  const taskJobIdentity = [
    taskExternalJobId ? `Job #${taskExternalJobId}` : "",
    taskCustomerName,
  ]
    .filter(Boolean)
    .join(" — ")

  if (taskJobIdentity) {
    taskSmsLines.push(taskJobIdentity)
  }

  const taskTitle = String(task?.title || "").trim()

  if (taskTitle) {
    taskSmsLines.push(`Task: ${taskTitle}`)
  }

  const taskDue = task?.end_time
    ? new Date(task.end_time).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : ""

  if (taskDue) {
    taskSmsLines.push(`Due: ${taskDue}`)
  }

  const taskAddress = [
    task?.job_address1,
    task?.job_city,
    task?.job_state,
    task?.job_zip,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ")

  if (taskAddress) {
    taskSmsLines.push(`Address: ${taskAddress}`)
  }

  const taskCustomerPhone = String(
    task?.customer_phone || ""
  ).trim()

  if (taskCustomerPhone) {
    taskSmsLines.push(`Phone: ${taskCustomerPhone}`)
  }

  const taskNotes = String(task?.notes || "").trim()

  if (taskNotes) {
    taskSmsLines.push(`Note: ${taskNotes}`)
  }

  const enrichedTaskSmsBody = taskSmsLines.join("\n")

await sendSMS(
      String(task.mobile_phone),
      enrichedTaskSmsBody
    )

    return
  }

  if (now.getTime() <= endTime.getTime()) {
    return
  }

  const overdueDays = Math.max(
    1,
    Math.floor(
      (now.getTime() - endTime.getTime()) /
        (24 * 60 * 60 * 1000)
    ) + 1
  )

  await sendSMS(
    String(task.mobile_phone),
    `Navigator overdue task: ${
      task.title || "Task"
    } is ${overdueDays} day${
      overdueDays === 1 ? "" : "s"
    } overdue.`
  )

  await scheduleNextTaskOverdueReminder(
    Number(action.tenant_id),
    taskId,
    now
  )
}

async function runAction(action: ScheduledActionRow) {
  if (action.action_key === "task_sms_reminder") {
    await runTaskSmsReminder(action)
    return
  }


  const tenantId = action.tenant_id;
  const jobId = action.job_id;

  await timeline(tenantId, jobId, "scheduled_action_run", `${action.action_key} (job_id=${jobId})`, {
    action_id: action.id,
    run_at: action.run_at,
  });

  if (action.action_key === "workflow_step") {
    await runWorkflowStep(action);
  } else if (
    action.action_key ===
    "initial_external_response"
  ) {
    await runInitialExternalResponse(action);
  } else if (
    action.action_key ===
    "user_invitation_expiration"
  ) {
    await runUserInvitationExpiration(
      action
    );
  } else if (
    action.action_key ===
    "g2g_estimate_needed_reminder"
  ) {
    await runG2gEstimateNeededReminder(
      action
    );
  } else {
    throw new Error(
      `Unsupported scheduled action: ${action.action_key}`
    )
  }

  await timeline(tenantId, jobId, "scheduled_action_done", `${action.action_key} (job_id=${jobId})`, {
    action_id: action.id,
  });
}

export async function schedulerTickEms(
  limit = 25
) {
  if (isQuietHours()) {
    const delayed =
      await pushDueEmsActionsToQuietHoursEnd(limit)

    if (delayed > 0) {
      console.log(
        `Quiet hours active — delayed ${delayed} EMS scheduled actions until 7 AM Eastern`
      )
    }

    return {
      ok: true,
      delayed,
      quiet_hours: true,
      lane: "ems_claims",
    }
  }

  const actions =
    await claimDueEmsActions(limit)

  for (const action of actions) {
    try {
      await runAction(action)
      await markDone(action.id)

      await reportNavigatorRecovery({
        component: "ems_scheduler",
        where: "scheduled action execution",
        tenantId: action.tenant_id,
        jobId: action.job_id,
        actionId: action.id,
      })
    } catch (err: any) {
      await timeline(
        action.tenant_id,
        action.job_id,
        "scheduled_action_failed",
        "EMS scheduler error",
        {
          error: String(
            err?.message || err
          ),
          action_id: action.id,
          scheduler_lane:
            "ems_claims",
        }
      )

      await markFailed(
        action.id,
        err
      )

      await reportNavigatorFailure({
        component: "ems_scheduler",
        where: "scheduled action execution",
        error: err,
        tenantId: action.tenant_id,
        jobId: action.job_id,
        actionId: action.id,
      })
    }
  }

  return {
    ok: true,
    processed: actions.length,
    quiet_hours: false,
    lane: "ems_claims",
  }
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

      await reportNavigatorRecovery({
        component: "general_scheduler",
        where: "scheduled action execution",
        tenantId: action.tenant_id,
        jobId: action.job_id,
        actionId: action.id,
      });
    } catch (err: any) {
      await timeline(action.tenant_id, action.job_id, "scheduled_action_failed", "scheduler error", {
        error: String(err?.message || err),
        action_id: action.id,
      });
      await markFailed(action.id, err);

      await reportNavigatorFailure({
        component: "general_scheduler",
        where: "scheduled action execution",
        error: err,
        tenantId: action.tenant_id,
        jobId: action.job_id,
        actionId: action.id,
      });
    }
  }
}
