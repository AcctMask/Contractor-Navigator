/**
 * AA-PASHLOC-ENROLL-V1 restricted browser approval primitives.
 * Isolated engineering only. NEVER a Navigator JWT or bearer token.
 * Route integration must supply a dedicated server-side authenticated
 * password verification gate and durable challenge state before use.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

export const RESTRICTED_BROWSER_TTL_SECONDS = 300
export const RESTRICTED_BROWSER_COOKIE = "__Host-pashloc_enroll"
const token = /^[A-Za-z0-9_-]{43}$/
const originPattern = /^https:\/\/[a-z0-9.-]+(?::443)?$/i

export function issueRestrictedBrowserSecrets() {
  const sessionId = randomBytes(32).toString("base64url")
  const csrfToken = randomBytes(32).toString("base64url")
  return {
    sessionId, csrfToken,
    sessionHash: sha256(sessionId),
    csrfHash: sha256(csrfToken),
    expiresAt: new Date(Date.now() + RESTRICTED_BROWSER_TTL_SECONDS * 1000).toISOString(),
  }
}
export function sha256(value: string) {
  return createHash("sha256").update(value,"utf8").digest("hex")
}
function constantHashMatch(value: string, expectedHash: string) {
  if(!token.test(value) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false
  return timingSafeEqual(Buffer.from(sha256(value),"hex"),Buffer.from(expectedHash,"hex"))
}
export function restrictedCookie(value: string) {
  if(!token.test(value)) throw new Error("Invalid restricted session token")
  return RESTRICTED_BROWSER_COOKIE+"="+value+"; Path=/; Max-Age="+RESTRICTED_BROWSER_TTL_SECONDS+"; Secure; HttpOnly; SameSite=Strict"
}
export function clearRestrictedCookie() {
  return RESTRICTED_BROWSER_COOKIE+"=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict"
}
/**
 * Validate the browser request against server-side restricted-session hashes.
 * Call only AFTER a durable server-side session lookup and before approving
 * the exact claim. Never take tenant/user identity from request body.
 */
export function validateRestrictedBrowserRequest(input: {
  origin: unknown; expectedOrigin: string;
  secFetchSite: unknown; contentType: unknown;
  cookieSession: unknown; csrfHeader: unknown;
  sessionHash: string; csrfHash: string;
  expiresAtMs: number; nowMs?: number;
}): boolean {
  if(!originPattern.test(input.expectedOrigin) || input.origin!==input.expectedOrigin) return false
  // Navigator dashboard and Render API are different origins. The restricted\n  // token is supplied in a custom header, never ambient cookies; strict Origin\n  // and CSRF binding are required for every cross-origin request.\n  if(input.secFetchSite!==undefined && !["same-origin","same-site","cross-site"].includes(String(input.secFetchSite))) return false
  if(typeof input.contentType!=="string" || input.contentType.split(";")[0].trim().toLowerCase()!=="application/json") return false
  if(!Number.isFinite(input.expiresAtMs) || input.expiresAtMs<=(input.nowMs??Date.now())) return false
  if(typeof input.cookieSession!=="string" || typeof input.csrfHeader!=="string") return false
  return constantHashMatch(input.cookieSession,input.sessionHash) && constantHashMatch(input.csrfHeader,input.csrfHash)
}
/** Strict cookie parser: duplicate session cookie is rejected. */
export function readRestrictedSessionCookie(header: unknown): string | null {
  if(typeof header!=="string") return null
  const values=header.split(";").map(x=>x.trim()).filter(x=>x.startsWith(RESTRICTED_BROWSER_COOKIE+"="))
  if(values.length!==1) return null
  const value=values[0].slice(RESTRICTED_BROWSER_COOKIE.length+1)
  return token.test(value)?value:null
}
