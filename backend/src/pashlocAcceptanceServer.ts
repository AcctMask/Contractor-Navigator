/** MFA-only acceptance entrypoint. No Navigator CRM routes, jobs, schedulers or workers.
 * Refuses startup unless bound to an explicitly named disposable database.
 * Never use against a production database.
 */
import Fastify from "fastify"
import cors from "@fastify/cors"
import { registerAuthRoutes } from "./routes/auth"

const allowed = new Set([
 "/auth/mfa/device/claim-challenge",
 "/auth/mfa/device/claim",
 "/auth/mfa/enrollment/start",
 "/auth/mfa/enrollment/approve-device",
 "/auth/mfa/device/redeem-challenge",
 "/auth/mfa/device/redeem",
 "/auth/mfa/enrollment/confirm",
 "/auth/mfa/login/verify"
])

export function assertMfaAcceptanceEnvironment(env: NodeJS.ProcessEnv) {
 if (env.PASHLOC_ACCEPTANCE_ONLY !== "yes" || env.PASHLOC_ACCEPTANCE_DATABASE_CONFIRMED !== "yes")
   throw new Error("MFA acceptance isolation not attested")
 if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test")
   throw new Error("MFA acceptance requires isolated nonproduction mode")
 const url = new URL(env.DATABASE_URL || "")
 const name = decodeURIComponent(url.pathname.slice(1))
 if (!["postgres:", "postgresql:"].includes(url.protocol) ||
     !name.startsWith("pashloc_") || !name.includes("disposable") ||
     !env.PASHLOC_ACCEPTANCE_DATABASE_NAME ||
     name !== env.PASHLOC_ACCEPTANCE_DATABASE_NAME)
   throw new Error("MFA acceptance disposable database identity rejected")
 if (env.PASHLOC_NAVIGATOR_ENROLLMENT_ENABLED !== "yes" ||
     env.PASHLOC_PHONE_CLAIM_ENABLED !== "yes" ||
     env.PASHLOC_SHARED_RATE_LIMITS_VERIFIED !== "yes")
   throw new Error("MFA acceptance security prerequisites not met")
 // Exact origins are mandatory: reject credentials, paths, query strings and
 // deceptive prefixes before using these values for browser CORS decisions.
 for (const origin of [env.APP_BASE_URL, env.PASHLOC_PHONE_ORIGIN]) {
   if (!origin) throw new Error("Explicit HTTPS acceptance origins required")
   let parsed: URL
   try { parsed = new URL(origin) }
   catch { throw new Error("Invalid MFA acceptance origin") }
   if (parsed.protocol !== "https:" || parsed.origin !== origin ||
       parsed.username || parsed.password || parsed.pathname !== "/" ||
       parsed.search || parsed.hash)
     throw new Error("Invalid MFA acceptance origin")
 }
 if (env.APP_BASE_URL === env.PASHLOC_PHONE_ORIGIN)
   throw new Error("Navigator and PashLoc acceptance origins must be distinct")
}

export async function buildMfaAcceptanceServer() {
 assertMfaAcceptanceEnvironment(process.env)
 const app = Fastify({logger:true,bodyLimit:16*1024})
 // The protected Navigator browser and PashLoc phone are distinct origins.
 // Only these pinned origins may make cross-origin MFA requests; never reflect arbitrary origins.
 await app.register(cors, {
   origin: [process.env.APP_BASE_URL!, process.env.PASHLOC_PHONE_ORIGIN!],
   methods: ["POST"],
   allowedHeaders: ["Content-Type", "X-PashLoc-CSRF", "X-PashLoc-Restricted-Session"],
   credentials: false,
   strictPreflight: true,
 })
 app.addHook("onRequest", async (req, reply) => {
   const pathname = new URL(req.url,"http://localhost").pathname
   if (req.method === "GET" && pathname === "/healthz") return
   if (req.method === "POST" && (allowed.has(pathname) ||
       /^\/auth\/[^/]+\/login$/.test(pathname))) return
   return reply.code(404).send({ok:false})
 })
 app.get("/healthz", async () => ({ok:true,service:"navigator-mfa-acceptance"}))
 await registerAuthRoutes(app)
 return app
}
if (process.argv[1] && /pashlocAcceptanceServer\.(?:ts|js)$/.test(process.argv[1])) {
 void buildMfaAcceptanceServer()
   .then(app => app.listen({host:"0.0.0.0",port:Number(process.env.PORT||8789)}))
   .catch(error => { console.error("MFA acceptance startup rejected", error); process.exitCode = 1 })
}
