import Fastify from "fastify";
import cors from "@fastify/cors";
import { schedulerTick } from "./services/scheduler";

// We intentionally avoid importing your route modules statically.
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

function envBool(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return fallback;
}

async function registerRouteModule(app: any, modulePath: string, preferredExport?: string) {
  try {
    const mod: any = await import(modulePath);

    if (preferredExport && typeof mod?.[preferredExport] === "function") {
      await mod[preferredExport](app);
      app.log.info({ modulePath, export: preferredExport }, "Registered routes");
      return true;
    }

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

function startAutoScheduler(app: any) {
  const enabled = envBool("SCHEDULER_ENABLED", true);
  const intervalMs = envInt("SCHEDULER_INTERVAL_MS", 10_000);
  const limit = envInt("SCHEDULER_LIMIT", 25);

  if (!enabled) {
    app.log.warn(
      { enabled, intervalMs, limit },
      "Auto-scheduler disabled (set SCHEDULER_ENABLED=true to enable)"
    );
    return { stop: () => {} };
  }

  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const runOnce = async () => {
    if (running) return;
    running = true;
    try {
      await schedulerTick(limit);
    } catch (e: any) {
      app.log.error({ err: String(e?.message || e) }, "Auto-scheduler tick failed");
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    runOnce().catch(() => {});
  }, intervalMs);

  // Kick once at startup (so “immediate” actions run right away)
  runOnce().catch(() => {});

  app.log.info({ intervalMs, limit }, "Auto-scheduler started");

  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

async function main() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, { origin: true });

  app.get("/health", async () => {
    return { ok: true, name: "contractor-autopilot-backend" };
  });

  // ---- ROUTES ----
  await registerRouteModule(app, "./routes/admin", "registerAdminRoutes");
  await registerRouteModule(app, "./routes/events", "registerEventsRoutes");
  await registerRouteModule(app, "./routes/dispatch", "registerDispatchRoutes");
  await registerRouteModule(app, "./routes/customers", "registerCustomerRoutes");

  app.get("/admin/routes", async () => {
    return { ok: true, routes: app.printRoutes() };
  });

  const port = envInt("PORT", 8787);
  const host = envStr("HOST", "0.0.0.0");

  await app.listen({ port, host });

  app.log.info(`Server listening at http://${host}:${port}`);

  // START AUTO SCHEDULER (runs in-process)
  const auto = startAutoScheduler(app);

  const shutdown = async (signal: string) => {
    try {
      app.log.info({ signal }, "Shutting down...");
      auto.stop();
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
  console.error(err);
  process.exit(1);
});
