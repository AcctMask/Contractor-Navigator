import Fastify from "fastify"
import cors from "@fastify/cors"
import formbody from "@fastify/formbody"
import multipart from "@fastify/multipart"
import rawBody from "fastify-raw-body"
import dotenv from "dotenv"

import { registerAdminRoutes } from "./routes/admin"
import { registerAdditionalTarpRoutes } from "./routes/additionalTarp"
import { registerOutstandingTarpReportRoutes } from "./routes/outstandingTarpReport"
import { registerEventsRoutes } from "./routes/events"
import registerLeadRoutes from "./routes/leads"
import { registerAiRoutes } from "./routes/ai"
import { registerTwilioWebhook } from "./routes/twilioWebhook"
import { registerCustomerRoutes } from "./routes/customers"
import { registerDevSettingsRoutes } from "./routes/devSettings"
import { registerAuthRoutes } from "./routes/auth"
import { registerWorkforceCrewRoutes } from "./routes/workforceCrew"
import { registerJobSearchRoutes } from "./routes/jobSearch"
import { registerDocumentPipelineRoutes } from "./routes/documentPipeline"
import { registerJobAssetsRoutes } from "./routes/jobAssets"
import { registerCalendarRoutes } from "./routes/calendar"
import { registerTaskRoutes } from "./routes/tasks"
import { registerClaimsEmailIntakeRoutes } from "./routes/claimsEmailIntake"
import { registerSalesEmailIntakeRoutes } from "./routes/salesEmailIntake"
import { registerBusinessDevelopmentIntakeRoutes } from "./routes/businessDevelopmentIntake"
import { registerReportingRoutes } from "./routes/reporting"
import { registerSalesPerformanceReportingRoutes } from "./routes/salesPerformanceReporting"
import { registerBusinessPerformanceV2Routes } from "./routes/businessPerformanceV2"
import { registerPlatformProvisioningRoutes } from "./routes/platformProvisioning"
import { registerFinancialOperationsBridgeRoutes } from "./routes/financialOperationsBridge"
import { registerOpsIntelBridgeRoutes } from "./routes/opsIntelBridge"
import { registerFinancialOperationsHandoffRoutes } from "./routes/financialOperationsHandoff"
import { startFollowupScheduler } from "./services/followupScheduler"
import { ensureFollowupLifecycleAuthority } from "./services/followupLifecycleService"
import { ensureStageSinceAuthority } from "./services/stageSinceService"
import {
  schedulerTick,
  schedulerTickEms,
} from "./services/scheduler"
import { commercialRoutes } from "./modules/commercial/routes"

dotenv.config()

// Protected acceptance diagnostics: inspect the connected database before startup mutations.
if (process.env.NODE_ENV === "test") {
  const { pool } = await import("./db/db")
  const identity = await pool.query(`select current_database() as database, current_schema() as schema, current_setting('search_path') as search_path`)
  const inventory = await pool.query(`
    select table_schema, table_name
    from information_schema.tables
    where table_name in ('developer_settings', 'customers', 'jobs', 'tenants')
    order by table_schema, table_name
  `)
  const columns = await pool.query(`
    select table_schema, table_name, column_name
    from information_schema.columns
    where table_name in ('developer_settings', 'customers')
      and column_name in ('tenant_id', 'settings', 'phone', 'reporting_classification')
    order by table_schema, table_name, column_name
  `)
  console.log("NAVIGATOR_ACCEPTANCE_DB_IDENTITY", JSON.stringify(identity.rows))
  console.log("NAVIGATOR_ACCEPTANCE_DB_INVENTORY", JSON.stringify(inventory.rows))
  console.log("NAVIGATOR_ACCEPTANCE_DB_COLUMNS", JSON.stringify(columns.rows))
}

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
await registerAdditionalTarpRoutes(app)
await registerOutstandingTarpReportRoutes(app)
await registerEventsRoutes(app)
await registerLeadRoutes(app)
await registerAiRoutes(app)
await registerTwilioWebhook(app)
await registerCustomerRoutes(app)
await registerDevSettingsRoutes(app)
await registerAuthRoutes(app)
await registerWorkforceCrewRoutes(app)
await registerJobSearchRoutes(app)
await registerDocumentPipelineRoutes(app)
await registerJobAssetsRoutes(app)
await registerCalendarRoutes(app)
await registerTaskRoutes(app)
await registerReportingRoutes(app)
await registerSalesPerformanceReportingRoutes(app)
await registerBusinessPerformanceV2Routes(app)
await registerPlatformProvisioningRoutes(app)
await registerFinancialOperationsBridgeRoutes(app)
await registerOpsIntelBridgeRoutes(app)
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
    // The disposable PashLoc acceptance database intentionally contains only
    // the authentication/test subset. Do not install production CRM follow-up
    // triggers or start outbound schedulers against this protected fixture.
    if (process.env.NODE_ENV === "test") {
      console.log("NAVIGATOR_ACCEPTANCE_SCHEDULERS_DISABLED")
      return
    }

    await ensureStageSinceAuthority()
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
