import Fastify from "fastify"
import cors from "@fastify/cors"
import formbody from "@fastify/formbody"
import multipart from "@fastify/multipart"
import dotenv from "dotenv"

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
    name: "commercial-pipeline-builder-backend",
  }
})

await commercialRoutes(app)

const port = 8795

app.listen({ port, host: "0.0.0.0" })
  .then(() => {
    console.log(`🚀 Commercial Pipeline server running on port ${port}`)
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
