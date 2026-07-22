import { pool } from "../db/db"
import { sendAlertEmail } from "./emailService"

export type BusinessDevelopmentSource =
  | "manual_office_entry"
  | "manual_office_email"
  | "universal_outreach_reply"

export type BusinessDevelopmentIntakeInput = {
  tenantSlug: string
  source: BusinessDevelopmentSource
  sourceDetail?: string | null
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  address1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  notes?: string | null
  externalReference?: string | null
}

type IntakeResult = {
  ok: true
  action: "created_job" | "updated_existing_job"
  tenant_id: number
  customer_id: number
  job_id: number
  source: BusinessDevelopmentSource
}

function clean(value: unknown): string | null {
  if (value === undefined || value === null) return null

  const result = String(value).trim()
  return result.length ? result : null
}

function sourceLabel(source: BusinessDevelopmentSource): string {
  if (source === "universal_outreach_reply") {
    return "Universal Outreach"
  }

  if (source === "manual_office_email") {
    return "Manual Office Email"
  }

  return "Manual Office Entry"
}

async function getTenantIdBySlug(
  client: any,
  tenantSlug: string
): Promise<number> {
  const result = await client.query(
    `select id from tenants where slug = $1 limit 1`,
    [tenantSlug]
  )

  if (!result.rowCount) {
    throw new Error(`tenant not found: ${tenantSlug}`)
  }

  return Number(result.rows[0].id)
}

async function reportOwnerControlsActivity(payload: {
  tenantSlug: string
  jobId: number
  customerId: number
  source: BusinessDevelopmentSource
  action: "created_job" | "updated_existing_job"
  customerName: string | null
  address1: string | null
}) {
  const gatewaySecret =
    process.env.AA_ACTIVITY_GATEWAY_SECRET || ""

  if (!gatewaySecret) {
    console.warn(
      "Skipping BDI Owner Controls activity: missing AA_ACTIVITY_GATEWAY_SECRET"
    )
    return {
      ok: false,
      skipped: true,
      reason: "missing_gateway_secret",
    }
  }

  const gatewayUrl =
    process.env.AA_ACTIVITY_GATEWAY_URL ||
    "https://actual-assistant-owner-controls.vercel.app/api/record-activity"

  try {
    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-aa-activity-secret": gatewaySecret,
        "x-aa-gateway-secret": gatewaySecret,
        Authorization: `Bearer ${gatewaySecret}`,
      },
      body: JSON.stringify({
        tenant_slug: payload.tenantSlug,
        tenantSlug: payload.tenantSlug,
        activity_type: "business_opportunity_received",
        event_type: "business_opportunity_received",
        title: "Business Opportunity Received",
        description:
          payload.action === "created_job"
            ? `Business Development Intake created Navigator job #${payload.jobId}.`
            : `Business Development Intake updated existing Navigator job #${payload.jobId}.`,
        source: payload.source,
        job_id: payload.jobId,
        customer_id: payload.customerId,
        customer_name: payload.customerName,
        property_address: payload.address1,
        metadata: {
          source: payload.source,
          action: payload.action,
          job_id: payload.jobId,
          customer_id: payload.customerId,
        },
      }),
    })

    if (!response.ok) {
      const responseText = await response.text().catch(() => "")
      console.warn(
        "BDI Owner Controls activity failed:",
        response.status,
        responseText
      )

      return {
        ok: false,
        status: response.status,
      }
    }

    return {
      ok: true,
    }
  } catch (error: any) {
    console.warn(
      "BDI Owner Controls activity error:",
      error?.message || String(error)
    )

    return {
      ok: false,
      error: error?.message || String(error),
    }
  }
}

async function notifyStaff(
  result: IntakeResult,
  input: BusinessDevelopmentIntakeInput
) {
  const recipient = clean(process.env.ALERT_EMAIL_TO)

  if (!recipient) {
    console.warn(
      "Skipping BDI staff notification: missing ALERT_EMAIL_TO"
    )

    return {
      ok: false,
      skipped: true,
      reason: "missing_alert_email_to",
    }
  }

  const customerName =
    clean(input.customerName) || "Unknown customer"

  const address =
    [
      clean(input.address1),
      clean(input.city),
      clean(input.state),
      clean(input.zip),
    ]
      .filter(Boolean)
      .join(", ") || "No property address supplied"

  const actionText =
    result.action === "created_job"
      ? `Created Navigator job #${result.job_id}`
      : `Updated existing Navigator job #${result.job_id}`

  const text = [
    "A business development opportunity was processed.",
    "",
    `Action: ${actionText}`,
    `Source: ${sourceLabel(result.source)}`,
    `Source Detail: ${clean(input.sourceDetail) || "Not supplied"}`,
    `Customer: ${customerName}`,
    `Phone: ${clean(input.customerPhone) || "Not supplied"}`,
    `Email: ${clean(input.customerEmail) || "Not supplied"}`,
    `Property: ${address}`,
    `Notes: ${clean(input.notes) || "None"}`,
  ].join("\n")

  return sendAlertEmail(
    recipient,
    `Business Opportunity: ${customerName}`,
    text
  )
}

function buildVisibleAdministrativeNote(
  input: BusinessDevelopmentIntakeInput,
  action: "created_job" | "updated_existing_job"
): string {
  const lines = [
    "Manual Office Email received and processed by the Receptionist / Administrative Assistant.",
    action === "created_job"
      ? "Navigator job created."
      : "Existing Navigator job updated.",
  ]

  const sourceDetail = clean(input.sourceDetail)
  const customerName = clean(input.customerName)
  const customerPhone = clean(input.customerPhone)
  const customerEmail = clean(input.customerEmail)
  const address1 = clean(input.address1)
  const city = clean(input.city)
  const state = clean(input.state)
  const zip = clean(input.zip)
  const notes = clean(input.notes)

  if (sourceDetail) {
    lines.push(`Subject: ${sourceDetail}`)
  }

  if (customerName && customerName !== "Unknown Customer") {
    lines.push(`Customer: ${customerName}`)
  }

  if (customerPhone) {
    lines.push(`Phone: ${customerPhone}`)
  }

  if (customerEmail) {
    lines.push(`Email: ${customerEmail}`)
  }

  const locality = [
    city,
    state,
    zip,
  ]
    .filter(Boolean)
    .join(" ")

  if (address1) {
    lines.push(
      locality
        ? `Property: ${address1}, ${locality}`
        : `Property: ${address1}`
    )
  } else if (locality) {
    lines.push(`Property location: ${locality}`)
  }

  if (notes) {
    lines.push("", notes)
  }

  return lines.join("\n")
}

export async function processBusinessDevelopmentIntake(
  rawInput: BusinessDevelopmentIntakeInput
): Promise<IntakeResult> {
  const input: BusinessDevelopmentIntakeInput = {
    tenantSlug: clean(rawInput.tenantSlug) || "",
    source: rawInput.source,
    sourceDetail: clean(rawInput.sourceDetail),
    customerName:
      clean(rawInput.customerName) ||
      "Unknown Customer",
    customerPhone: clean(rawInput.customerPhone),
    customerEmail: clean(rawInput.customerEmail),
    address1: clean(rawInput.address1),
    city: clean(rawInput.city),
    state: clean(rawInput.state) || "FL",
    zip: clean(rawInput.zip),
    notes: clean(rawInput.notes),
    externalReference: clean(rawInput.externalReference),
  }

  if (!input.tenantSlug) {
    throw new Error("tenantSlug required")
  }

  if (
    input.source !== "manual_office_entry" &&
    input.source !== "manual_office_email" &&
    input.source !== "universal_outreach_reply"
  ) {
    throw new Error("unsupported business development source")
  }

  const client = await pool.connect()

  let result: IntakeResult

  try {
    await client.query("begin")

    const tenantId = await getTenantIdBySlug(
      client,
      input.tenantSlug
    )

    let existingJob: any = null

    if (input.address1) {
      const existingJobResult = await client.query(
        `
        select
          j.id,
          j.customer_id,
          j.stage
        from jobs j
        where j.tenant_id = $1
          and lower(trim(j.address1)) = lower(trim($2))
          and coalesce(j.stage, '') not in (
            'archived',
            'disqualified',
            'paid'
          )
        order by j.updated_at desc nulls last, j.id desc
        limit 1
        `,
        [tenantId, input.address1]
      )

      existingJob =
        existingJobResult.rowCount
          ? existingJobResult.rows[0]
          : null
    }

    if (existingJob) {
      const jobId = Number(existingJob.id)
      const customerId = Number(existingJob.customer_id)

      await client.query(
        `
        update jobs
        set
          updated_at = now(),
          lead_source = coalesce(lead_source, $3),
          lead_source_detail = coalesce(
            lead_source_detail,
            $4
          )
        where tenant_id = $1
          and id = $2
        `,
        [
          tenantId,
          jobId,
          sourceLabel(input.source),
          input.sourceDetail || input.source,
        ]
      )

      await client.query(
        `
        insert into timeline_events
          (
            tenant_id,
            job_id,
            kind,
            message,
            meta
          )
        values
          (
            $1,
            $2,
            'business_development_intake',
            $3,
            $4
          )
        `,
        [
          tenantId,
          jobId,
          `Business development opportunity received from ${sourceLabel(input.source)}.`,
          JSON.stringify({
            source: input.source,
            source_detail:
              input.sourceDetail || input.source,
            action: "updated_existing_job",
            customer_name: input.customerName,
            customer_phone: input.customerPhone,
            customer_email: input.customerEmail,
            address1: input.address1,
            city: input.city,
            state: input.state,
            zip: input.zip,
            notes: input.notes,
            external_reference:
              input.externalReference,
          }),
        ]
      )

      await client.query(
        `
        insert into timeline_events
          (
            tenant_id,
            job_id,
            kind,
            message,
            meta,
            created_at
          )
        values
          (
            $1,
            $2,
            'staff_note',
            $3,
            $4::jsonb,
            now()
          )
        `,
        [
          tenantId,
          jobId,
          buildVisibleAdministrativeNote(
            input,
            "updated_existing_job"
          ),
          JSON.stringify({
            source: input.source,
            source_detail:
              input.sourceDetail || input.source,
            action: "updated_existing_job",
            generated_by:
              "receptionist_administrative_assistant",
            external_reference:
              input.externalReference,
          }),
        ]
      )

      result = {
        ok: true,
        action: "updated_existing_job",
        tenant_id: tenantId,
        customer_id: customerId,
        job_id: jobId,
        source: input.source,
      }
    } else {
      const customerResult = await client.query(
        `
        insert into customers
          (
            tenant_id,
            full_name,
            phone,
            email,
            created_at,
            updated_at
          )
        values
          (
            $1,
            $2,
            $3,
            $4,
            now(),
            now()
          )
        returning id
        `,
        [
          tenantId,
          input.customerName,
          input.customerPhone,
          input.customerEmail,
        ]
      )

      const customerId = Number(
        customerResult.rows[0].id
      )

      const jobResult = await client.query(
        `
        insert into jobs
          (
            tenant_id,
            customer_id,
            external_crm,
            external_job_id,
            external_customer_id,
            external_customer_name,
            customer_phone,
            customer_email,
            stage,
            job_type,
            address1,
            city,
            state,
            zip,
            lead_source,
            lead_source_detail,
            created_at,
            updated_at
          )
        values
          (
            $1,
            $2,
            'business_development_intake',
            $3,
            $4,
            $5,
            $6,
            $7,
            'lead',
            'inspection',
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            now(),
            now()
          )
        returning id
        `,
        [
          tenantId,
          customerId,
          input.externalReference ||
            `bdi-${Date.now()}`,
          String(customerId),
          input.customerName,
          input.customerPhone,
          input.customerEmail,
          input.address1,
          input.city,
          input.state,
          input.zip,
          sourceLabel(input.source),
          input.sourceDetail || input.source,
        ]
      )

      const jobId = Number(jobResult.rows[0].id)

      await client.query(
        `
        insert into timeline_events
          (
            tenant_id,
            job_id,
            kind,
            message,
            meta
          )
        values
          (
            $1,
            $2,
            'business_development_intake',
            $3,
            $4
          )
        `,
        [
          tenantId,
          jobId,
          `Business development opportunity received from ${sourceLabel(input.source)} and Navigator job created.`,
          JSON.stringify({
            source: input.source,
            source_detail:
              input.sourceDetail || input.source,
            action: "created_job",
            customer_name: input.customerName,
            customer_phone: input.customerPhone,
            customer_email: input.customerEmail,
            address1: input.address1,
            city: input.city,
            state: input.state,
            zip: input.zip,
            notes: input.notes,
            external_reference:
              input.externalReference,
          }),
        ]
      )

      await client.query(
        `
        insert into timeline_events
          (
            tenant_id,
            job_id,
            kind,
            message,
            meta,
            created_at
          )
        values
          (
            $1,
            $2,
            'staff_note',
            $3,
            $4::jsonb,
            now()
          )
        `,
        [
          tenantId,
          jobId,
          buildVisibleAdministrativeNote(
            input,
            "created_job"
          ),
          JSON.stringify({
            source: input.source,
            source_detail:
              input.sourceDetail || input.source,
            action: "created_job",
            generated_by:
              "receptionist_administrative_assistant",
            external_reference:
              input.externalReference,
          }),
        ]
      )

      result = {
        ok: true,
        action: "created_job",
        tenant_id: tenantId,
        customer_id: customerId,
        job_id: jobId,
        source: input.source,
      }
    }

    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }

  const [staffNotification, ownerControls] =
    await Promise.all([
      notifyStaff(result, input),
      reportOwnerControlsActivity({
        tenantSlug: input.tenantSlug,
        jobId: result.job_id,
        customerId: result.customer_id,
        source: result.source,
        action: result.action,
        customerName: input.customerName || null,
        address1: input.address1 || null,
      }),
    ])

  return {
    ...result,
    staff_notification: staffNotification,
    owner_controls: ownerControls,
  } as IntakeResult
}
