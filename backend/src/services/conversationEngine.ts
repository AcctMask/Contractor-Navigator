import { pool } from "../db/db";

/*
 conversationEngine

 Compatibility entry point for existing callers.

 Job lifecycle selection is centralized in the jobs database trigger.
 Developer Settings control all follow-up messages and timing.
 This function no longer creates hardcoded scheduled_actions.
*/

export async function planFollowUps(params: {
  tenant_id: number;
  job_id: number;
  stage: string;
  occurred_at?: string;
}) {
  const { tenant_id, job_id, stage } = params;

  await pool.query(
    `
    update jobs
       set stage = $3,
           updated_at = now()
     where tenant_id = $1
       and id = $2
    `,
    [tenant_id, job_id, stage]
  );
}
