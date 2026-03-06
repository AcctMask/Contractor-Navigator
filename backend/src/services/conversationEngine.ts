import { pool } from "../db/db";

/*
 conversationEngine

 This service schedules follow-up workflow actions when a job
 enters certain stages.

 Scheduler later executes the actions.
*/

export async function planFollowUps(params: {
  tenant_id: number;
  job_id: number;
  stage: string;
  occurred_at?: string;
}) {

  const { tenant_id, job_id, stage } = params;

  // Only run automation for estimate stage for now
  if (stage !== "estimate_sent") {
    return;
  }

  const steps = [

    {
      delay_hours: 0,
      step_order: 1,
      message:
        "Hi {{name}}, just confirming you received the estimate. Let me know if you'd like to review options.",
    },

    {
      delay_hours: 24,
      step_order: 2,
      message:
        "Hi {{name}}, just checking in to see if you had any questions about the estimate.",
    },

    {
      delay_hours: 72,
      step_order: 3,
      message:
        "Hi {{name}}, wanted to follow up again regarding the estimate. I'm happy to review details with you.",
    },

    {
      delay_hours: 96,
      step_order: 4,
      message:
        "Hi {{name}}, I don't want to bother you. If now isn't the right time just let me know.",
    },

  ];

  for (const step of steps) {

    await pool.query(

      `
      insert into scheduled_actions
      (tenant_id, job_id, action_key, run_at, status, payload, created_at, updated_at)
      values
      (
        $1,
        $2,
        'workflow_step',
        now() + ($3 || ' hours')::interval,
        'pending',
        $4::jsonb,
        now(),
        now()
      )
      `,
      [
        tenant_id,
        job_id,
        step.delay_hours,
        JSON.stringify({
          workflow_key: "estimate_followup",
          step_order: step.step_order,
          channel: "sms",
          message_template: step.message
        })
      ]
    );

  }

}
