import Fastify from "fastify"
import cors from "@fastify/cors"
import formbody from "@fastify/formbody"

function envInt(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function envStr(name: string, fallback: string) {
  const raw = process.env[name]
  return raw && raw.trim().length ? raw.trim() : fallback
}

async function registerRouteModule(app: any, modulePath: string, preferredExport?: string) {
  try {
    const mod: any = await import(modulePath)

    if (preferredExport && typeof mod?.[preferredExport] === "function") {
      await mod[preferredExport](app)
      app.log.info({ modulePath, export: preferredExport }, "Registered routes")
      return true
    }

    const candidates = [
      mod?.registerAdminRoutes,
      mod?.registerEventsRoutes,
      mod?.registerLeadRoutes,
      mod?.registerAiRoutes,
      mod?.registerTwilioWebhook,
      mod?.registerDispatchRoutes,
      mod?.registerCustomerRoutes,
      mod?.registerCustomersRoutes,
      mod?.default,
    ]

    const fn = candidates.find((x: any) => typeof x === "function")
    if (!fn) {
      app.log.warn({ modulePath, keys: Object.keys(mod || {}) }, "No valid route export found")
      return false
    }

    await fn(app)
    app.log.info({ modulePath, export: fn?.name || "anonymous/default" }, "Registered routes")
    return true
  } catch (err: any) {
    app.log.warn({ modulePath, err: err?.message || String(err) }, "Route module not registered")
    return false
  }
}

async function main() {
  const app = Fastify({
    logger: true,
  })

  await app.register(cors, { origin: true })
  await app.register(formbody)

  app.get("/health", async () => {
    return { ok: true, name: "contractor-autopilot-backend" }
  })

  await registerRouteModule(app, "./routes/admin", "registerAdminRoutes")
  await registerRouteModule(app, "./routes/events", "registerEventsRoutes")
  await registerRouteModule(app, "./routes/leads", "registerLeadRoutes")
  await registerRouteModule(app, "./routes/ai", "registerAiRoutes")
  await registerRouteModule(app, "./routes/twilioWebhook", "registerTwilioWebhook")
  await registerRouteModule(app, "./routes/dispatch", "registerDispatchRoutes")
  await registerRouteModule(app, "./routes/customers", "registerCustomerRoutes")

  app.get("/admin/routes", async () => {
    return { ok: true, routes: app.printRoutes() }
  })

  const port = envInt("PORT", 8787)
  const host = envStr("HOST", "0.0.0.0")

  await app.listen({ port, host })

  app.log.info(`Server listening at http://${host}:${port}`)

  const shutdown = async (signal: string) => {
    try {
      app.log.info({ signal }, "Shutting down...")
      await app.close()
      process.exit(0)
    } catch (e) {
      app.log.error(e, "Shutdown error")
      process.exit(1)
    }
  }

  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
