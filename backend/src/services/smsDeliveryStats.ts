import { pool } from "../db/db"
import { SMS_RETRY_POLICY_VERSION } from "./smsDeliveryPolicy"

export type SmsFailureStreak = {
  count: number
  last_failure_at: string | null
}

/**
 * Reads only new-policy Twilio send failures for the current workflow and stage.
 * A successful outbound SMS resets the streak. No schema migration is required.
 * Existing July/August historical failures remain reportable but cannot pause
 * healthy present-day follow-ups retroactively.
 */
export async function getSmsFailureStreak(
  tenantId: number,
  jobId: number,
  stage: string,
  workflowStartedAt: string | null
): Promise<SmsFailureStreak> {
  const result = await pool.query(
    `
    select
      count(*)::int as count,
      max(f.created_at) as last_failure_at
    from timeline_events f
    where f.tenant_id = $1
      and f.job_id = $2
      and f.kind = 'ai_message_send_failed'
      and coalesce(f.meta->>'stage','') = $3
      and f.meta->>'sms_retry_policy' = $5
      and ($4::timestamptz is null or f.created_at >= $4::timestamptz)
      and f.id > coalesce((
        select max(s.id)
        from timeline_events s
        where s.tenant_id = $1
          and s.job_id = $2
          and s.kind = 'ai_message_sent'
          and coalesce(s.meta->>'stage','') = $3
          and ($4::timestamptz is null or s.created_at >= $4::timestamptz)
      ), 0)
    `,
    [tenantId, jobId, stage, workflowStartedAt, SMS_RETRY_POLICY_VERSION]
  )
  return {
    count: Number(result.rows[0]?.count || 0),
    last_failure_at: result.rows[0]?.last_failure_at || null,
  }
}
