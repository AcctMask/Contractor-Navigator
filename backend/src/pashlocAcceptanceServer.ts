/** Isolated MFA acceptance entrypoint with authenticated read-only Navigator routes.
 * Refuses startup unless bound to an explicitly named disposable database.
 * Never use against a production database.
 */
import Fastify from "fastify"
import cors from "@fastify/cors"
import { registerAuthRoutes } from "./routes/auth"
import { registerAdminRoutes } from "./routes/admin"
import { registerCalendarReadRoute } from "./routes/calendar"
import { registerPlatformProvisioningRoutes } from "./routes/platformProvisioning"
import { pool } from "./db/db"
import { registerPashLocAcceptanceRateLimits } from "./services/pashlocAcceptanceRateLimit"
import { registerChairmanPasswordSetup } from "./pashlocAcceptanceChairmanSetup"

import { getCurrentUserFromToken } from "./services/authService"
import { tenantAllowed } from "./services/pashlocSignedAcceptancePolicy"
import { registerSignedAcceptance, startVerifiedSignedLogin } from "./routes/pashlocSignedAcceptance"
import { migrateSignedAcceptance } from "./pashlocSignedAcceptanceMigration"

const crmReadRoutes = [
 /^\/auth\/me$/,
 /^\/platform\/company-dna-runtime\/[^/]+$/,
 /^\/admin\/jobs\/[^/]+$/,
 /^\/calendar\/[^/]+\/events$/,
 /^\/admin\/recent-activity\/[^/]+$/
]

const allowed = new Set([
 "/auth/mfa/device/claim-challenge",
 "/auth/mfa/device/claim",
 "/auth/mfa/enrollment/start",
 "/auth/mfa/enrollment/resume-confirm",
 "/auth/mfa/enrollment/recover",
 "/auth/mfa/enrollment/approve-device",
 "/auth/mfa/device/redeem-challenge",
 "/auth/mfa/device/redeem",
 "/auth/mfa/enrollment/confirm",
 "/auth/mfa/enrollment/redemption-status",
 "/auth/mfa/login/verify",
 "/auth/acceptance/password-setup",
 "/auth/acceptance/password-setup/validate"
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

/** Startup gate: never claim a ready genuine backend before its disposable
 * database contains the actual Navigator MFA schema. Read-only checks only. */
export async function assertMfaAcceptanceSchema() {
 const result = await pool.query(`
   select
     to_regclass('public.tenants') is not null as tenants,
     to_regclass('public.app_users') is not null as users,
     to_regclass('public.pashloc_mfa_enrollments') is not null as enrollments,
     to_regclass('public.pashloc_mfa_challenges') is not null as challenges,
     to_regclass('public.pashloc_mfa_pairings') is not null as pairings,
     to_regclass('public.pashloc_mfa_device_claim_nonces') is not null as claim_nonces,
     to_regclass('public.pashloc_mfa_restricted_browser_sessions') is not null as restricted_sessions,
     to_regclass('public.pashloc_mfa_request_limits') is not null as request_limits,
     exists(select 1 from information_schema.columns
       where table_schema='public' and table_name='app_users'
         and column_name='pashloc_mfa_required') as default_off_column,
     exists(select 1 from information_schema.columns
       where table_schema='public' and table_name='pashloc_mfa_pairings'
         and column_name='credential_envelope') as genuine_envelope_column
 `)
 const status = result.rows[0] || {}
 const missing = Object.entries(status).filter(([,ready])=>ready!==true).map(([name])=>name)
 if(missing.length) throw new Error("Disposable MFA schema incomplete: "+missing.join(","))
}

export async function buildMfaAcceptanceServer() {
 assertMfaAcceptanceEnvironment(process.env)
 const signed = process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME === "pashloc_iv_disposable_mfa_isolated"
 if (signed) {
   const secret = process.env.JWT_SECRET
   if (!secret || Buffer.byteLength(secret) < 32 || secret === "contractor-autopilot-local-secret")
     throw new Error("Signed acceptance requires an isolated session signing secret")
   await migrateSignedAcceptance()
 }
 await assertMfaAcceptanceSchema()
 const app = Fastify({logger:false,bodyLimit:16*1024})
 // The protected Navigator browser and PashLoc phone are distinct origins.
 // Only these pinned origins may make cross-origin MFA requests; never reflect arbitrary origins.
 await app.register(cors, {
   origin: [process.env.APP_BASE_URL!, process.env.PASHLOC_PHONE_ORIGIN!],
   methods: ["POST", "GET"],
   allowedHeaders: ["Content-Type", "Authorization", "X-PashLoc-CSRF", "X-PashLoc-Restricted-Session"],
   credentials: false,
   strictPreflight: true,
 })
 app.addHook("onRequest", async (req, reply) => {
   const pathname = new URL(req.url,"http://localhost").pathname
   if (req.method === "GET" && pathname === "/healthz") return
   // Explicitly reject a browser from an unapproved origin for all protected routes.
   const origin = req.headers.origin
   if (origin && origin !== process.env.APP_BASE_URL && origin !== process.env.PASHLOC_PHONE_ORIGIN)
     return reply.code(403).send({ok:false})
   if (signed && (req.method === "POST" || req.method === "OPTIONS") &&
       /^\/auth\/mfa\/signed\/(start|registration-info|register|challenge|decision|complete|revoke)$/.test(pathname)) return
   // The CORS plugin handles approved OPTIONS preflights before route dispatch.
   // Unknown paths still fail the plugin/router preflight checks.
   if (req.method === "GET" && crmReadRoutes.some(pattern => pattern.test(pathname))) {
     const tenantSlug = /^(?:\/admin\/(?:jobs|recent-activity)\/|\/platform\/company-dna-runtime\/|\/calendar\/)([^/]+)/.exec(pathname)?.[1]
     if (signed) {
       const bearer = req.headers.authorization
       if (!bearer?.startsWith("Bearer ")) return reply.code(401).send({ok:false})
       let user
       try { user = await getCurrentUserFromToken(bearer.slice(7)) }
       catch { return reply.code(401).send({ok:false}) }
       const result = await pool.query("select slug from tenants where id=$1", [user.tenant_id])
       const sessionTenant = result.rows[0]?.slug
       if (!tenantAllowed(sessionTenant) || (tenantSlug && tenantSlug !== sessionTenant))
         return reply.code(403).send({ok:false})
     }
     return
   }
   if (req.method === "OPTIONS" && (crmReadRoutes.some(pattern => pattern.test(pathname)) || allowed.has(pathname) ||
       /^\/auth\/[^/]+\/login$/.test(pathname))) return
   if (req.method === "POST" && (allowed.has(pathname) ||
       /^\/auth\/[^/]+\/login$/.test(pathname))) return
   return reply.code(404).send({ok:false})
 })
 app.get("/healthz", async () => ({ok:true,service:"navigator-mfa-acceptance"}))
 registerPashLocAcceptanceRateLimits(app)
 if(signed) registerSignedAcceptance(app)
 await registerAuthRoutes(app, signed ? {
   authorize: (slug, origin) => tenantAllowed(slug) && origin === process.env.APP_BASE_URL,
   startMfa: startVerifiedSignedLogin,
 } : undefined)
 registerChairmanPasswordSetup(app)
 // Reuse the established Navigator handlers; the onRequest allowlist blocks
 // every other route, including write operations, before handler execution.
 await registerAdminRoutes(app)
 registerCalendarReadRoute(app)
 await registerPlatformProvisioningRoutes(app)
 return app
}
if (process.argv[1] && /pashlocAcceptanceServer\.(?:ts|js)$/.test(process.argv[1])) {
 void buildMfaAcceptanceServer()
   .then(app => app.listen({host:"0.0.0.0",port:Number(process.env.PORT||8789)}))
   .catch(error => { console.error("MFA acceptance startup rejected", error); process.exitCode = 1 })
}
