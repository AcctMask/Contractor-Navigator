import { runCommercialEmailScheduler } from "./service"

let commercialSchedulerStarted = false

const COMMERCIAL_POLL_MS = 1000 * 60 * 60 * 6
const DEFAULT_BATCH_SIZE = 15

async function runPass() {
  try {
    const result = await runCommercialEmailScheduler(DEFAULT_BATCH_SIZE)

    console.log("📬 Commercial scheduler run:", {
      processed: result.processed,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
    })
  } catch (err) {
    console.error("commercial scheduler failed", err)
  }
}

export function startCommercialEmailScheduler() {
  if (commercialSchedulerStarted) return

  commercialSchedulerStarted = true

  console.log("📬 Commercial email scheduler started")

  runPass()

  setInterval(() => {
    runPass()
  }, COMMERCIAL_POLL_MS)
}
