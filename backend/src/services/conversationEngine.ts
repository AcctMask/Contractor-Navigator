import { pool } from "../db/db"

type FollowUpStep = {
  delay_hours: number
  step_order: number
  message: string
}

const WORKFLOWS: Record<string, { workflow_key: string; steps: FollowUpStep[] }> = {

  lead: {
    workflow_key: "lead_followup",
    steps: [
      {
        delay_hours: 0,
        step_order: 1,
        message: "Hi {{name}}, this is Good2Go Roofing. We received your request and wanted to see how we can help.",
      },
      {
        delay_hours: 24,
        step_order: 2,
        message: "Just checking in {{name}} — do you still need help with your roof?",
      },
      {
        delay_hours: 72,
        step_order: 3,
        message: "Last follow-up {{name}} — if you still need help, just reply here and we’ll take care of you.",
      },
    ],
  },

  estimate_sent: {
    workflow_key: "estimate_followup",
    steps: [
      {
        delay_hours: 0,
        step_order: 1,
        message: "Hi {{name}}, just confirming you received the estimate. Want to review options together?",
      },
      {
        delay_hours: 24,
        step_order: 2,
        message: "Any questions on the estimate {{name}}? Happy to walk through it with you.",
      },
      {
        delay_hours: 72,
        step_order: 3,
        message: "Following up again {{name}} — we can lock in pricing and schedule when you're ready.",
      },
      {
        delay_hours: 96,
        step_order: 4,
        message: "No pressure {{name}} — just let me know if you'd like to move forward.",
      },
    ],
  },

  contract_sent: {
    workflow_key: "contract_followup",
    steps: [
      {
        delay_hours: 0,
        step_order: 1,
        message: "Hi {{name}}, we sent over your agreement. Let me know if you want me to walk you through it.",
      },
      {
        delay_hours: 24,
        step_order: 2,
        message: "Just checking in {{name}} — any questions before signing?",
      },
      {
        delay_hours: 72,
        step_order: 3,
        message: "We can get you scheduled right away once signed {{name}}. Let me know if you're ready.",
      },
    ],
  },

  tarp_complete: {
    workflow_key: "tarp_complete_roof_conversion",
    steps: [
      {
        delay_hours: 0,
        step_order: 1,
        message: "Hi {{name}}, your emergency tarp work is complete. The next step is reviewing the roof damage and options for permanent repair or replacement.",
      },
      {
        delay_hours: 24,
        step_order: 2,
        message: "Following up after the tarp {{name}} — would you like help with the insurance process and roof replacement?",
      },
      {
        delay_hours: 72,
        step_order: 3,
        message: "Tarps are temporary {{name}} — we can help move this toward a permanent solution before further damage occurs.",
      },
      {
        delay_hours: 168,
        step_order: 4,
        message: "Final follow-up {{name}} — if you want help converting this into a full roof project, just reply here.",
      },
    ],
  },

  final_paid: {
    workflow_key: "paid_referral_followup",
    steps: [
      {
        delay_hours: 24,
        step_order: 1,
        message: "Hi {{name}}, thank you again for trusting Good2Go Roofing. If you were happy, we’d really appreciate a quick review.",
      },
      {
        delay_hours: 72,
        step_order: 2,
        message: "Also {{name}}, if you know anyone needing roofing help, we’d take great care of them.",
      },
    ],
  },
}

export async function planFollowUps(params: {
  tenant_id: number
  job_id: number
  stage: string
  occurred_at?: string
}) {
  const { tenant_id, job_id, stage } = params

  const workflow = WORKFLOWS[stage]

  if (!workflow) return

  await pool.query(
    `
    delete from scheduled_actions
    where tenant_id = $1
      and job_id = $2
      and status = 'pending'
      and payload->>'workflow_key' = $3
    `,
    [tenant_id, job_id, workflow.workflow_key]
  )

  for (const step of workflow.steps) {
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
          workflow_key: workflow.workflow_key,
          step_order: step.step_order,
          channel: "sms",
          message_template: step.message,
          source: "planFollowUps",
        }),
      ]
    )
  }
}
