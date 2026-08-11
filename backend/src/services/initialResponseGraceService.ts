import { pool } from "../db/db"

export const INITIAL_EXTERNAL_RESPONSE_GRACE_MINUTES = 5

export type InitialExternalResponseKind =
  | "sales_customer_acknowledgment"
  | "ems_document_package"

export async function queueInitialExternalResponse(params: {
  tenantId: number
  jobId: number
  kind: InitialExternalResponseKind
  payload: Record<string, any>
}) {
  const {
    tenantId,
    jobId,
    kind,
    payload,
  } = params

  const result = await pool.query(
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
        'initial_external_response',
        now() + interval '5 minutes',
        'pending',
        $3::jsonb,
        now(),
        now()
      )
    returning
      id,
      tenant_id,
      job_id,
      action_key,
      run_at,
      status,
      payload
    `,
    [
      tenantId,
      jobId,
      JSON.stringify({
        kind,
        grace_minutes:
          INITIAL_EXTERNAL_RESPONSE_GRACE_MINUTES,
        ...payload,
      }),
    ]
  )

  return result.rows[0]
}
