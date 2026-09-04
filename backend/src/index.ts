import Fastify from "fastify"
import cors from "@fastify/cors"
import formbody from "@fastify/formbody"
import multipart from "@fastify/multipart"
import rawBody from "fastify-raw-body"
import dotenv from "dotenv"

import { registerAdminRoutes } from "./routes/admin"
import { registerEventsRoutes } from "./routes/events"
import registerLeadRoutes from "./routes/leads"
import { registerAiRoutes } from "./routes/ai"
import { registerTwilioWebhook } from "./routes/twilioWebhook"
import { registerCustomerRoutes } from "./routes/customers"
import { registerDevSettingsRoutes } from "./routes/devSettings"
import { registerAuthRoutes } from "./routes/auth"
import { registerJobSearchRoutes } from "./routes/jobSearch"
import { registerDocumentPipelineRoutes } from "./routes/documentPipeline"
import { registerJobAssetsRoutes } from "./routes/jobAssets"
import { registerCalendarRoutes } from "./routes/calendar"
import { registerClaimsEmailIntakeRoutes } from "./routes/claimsEmailIntake"
import { registerSalesEmailIntakeRoutes } from "./routes/salesEmailIntake"
import { registerBusinessDevelopmentIntakeRoutes } from "./routes/businessDevelopmentIntake"
import { registerReportingRoutes } from "./routes/reporting"
import { registerSalesPerformanceReportingRoutes } from "./routes/salesPerformanceReporting"
import { registerPlatformProvisioningRoutes } from "./routes/platformProvisioning"
import { registerFinancialOperationsBridgeRoutes } from "./routes/financialOperationsBridge"
import { registerFinancialOperationsHandoffRoutes } from "./routes/financialOperationsHandoff"
import { startFollowupScheduler } from "./services/followupScheduler"
import { ensureFollowupLifecycleAuthority } from "./services/followupLifecycleService"
import {
  schedulerTick,
  schedulerTickEms,
} from "./services/scheduler"
import { commercialRoutes } from "./modules/commercial/routes"

dotenv.config()

const app = Fastify({ logger: true })

await app.register(cors, { origin: true })
await app.register(formbody)

await app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: "utf8",
  runFirst: true,
})

await app.register(multipart, {
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 100,
  },
})

app.get("/", async () => {
  return {
    ok: true,
    name: "contractor-autopilot-backend",
  }
})

await registerAdminRoutes(app)
await registerEventsRoutes(app)
await registerLeadRoutes(app)
await registerAiRoutes(app)
await registerTwilioWebhook(app)
await registerCustomerRoutes(app)
await registerDevSettingsRoutes(app)
await registerAuthRoutes(app)
await registerJobSearchRoutes(app)
await registerDocumentPipelineRoutes(app)
await registerJobAssetsRoutes(app)
await registerCalendarRoutes(app)
await registerReportingRoutes(app)
await registerSalesPerformanceReportingRoutes(app)
await registerPlatformProvisioningRoutes(app)
await registerFinancialOperationsBridgeRoutes(app)
await registerFinancialOperationsHandoffRoutes(app)
await registerClaimsEmailIntakeRoutes(app)
await registerSalesEmailIntakeRoutes(app)
await registerBusinessDevelopmentIntakeRoutes(app)
await commercialRoutes(app)

const port = Number(process.env.PORT || 8787)

app.listen({ port, host: "0.0.0.0" })
  .then(async () => {
    console.log(`🚀 Server running on port ${port}`)

    /*
     * Navigator corporate authority must be durable before any
     * CRM / AI follow-up scheduler is allowed to operate.
     */
    await ensureFollowupLifecycleAuthority()

    startFollowupScheduler()

    /*
     * Restore the existing general scheduled_actions runner.
     *
     * This is the original schedulerTick() authority and remains
     * separate from both:
     *   - startFollowupScheduler() CRM / AI follow-up
     *   - schedulerTickEms() Claims EMS authorization lane
     *
     * Do not merge these lanes.
     */
    let generalSchedulerRunning = false

    const runGeneralScheduler = async () => {
      if (generalSchedulerRunning) return

      generalSchedulerRunning = true

      try {
        await schedulerTick()
      } catch (err) {
        console.error(
          "General scheduled-action tick failed",
          err
        )
      } finally {
        generalSchedulerRunning = false
      }
    }

    void runGeneralScheduler()

    setInterval(() => {
      void runGeneralScheduler()
    }, 10_000)

    let emsSchedulerRunning = false

    const runEmsScheduler = async () => {
      if (emsSchedulerRunning) return

      emsSchedulerRunning = true

      try {
        await schedulerTickEms()
      } catch (err) {
        console.error(
          "EMS scheduled-action tick failed",
          err
        )
      } finally {
        emsSchedulerRunning = false
      }
    }

    void runEmsScheduler()

    setInterval(() => {
      void runEmsScheduler()
    }, 10_000)
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
