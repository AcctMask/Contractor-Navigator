import Fastify from "fastify"
import cors from "@fastify/cors"
import formbody from "@fastify/formbody"
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
import { startFollowupScheduler } from "./services/followupScheduler"

dotenv.config()

const app = Fastify({ logger: true })

await app.register(cors, { origin: true })
await app.register(formbody)

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

const port = Number(process.env.PORT || 8787)

app.listen({ host: "0.0.0.0", port }).then(() => {
  app.log.info(`Server listening at http://0.0.0.0:${port}`)
  startFollowupScheduler()
  app.log.info("Follow-up scheduler started")
})
