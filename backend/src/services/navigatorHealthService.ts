import { pool } from "../db/db"
import { sendAlertEmail } from "./emailService"

type HealthContext = {
  component: string
  where: string
  error?: unknown
  tenantId?: number | null
  jobId?: number | null
  actionId?: number | null
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    return error.stack || error.message
  }

  return String(error || "Unknown error")
}

function alertEmailTo() {
  return process.env.ALERT_EMAIL_TO || ""
}

async function latestHealthEvent(component: string) {
  const result = await pool.query(
    `
    select
      id,
      event_type,
      metadata,
      created_at
    from system_events
    where entity_type = 'navigator_health'
      and metadata->>'component' = $1
      and event_type in (
        'navigator_health_failure',
        'navigator_health_recovered'
      )
    order by created_at desc, id desc
    limit 1
    `,
    [component]
  )

  return result.rows[0] || null
}

async function writeHealthEvent(
  eventType: "navigator_health_failure" | "navigator_health_recovered",
  context: HealthContext,
  reason: string | null
) {
  await pool.query(
    `
    insert into system_events (
      event_type,
      entity_type,
      entity_id,
      metadata,
      created_at
    )
    values (
      $1,
      'navigator_health',
      $2,
      $3::jsonb,
      now()
    )
    `,
    [
      eventType,
      context.jobId ?? context.actionId ?? null,
      JSON.stringify({
        component: context.component,
        where: context.where,
        reason,
        tenant_id: context.tenantId ?? null,
        job_id: context.jobId ?? null,
        action_id: context.actionId ?? null,
      }),
    ]
  )
}

export async function reportNavigatorFailure(
  context: HealthContext
) {
  const reason = errorText(context.error)
  const previous = await latestHealthEvent(context.component)

  /*
   * Persist every actual failure so Ops Intel retains where / when / why.
   */
  await writeHealthEvent(
    "navigator_health_failure",
    context,
    reason
  )

  /*
   * Do not spam Steve with the same continuing component outage.
   * A new email is sent after recovery if the component fails again.
   */
  if (previous?.event_type === "navigator_health_failure") {
    return
  }

  const to = alertEmailTo()

  if (!to) {
    console.error(
      "Navigator health alert email unavailable: ALERT_EMAIL_TO missing",
      {
        component: context.component,
        where: context.where,
        reason,
      }
    )
    return
  }

  const body =
    `NAVIGATOR AUTOMATION FAILURE\n\n` +
    `Component: ${context.component}\n` +
    `Where: ${context.where}\n` +
    `When: ${new Date().toISOString()}\n` +
    `Why: ${reason}\n` +
    `Tenant ID: ${context.tenantId ?? "N/A"}\n` +
    `Job ID: ${context.jobId ?? "N/A"}\n` +
    `Action ID: ${context.actionId ?? "N/A"}\n\n` +
    `Navigator recorded this failure in system_events for operational reporting.`

  try {
    await sendAlertEmail(
      to,
      `Navigator Failure — ${context.component}`,
      body
    )
  } catch (alertError) {
    /*
     * Health monitoring must never interfere with the underlying
     * Navigator process it observes.
     */
    console.error(
      "Navigator health alert email failed",
      alertError
    )
  }
}

export async function reportNavigatorRecovery(
  context: Omit<HealthContext, "error">
) {
  const previous = await latestHealthEvent(context.component)

  /*
   * Normal success is silent.
   * Recovery exists only when the immediately preceding health state
   * for this component was failure.
   */
  if (previous?.event_type !== "navigator_health_failure") {
    return
  }

  await writeHealthEvent(
    "navigator_health_recovered",
    context,
    null
  )

  const to = alertEmailTo()

  if (!to) return

  const body =
    `NAVIGATOR AUTOMATION RECOVERED\n\n` +
    `Component: ${context.component}\n` +
    `Where: ${context.where}\n` +
    `Recovered: ${new Date().toISOString()}\n` +
    `Tenant ID: ${context.tenantId ?? "N/A"}\n` +
    `Job ID: ${context.jobId ?? "N/A"}\n` +
    `Action ID: ${context.actionId ?? "N/A"}\n\n` +
    `Navigator successfully completed this automation path after the prior failure.`

  try {
    await sendAlertEmail(
      to,
      `Navigator Recovered — ${context.component}`,
      body
    )
  } catch (alertError) {
    console.error(
      "Navigator recovery email failed",
      alertError
    )
  }
}
