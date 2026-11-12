/**
 * PashLoc IV MFA phone-side claim endpoints — isolated engineering only.
 * These endpoints do not issue sessions or disclose enrollment secrets.
 * Registration requires BOTH an explicit flag and non-production NODE_ENV.
 * Do not use this as the final production security boundary.
 */
import type { FastifyInstance } from "fastify"
import { issuePashLocDeviceClaimNonce } from "../services/pashlocDeviceClaimNonce"
import { claimPashLocDevice } from "../services/pashlocDeviceClaimV2"

export async function registerPashLocIsolatedClaimRoutes(app: FastifyInstance) {
  if (process.env.PASHLOC_ISOLATED_CLAIM_API !== "enabled" ||
      !["development", "test"].includes(process.env.NODE_ENV || "")) return

  // Fail closed until a single approved PashLoc HTTPS origin is configured.
  const approvedOrigin = process.env.PASHLOC_ISOLATED_PHONE_ORIGIN
  if (!approvedOrigin || !/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(approvedOrigin)) return
  const originAllowed = (request: any) =>
    request.headers.origin === approvedOrigin &&
    request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() === "application/json"
  // Conservative per-process guard; deployment must also provide shared
  // gateway rate limits because multiple instances do not share this map.
  const buckets = new Map<string, { count: number; reset: number }>()
  const limited = (request: any) => {
    const key = String(request.ip || "unknown")
    const now = Date.now()
    if (buckets.size > 10000) buckets.clear()
    const b = buckets.get(key)
    if (!b || b.reset <= now) {
      buckets.set(key, { count: 1, reset: now + 60000 })
      return false
    }
    b.count++
    return b.count > 10
  }
  const headers = {
    "Cache-Control": "no-store, private",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  }
  app.post("/auth/mfa/device/claim-challenge", async (request: any, reply) => {
    reply.headers(headers)
    if (!originAllowed(request)) return reply.code(403).send({ok:false,error:"forbidden"})
    if (limited(request)) return reply.code(429).send({ok:false,error:"rate_limited"})
    const pairingRef = request.body?.pairing_ref
    if (typeof pairingRef !== "string") return reply.code(400).send({ok:false,error:"invalid_request"})
    const result = await issuePashLocDeviceClaimNonce(pairingRef)
    if (!result) return reply.code(404).send({ok:false,error:"unavailable"})
    return {ok:true,proof_nonce:result.nonce,expires_at:result.expires_at}
  })
  app.post("/auth/mfa/device/claim", async (request: any, reply) => {
    reply.headers(headers)
    if (!originAllowed(request)) return reply.code(403).send({ok:false,error:"forbidden"})
    if (limited(request)) return reply.code(429).send({ok:false,error:"rate_limited"})
    const b = request.body
    if (!b || typeof b !== "object" || typeof b.pairing_ref !== "string" ||
        typeof b.proof_nonce !== "string" || typeof b.proof_signature !== "string" ||
        !b.device_public_key_jwk || typeof b.device_public_key_jwk !== "object") {
      return reply.code(400).send({ok:false,error:"invalid_request"})
    }
    const result = await claimPashLocDevice(b)
    if (!result) return reply.code(409).send({ok:false,error:"unavailable"})
    return {ok:true,...result}
  })
}
