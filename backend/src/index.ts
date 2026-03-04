import Fastify from "fastify";
import cors from "@fastify/cors";

// We intentionally avoid importing your route modules statically,
// because earlier you hit errors like:
// - "registerAdminRoutes is not a function"
// - plugin undefined
// - file may/may not exist yet (dispatch/customers, etc)
//
// Instead, we dynamically import and register safely.

type FastifyInstance = ReturnType<typeof Fastify>;

function envInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(name: string, fallback: string) {
  const raw = process.env[name];
  return raw && raw.trim().length ? raw.trim() : fallback;
}

async function registerRouteModule(app: any, modulePath: string, preferredExport?: string) {
  try {
    const mod: any = await import(modulePath);

    // If a preferred named export is specified, try it first
    if (preferredExport && typeof mod?.[preferredExport] === "function") {
      await mod[preferredExport](app);
      app.log.info({ modulePath, export: preferredExport }, "Registered routes");
      return true;
    }

    // Try common patterns
    const candidates = [
      mod?.registerAdminRoutes,
      mod?.registerEventsRoutes,
      mod?.registerDispatchRoutes,
      mod?.registerCustomerRoutes,
      mod?.registerCustomersRoutes,
      mod?.default,
    ];

    const fn = candidates.find((x) => typeof x === "function");
    if (!fn) {
      app.log.warn({ modulePath, keys: Object.keys(mod || {}) }, "No valid route export found");
      return false;
    }

    await fn(app);
    app.log.info({ modulePath, export: fn?.name || "anonymous/default" }, "Registered routes");
    return true;
  } catch (err: any) {
    app.log.warn({ modulePath, err: err?.message || String(err) }, "Route module not registered");
    return false;
  }
}

async function main() {
  const app = Fastify({
    logger: true,
  });

  // CORS for local admin UI or future frontend
  await app.register(cors, { origin: true });

  // Health check
  app.get("/health", async () => {
    return { ok: true, name: "contractor-autopilot-backend" };
  });

  // ---- ROUTES ----
  // Admin (bootstrap, seed, timeline, workflows, etc.)
  await registerRouteModule(app, "./routes/admin", "registerAdminRoutes");

  // Events ingestion (/events)
  await registerRouteModule(app, "./routes/events", "registerEventsRoutes");

  // Dispatch routes (optional; if file missing, it won’t crash)
  await registerRouteModule(app, "./routes/dispatch", "registerDispatchRoutes");

  // Customers panel routes (optional; if file missing, it won’t crash)
  await registerRouteModule(app, "./routes/customers", "registerCustomerRoutes");

  // Useful route to view what is wired (optional)
  app.get("/admin/routes", async () => {
    // Fastify exposes routes through printRoutes()
    // This is safe and helps debug quickly.
    return { ok: true, routes: app.printRoutes() };
  });

  const port = envInt("PORT", 8787);
  const host = envStr("HOST", "0.0.0.0");

  await app.listen({ port, host });

  app.log.info(`Server listening at http://${host}:${port}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    try {
      app.log.info({ signal }, "Shutting down...");
      await app.close();
      process.exit(0);
    } catch (e) {
      app.log.error(e, "Shutdown error");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  // If startup fails, log and exit non-zero so you notice immediately
  // (tsx watch will restart after you fix the cause)
  console.error(err);
  process.exit(1);
});
