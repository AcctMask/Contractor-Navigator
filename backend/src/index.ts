import Fastify from "fastify"
import cors from "@fastify/cors"
import formbody from "@fastify/formbody"
import multipart from "@fastify/multipart"
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
import { startFollowupScheduler } from "./services/followupScheduler"
import { commercialRoutes } from "./modules/commercial/routes"

dotenv.config()

const app = Fastify({ logger: true })

await app.register(cors, { origin: true })
await app.register(formbody)

await app.register(multipart, {
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 20,
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
await commercialRoutes(app)

const port = Number(process.env.PORT || 8787)

app.listen({ port, host: "0.0.0.0" })
  .then(() => {
    console.log(`🚀 Server running on port ${port}`)
    startFollowupScheduler()
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
