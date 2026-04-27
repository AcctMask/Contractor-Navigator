import { pool } from "../db/db";

/*
 conversationEngine

 Handles ALL follow-up scheduling based on job stage
*/

export async function planFollowUps(params: {
  tenant_id: number;
  job_id: number;
  stage: string;
}) {
  const { tenant_id, job_id, stage } = params;

  // -----------------------------
  // ESTIMATE FOLLOW-UP
  // -----------------------------
  if (stage === "estimate_sent") {
    const steps = [
      { delay: 0, msg: "Hi {{name}}, just confirming you received the estimate." },
      { delay: 24, msg: "Checking if you have questions about the estimate." },
      { delay: 72, msg: "Following up again regarding your estimate." },
      { delay: 96, msg: "Final follow-up — let us know if you’d like to move forward." },
    ];

    await insertSteps(tenant_id, job_id, steps, "estimate_followup");
  }

  // -----------------------------
  // TARP COMPLETE → ROOF CONVERSION
  // -----------------------------
  if (stage === "tarp_complete") {
    const steps = [
      { delay: 0, msg: "Your tarp is complete. Next step is permanent repair options." },
      { delay: 24, msg: "Would you like help with insurance and roof replacement?" },
      { delay: 48, msg: "Tarps are temporary — we can help prevent further damage." },
      { delay: 96, msg: "Final follow-up — ready to move forward?" },
    ];

    await insertSteps(tenant_id, job_id, steps, "tarp_complete_roof_conversion");
  }

  // -----------------------------
  // 💰 INVOICE FOLLOW-UP (NEW)
  // -----------------------------
  if (stage === "invoiced") {
    const steps = [
      { delay: 0, msg: "Hi {{name}}, your invoice has been sent. Let us know if you need anything." },
      { delay: 24, msg: "Just checking in regarding your invoice. We can assist if needed." },
      { delay: 72, msg: "Friendly reminder regarding your invoice. Let us know if there are any issues." },
      { delay: 120, msg: "Final reminder — please let us know when we can expect payment." },
    ];

    await insertSteps(tenant_id, job_id, steps, "invoice_followup");
  }
}

async function insertSteps(
  tenant_id: number,
  job_id: number,
  steps: { delay: number; msg: string }[],
  workflow_key: string
) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    await pool.query(
      `
      insert into scheduled_actions
      (tenant_id, job_id, action_key, run_at, status, payload, created_at, updated_at)
      values
      ($1, $2, 'workflow_step', now() + ($3 || ' hours')::interval, 'pending', $4::jsonb, now(), now())
      `,
      [
        tenant_id,
        job_id,
        step.delay,
        JSON.stringify({
          workflow_key,
          step_order: i + 1,
          channel: "sms",
          message_template: step.msg,
        }),
      ]
    );
  }
}
