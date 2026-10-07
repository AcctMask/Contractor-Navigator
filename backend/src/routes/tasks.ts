import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { getCurrentUserFromToken } from "../services/authService"
import { sendSMS } from "../services/twilioService"

function getBearerToken(request: any) {
  const auth = String(request.headers.authorization || "")
  return auth.startsWith("Bearer ") ? auth.slice(7) : ""
}

async function requireTaskUser(
  request: any,
  reply: any,
  tenantId: number
) {
  const token = getBearerToken(request)

  if (!token) {
    reply.code(401)
    return null
  }

  try {
    const user = await getCurrentUserFromToken(token)

    if (!user?.is_active) {
      reply.code(401)
      return null
    }

    if (
      String(user.role) !== "platform_owner" &&
      Number(user.tenant_id) !== tenantId
    ) {
      reply.code(403)
      return null
    }

    return user
  } catch {
    reply.code(401)
    return null
  }
}

async function subcontractorCanAccessTask(
  tenantId: number,
  userId: number,
  task: {
    job_id?: number | null
    assigned_user_id?: number | null
  }
): Promise<boolean> {
  if (Number(task.assigned_user_id) === userId) {
    return true
  }

  const jobId = Number(task.job_id)

  if (!jobId) {
    return false
  }

  const assignment = await pool.query(
    `
    select id
    from crew_assignments
    where tenant_id = $1
      and job_id = $2
      and app_user_id = $3
    limit 1
    `,
    [tenantId, jobId, userId]
  )

  return Boolean(assignment.rowCount)
}

function taskActorMeta(user: any) {
  return {
    actor_name:
      user?.full_name ||
      user?.email ||
      "User",
    actor_email:
      user?.email ||
      null,
    actor_user_id:
      user?.id ||
      null,
  }
}

async function ensureTaskTable() {
  await pool.query(`
    create table if not exists task_items (
      id bigserial primary key,
      tenant_id bigint null references tenants(id) on delete cascade,
      job_id bigint null references jobs(id) on delete set null,
      title text not null default 'Calendar Event',
      start_time timestamptz not null,
      end_time timestamptz null,
      location text null,
      notes text null,
      event_type text not null default 'general',
      stage_classification text null,
      assigned_user_id bigint null references app_users(id) on delete set null,
      completed_at timestamptz null,
      completed_by_user_id bigint null references app_users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)

  await pool.query(`
    alter table task_items
      add column if not exists tenant_id bigint null,
      add column if not exists job_id bigint null,
      add column if not exists title text not null default 'Calendar Event',
      add column if not exists start_time timestamptz,
      add column if not exists end_time timestamptz null,
      add column if not exists location text null,
      add column if not exists notes text null,
      add column if not exists event_type text not null default 'general',
      add column if not exists stage_classification text null,
      add column if not exists assigned_user_id bigint null,
      add column if not exists completed_at timestamptz null,
      add column if not exists completed_by_user_id bigint null,
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now()
  `)
}

async function getTenantIdBySlug(slug: string): Promise<number> {
  const result = await pool.query(
    `select id from tenants where slug = $1 limit 1`,
    [slug]
  )

  if (!result.rowCount) {
    throw new Error(`Tenant not found: ${slug}`)
  }

  return Number(result.rows[0].id)
}


const TASK_SMS_ACTION_KEY = "task_sms_reminder"

async function cancelPendingTaskSmsActions(
  tenantId: number,
  taskId: number
) {
  await pool.query(
    `
    update scheduled_actions
    set status = 'cancelled',
        updated_at = now()
    where tenant_id = $1
      and action_key = $2
      and status = 'pending'
      and payload->>'task_id' = $3
    `,
    [tenantId, TASK_SMS_ACTION_KEY, String(taskId)]
  )
}

async function scheduleTaskSmsAction(
  tenantId: number,
  taskId: number,
  reminderType: "due_24h" | "overdue",
  runAt: Date
) {
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
      $2,
      $3,
      'pending',
      $4::jsonb,
      now(),
      now()
    )
    `,
    [
      tenantId,
      TASK_SMS_ACTION_KEY,
      runAt.toISOString(),
      JSON.stringify({
        task_id: taskId,
        reminder_type: reminderType,
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

function nextApproxNineAmEastern(endTime: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(endTime)

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

async function rebuildTaskSmsLifecycle(
  tenantId: number,
  taskId: number
) {
  await cancelPendingTaskSmsActions(tenantId, taskId)

  const result = await pool.query(
    `
    select
      id,
      assigned_user_id,
      completed_at,
      end_time
    from task_items
    where tenant_id = $1
      and id = $2
    limit 1
    `,
    [tenantId, taskId]
  )

  if (!result.rowCount) return

  const task = result.rows[0]

  if (
    task.completed_at ||
    !task.assigned_user_id ||
    !task.end_time
  ) {
    return
  }

  const endTime = new Date(task.end_time)

  if (!Number.isFinite(endTime.getTime())) return

  const now = Date.now()
  const due24 = new Date(endTime.getTime() - 24 * 60 * 60 * 1000)

  if (due24.getTime() > now) {
    await scheduleTaskSmsAction(
      tenantId,
      taskId,
      "due_24h",
      due24
    )
  }

  const overdueRunAt = nextApproxNineAmEastern(endTime)

  if (overdueRunAt.getTime() > now) {
    await scheduleTaskSmsAction(
      tenantId,
      taskId,
      "overdue",
      overdueRunAt
    )
  } else if (endTime.getTime() < now) {
    await scheduleTaskSmsAction(
      tenantId,
      taskId,
      "overdue",
      new Date(now)
    )
  }
}

function formatTaskDueTime(value: any) {
  if (!value) return ""

  const date = new Date(value)

  if (!Number.isFinite(date.getTime())) return ""

  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}


async function getTaskSmsJobContext(
  tenantId: number,
  task: any
) {
  const jobId = Number(task?.job_id)

  if (!Number.isFinite(jobId) || jobId <= 0) {
    return null
  }

  const result = await pool.query(
    `
    select
      j.id,
      j.external_job_id,
      j.address1,
      j.city,
      j.state,
      j.zip,
      c.full_name as customer_name,
      c.phone as customer_phone
    from jobs j
    left join customers c
      on c.id = j.customer_id
     and c.tenant_id = j.tenant_id
    where j.tenant_id = $1
      and j.id = $2
    limit 1
    `,
    [tenantId, jobId]
  )

  return result.rows[0] || null
}

function buildTaskSmsBody(
  heading: string,
  task: any,
  jobContext: any
) {
  const lines: string[] = [heading]

  const externalJobId = String(
    jobContext?.external_job_id || ""
  ).trim()

  const customerName = String(
    jobContext?.customer_name || ""
  ).trim()

  const jobIdentity = [
    externalJobId ? `Job #${externalJobId}` : "",
    customerName,
  ]
    .filter(Boolean)
    .join(" — ")

  if (jobIdentity) {
    lines.push(jobIdentity)
  }

  const title = String(task?.title || "").trim()

  if (title) {
    lines.push(`Task: ${title}`)
  }

  const due = formatTaskDueTime(task?.end_time)

  if (due) {
    lines.push(`Due: ${due}`)
  }

  const address = [
    jobContext?.address1,
    jobContext?.city,
    jobContext?.state,
    jobContext?.zip,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ")

  if (address) {
    lines.push(`Address: ${address}`)
  }

  const phone = String(
    jobContext?.customer_phone || ""
  ).trim()

  if (phone) {
    lines.push(`Phone: ${phone}`)
  }

  const notes = String(task?.notes || "").trim()

  if (notes) {
    lines.push(`Note: ${notes}`)
  }

  return lines.join("\n")
}

async function sendInitialTaskAssignmentSms(
  tenantId: number,
  task: any,
  assignedUser: any
) {
  const phone = String(assignedUser?.mobile_phone || "").trim()

  if (!phone) return

  const jobContext = await getTaskSmsJobContext(
    tenantId,
    task
  )

  const body = buildTaskSmsBody(
    "Navigator Task Assigned",
    task,
    jobContext
  )

  try {
    await sendSMS(phone, body)
  } catch (error) {
    console.error("[task-sms] assignment SMS failed", {
      taskId: task?.id,
      assignedUserId: assignedUser?.id,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    })
  }
}

export async function registerTaskRoutes(app: FastifyInstance) {
  await ensureTaskTable()

  app.get("/tasks/:tenantSlug/events", async (request: any, reply) => {
    try {
      await ensureTaskTable()

      const { tenantSlug } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)

      const actor = await requireTaskUser(request, reply, tenantId)

      if (!actor) {
        return { ok: false, error: "Unauthorized" }
      }

      const result = await pool.query(
        `
        select
          ce.id,
          ce.job_id,
          ce.title,
          ce.start_time,
          ce.end_time,
          ce.location,
          ce.notes,
          ce.event_type,
          ce.stage_classification,
          ce.assigned_user_id,
          au.full_name as assigned_user_name,
          au.mobile_phone as assigned_user_mobile_phone,
          ce.completed_at,
          ce.completed_by_user_id,
          cbu.full_name as completed_by_user_name,
          ce.created_at,
          ce.updated_at,
          c.full_name as customer_name,
          j.stage as job_stage,
          concat_ws(
            ', ',
            nullif(trim(j.address1), ''),
            nullif(trim(j.city), ''),
            nullif(trim(j.state), ''),
            nullif(trim(j.zip), '')
          ) as job_address
        from task_items ce
        left join jobs j
          on j.id = ce.job_id
         and j.tenant_id = ce.tenant_id
        left join customers c
          on c.id = j.customer_id
         and c.tenant_id = j.tenant_id
        left join app_users au
          on au.id = ce.assigned_user_id
         and au.tenant_id = ce.tenant_id
        left join app_users cbu
          on cbu.id = ce.completed_by_user_id
         and cbu.tenant_id = ce.tenant_id
        where ce.tenant_id = $1
          and (
            $2::text <> 'subcontractor'
            or ce.assigned_user_id = $3
            or exists (
              select 1
              from crew_assignments ca
              where ca.tenant_id = ce.tenant_id
                and ca.job_id = ce.job_id
                and ca.app_user_id = $3
            )
          )
        order by ce.start_time asc, ce.id asc
        `,
        [tenantId, String(actor.role), Number(actor.id)]
      )

      return {
        ok: true,
        events: result.rows,
      }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.post("/tasks/:tenantSlug/events", async (request: any, reply) => {
    try {
      await ensureTaskTable()

      const { tenantSlug } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const actor = await requireTaskUser(request, reply, tenantId)

      if (!actor) {
        return { ok: false, error: "Unauthorized" }
      }

      const body = request.body || {}

      if (!body.title) {
        reply.code(400)
        return { ok: false, error: "Title is required" }
      }

      if (!body.start_time) {
        reply.code(400)
        return { ok: false, error: "Start time is required" }
      }

      if (
        String(actor.role) === "subcontractor" &&
        body.job_id
      ) {
        const allowed = await subcontractorCanAccessTask(
          tenantId,
          Number(actor.id),
          {
            job_id: Number(body.job_id),
            assigned_user_id: null,
          }
        )

        if (!allowed) {
          reply.code(403)
          return { ok: false, error: "Not authorized for this job" }
        }
      }

      if (
        String(actor.role) === "subcontractor" &&
        body.assigned_user_id &&
        Number(body.assigned_user_id) !== Number(actor.id)
      ) {
        reply.code(403)
        return { ok: false, error: "Not authorized to assign this task to that user" }
      }

      let assignedUser: any = null

      if (body.assigned_user_id) {
        const assignedUserResult = await pool.query(
          `
          select id, full_name, email, mobile_phone
          from app_users
          where id = $1
            and tenant_id = $2
            and is_active = true
          limit 1
          `,
          [Number(body.assigned_user_id), tenantId]
        )

        if (!assignedUserResult.rowCount) {
          reply.code(400)
          return {
            ok: false,
            error: "Assigned user is not an active user for this tenant",
          }
        }

        assignedUser = assignedUserResult.rows[0]
      }

      const result = await pool.query(
        `
        insert into task_items (
          tenant_id,
          job_id,
          title,
          start_time,
          end_time,
          location,
          notes,
          event_type,
          stage_classification,
          assigned_user_id,
          created_at,
          updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now()
        )
        returning
          id,
          job_id,
          title,
          start_time,
          end_time,
          location,
          notes,
          event_type,
          stage_classification,
          assigned_user_id,
          completed_at,
          completed_by_user_id,
          created_at,
          updated_at
        `,
        [
          tenantId,
          body.job_id ? Number(body.job_id) : null,
          String(body.title),
          String(body.start_time),
          body.end_time ? String(body.end_time) : null,
          body.location || null,
          body.notes || null,
          body.event_type || "general",
          body.stage_classification || body.event_type || null,
          assignedUser ? Number(assignedUser.id) : null,
        ]
      )

      if (result.rows[0]?.job_id) {
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
          values ($1, $2, $3, $4, $5::jsonb, now())
          `,
          [
            tenantId,
            Number(result.rows[0].job_id),
            "task_created",
            `Task created by ${
              actor.full_name || actor.email || "User"
            }: ${result.rows[0].title}${
              assignedUser
                ? ` — Assigned to ${
                    assignedUser.full_name ||
                    assignedUser.email ||
                    "User"
                  }`
                : ""
            }`,
            JSON.stringify({
              ...taskActorMeta(actor),
              event_id: result.rows[0].id,
              event_type: result.rows[0].event_type,
              stage_classification: result.rows[0].stage_classification,
              assigned_user_id: result.rows[0].assigned_user_id,
              assigned_user_name:
                assignedUser?.full_name ||
                assignedUser?.email ||
                null,
              start_time: result.rows[0].start_time,
              end_time: result.rows[0].end_time,
              source: "task_ui",
            }),
          ]
        )
      }

      const createdTask = result.rows[0]

      if (createdTask?.id) {
        await rebuildTaskSmsLifecycle(
          tenantId,
          Number(createdTask.id)
        )

        if (assignedUser) {
          await sendInitialTaskAssignmentSms(
            tenantId,
            createdTask,
            assignedUser
          )
        }
      }

      return {
        ok: true,
        event: result.rows[0],
      }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })
  app.put("/tasks/:tenantSlug/events/:eventId", async (request: any, reply) => {
    try {
      await ensureTaskTable()

      const { tenantSlug, eventId } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const actor = await requireTaskUser(request, reply, tenantId)

      if (!actor) {
        return { ok: false, error: "Unauthorized" }
      }

      const body = request.body || {}

      const previousResult = await pool.query(
        `
        select
          id,
          job_id,
          title,
          start_time,
          end_time,
          location,
          notes,
          event_type,
          stage_classification,
          assigned_user_id,
          completed_at,
          completed_by_user_id,
          created_at,
          updated_at
        from task_items
        where tenant_id = $1
          and id = $2
        limit 1
        `,
        [tenantId, Number(eventId)]
      )

      if (!previousResult.rowCount) {
        reply.code(404)
        return { ok: false, error: "Task not found" }
      }

      if (
        String(actor.role) === "subcontractor" &&
        !(await subcontractorCanAccessTask(
          tenantId,
          Number(actor.id),
          previousResult.rows[0]
        ))
      ) {
        reply.code(403)
        return { ok: false, error: "Not authorized for this task" }
      }

      if (!body.title) {
        reply.code(400)
        return { ok: false, error: "Title is required" }
      }

      if (!body.start_time) {
        reply.code(400)
        return { ok: false, error: "Start time is required" }
      }

      const requestedAssignedUserId =
        body.assigned_user_id === undefined
          ? previousResult.rows[0].assigned_user_id
          : body.assigned_user_id
            ? Number(body.assigned_user_id)
            : null

      if (
        String(actor.role) === "subcontractor" &&
        requestedAssignedUserId &&
        Number(requestedAssignedUserId) !== Number(actor.id)
      ) {
        reply.code(403)
        return { ok: false, error: "Not authorized to assign this task to that user" }
      }

      let assignedUser: any = null

      if (requestedAssignedUserId) {
        const assignedUserResult = await pool.query(
          `
          select id, full_name, email, mobile_phone
          from app_users
          where id = $1
            and tenant_id = $2
            and is_active = true
          limit 1
          `,
          [requestedAssignedUserId, tenantId]
        )

        if (!assignedUserResult.rowCount) {
          reply.code(400)
          return {
            ok: false,
            error: "Assigned user is not an active user for this tenant",
          }
        }

        assignedUser = assignedUserResult.rows[0]
      }

      const result = await pool.query(
        `
        update task_items
        set
          title = $1,
          start_time = $2,
          end_time = $3,
          location = $4,
          notes = $5,
          event_type = $6,
          stage_classification = $7,
          assigned_user_id = $8,
          updated_at = now()
        where tenant_id = $9
          and id = $10
        returning
          id,
          job_id,
          title,
          start_time,
          end_time,
          location,
          notes,
          event_type,
          stage_classification,
          assigned_user_id,
          completed_at,
          completed_by_user_id,
          created_at,
          updated_at
        `,
        [
          String(body.title),
          String(body.start_time),
          body.end_time ? String(body.end_time) : null,
          body.location || null,
          body.notes || null,
          body.event_type || "general",
          body.stage_classification ||
            body.event_type ||
            previousResult.rows[0].stage_classification ||
            null,
          requestedAssignedUserId,
          tenantId,
          Number(eventId),
        ]
      )

      if (!result.rowCount) {
        reply.code(404)
        return { ok: false, error: "Task not found" }
      }

      const before = previousResult.rows[0]
      const after = result.rows[0]

      const startChanged =
        new Date(before.start_time).getTime() !== new Date(after.start_time).getTime()

      const endChanged =
        new Date(before.end_time || before.start_time).getTime() !==
        new Date(after.end_time || after.start_time).getTime()

      if (after.job_id && (startChanged || endChanged)) {
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
          values ($1, $2, $3, $4, $5::jsonb, now())
          `,
          [
            tenantId,
            Number(after.job_id),
            "task_rescheduled",
            `Task rescheduled by ${
              actor.full_name || actor.email || "User"
            }: ${after.title}`,
            JSON.stringify({
              ...taskActorMeta(actor),
              event_id: after.id,
              event_type: after.event_type,
              stage_classification: after.stage_classification,
              previous_start_time: before.start_time,
              previous_end_time: before.end_time,
              start_time: after.start_time,
              end_time: after.end_time,
              source: body.audit_source || "task_ui",
            }),
          ]
        )
      }

      await rebuildTaskSmsLifecycle(
        tenantId,
        Number(eventId)
      )

      return { ok: true, event: result.rows[0] }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.post("/tasks/:tenantSlug/events/:eventId/complete", async (request: any, reply) => {
    try {
      await ensureTaskTable()

      const { tenantSlug, eventId } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const actor = await requireTaskUser(request, reply, tenantId)

      if (!actor) {
        return { ok: false, error: "Unauthorized" }
      }

      const existingResult = await pool.query(
        `
        select
          id,
          job_id,
          title,
          assigned_user_id,
          completed_at,
          completed_by_user_id
        from task_items
        where tenant_id = $1
          and id = $2
        limit 1
        `,
        [tenantId, Number(eventId)]
      )

      if (!existingResult.rowCount) {
        reply.code(404)
        return { ok: false, error: "Task not found" }
      }

      const existingTask = existingResult.rows[0]

      if (
        String(actor.role) === "subcontractor" &&
        !(await subcontractorCanAccessTask(
          tenantId,
          Number(actor.id),
          existingTask
        ))
      ) {
        reply.code(403)
        return { ok: false, error: "Not authorized for this task" }
      }

      if (existingTask.completed_at) {
        return {
          ok: true,
          event: existingTask,
          already_completed: true,
        }
      }

      const result = await pool.query(
        `
        update task_items
        set
          completed_at = now(),
          completed_by_user_id = $1,
          updated_at = now()
        where tenant_id = $2
          and id = $3
          and completed_at is null
        returning
          id,
          job_id,
          title,
          assigned_user_id,
          completed_at,
          completed_by_user_id
        `,
        [Number(actor.id), tenantId, Number(eventId)]
      )

      if (!result.rowCount) {
        reply.code(409)
        return {
          ok: false,
          error: "Task completion state changed before this request completed",
        }
      }

      const completedTask = result.rows[0]

      if (completedTask.job_id) {
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
          values ($1, $2, $3, $4, $5::jsonb, now())
          `,
          [
            tenantId,
            Number(completedTask.job_id),
            "task_completed",
            `Task completed by ${
              actor.full_name || actor.email || "User"
            }: ${completedTask.title}`,
            JSON.stringify({
              ...taskActorMeta(actor),
              event_id: completedTask.id,
              assigned_user_id: completedTask.assigned_user_id,
              completed_at: completedTask.completed_at,
              completed_by_user_id:
                completedTask.completed_by_user_id,
              source: "task_ui",
            }),
          ]
        )
      }

      await cancelPendingTaskSmsActions(
        tenantId,
        Number(eventId)
      )

      return {
        ok: true,
        event: completedTask,
      }
    } catch (err: any) {
      reply.code(400)
      return {
        ok: false,
        error: err?.message || String(err),
      }
    }
  })

  app.delete("/tasks/:tenantSlug/events/:eventId", async (request: any, reply) => {
    try {
      await ensureTaskTable()

      const { tenantSlug, eventId } = request.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const actor = await requireTaskUser(request, reply, tenantId)

      if (!actor) {
        return { ok: false, error: "Unauthorized" }
      }

      const existingResult = await pool.query(
        `
        select id, job_id, assigned_user_id
        from task_items
        where tenant_id = $1
          and id = $2
        limit 1
        `,
        [tenantId, Number(eventId)]
      )

      if (!existingResult.rowCount) {
        reply.code(404)
        return { ok: false, error: "Task not found" }
      }

      if (
        String(actor.role) === "subcontractor" &&
        !(await subcontractorCanAccessTask(
          tenantId,
          Number(actor.id),
          existingResult.rows[0]
        ))
      ) {
        reply.code(403)
        return { ok: false, error: "Not authorized for this task" }
      }

      const result = await pool.query(
        `
        delete from task_items
        where tenant_id = $1
          and id = $2
        returning
          id,
          job_id,
          title,
          start_time,
          end_time,
          event_type
        `,
        [tenantId, Number(eventId)]
      )

      if (!result.rowCount) {
        reply.code(404)
        return { ok: false, error: "Task not found" }
      }

      const deleted = result.rows[0]

      if (deleted?.job_id) {
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
          values ($1, $2, $3, $4, $5::jsonb, now())
          `,
          [
            tenantId,
            Number(deleted.job_id),
            "task_deleted",
            `Task deleted by ${
              actor.full_name || actor.email || "User"
            }: ${deleted.title}`,
            JSON.stringify({
              ...taskActorMeta(actor),
              event_id: deleted.id,
              event_type: deleted.event_type,
              start_time: deleted.start_time,
              end_time: deleted.end_time,
              source: "task_ui",
            }),
          ]
        )
      }

      await cancelPendingTaskSmsActions(
        tenantId,
        Number(eventId)
      )

      return { ok: true, deleted_event_id: Number(eventId) }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })


}
// redeploy Wed May 13 08:39:41 EDT 2026
