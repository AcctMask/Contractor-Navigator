/**
 * Additive PashLoc signed-approval cryptographic boundary.
 * Not a login endpoint. Caller must verify device registration, tenant/user,
 * browser session, expiration and atomically consume challenge in the database.
 * No private key is transmitted or stored by Navigator.
 */
import { type JsonWebKey, createHash, createPublicKey, verify, timingSafeEqual } from "node:crypto"

export type SignedApprovalDecision = "approve" | "deny"
export interface SignedApprovalContext {
  version: "AA-PASHLOC-LOGIN-V1"
  environment: "acceptance" | "production"
  tenantId: number
  userId: number
  deviceId: string
  challengeId: string
  browserSessionHash: string
  expiresAt: string
  decision: SignedApprovalDecision
}

const token = /^[A-Za-z0-9_-]{32,128}$/
const hexHash = /^[a-f0-9]{64}$/
const b64url = /^[A-Za-z0-9_-]{86,88}$/

export function canonicalSignedApproval(c: SignedApprovalContext): Buffer {
  if (c.version !== "AA-PASHLOC-LOGIN-V1" || (c.environment !== "acceptance" && c.environment !== "production") ||
      !Number.isSafeInteger(c.tenantId) || c.tenantId <= 0 ||
      !Number.isSafeInteger(c.userId) || c.userId <= 0 ||
      !token.test(c.deviceId) || !token.test(c.challengeId) ||
      !hexHash.test(c.browserSessionHash) ||
      !Number.isFinite(Date.parse(c.expiresAt)) ||
      new Date(c.expiresAt).toISOString() !== c.expiresAt ||
      (c.decision !== "approve" && c.decision !== "deny")) {
    throw new Error("Invalid signed approval context")
  }
  return Buffer.from([
    c.version,c.environment,String(c.tenantId),String(c.userId),
    c.deviceId,c.challengeId,c.browserSessionHash,c.expiresAt,c.decision
  ].join("\n"), "utf8")
}

export function verifySignedApproval(input: {
  context: SignedApprovalContext
  registeredPublicJwk: JsonWebKey
  signature: string
  expected: Omit<SignedApprovalContext,"decision">
  now?: number
  allowDeny?: boolean
}): boolean {
  try {
    const c = input.context, e = input.expected
    const message = canonicalSignedApproval(c)
    if ((!input.allowDeny && c.decision !== "approve") ||
        c.version !== e.version || c.environment !== e.environment ||
        c.tenantId !== e.tenantId || c.userId !== e.userId ||
        c.deviceId !== e.deviceId || c.challengeId !== e.challengeId ||
        c.browserSessionHash !== e.browserSessionHash ||
        c.expiresAt !== e.expiresAt) return false
    const now = input.now ?? Date.now()
    if (!Number.isFinite(now) || Date.parse(c.expiresAt) <= now ||
        Date.parse(c.expiresAt) > now + 120000) return false
    const jwk = input.registeredPublicJwk
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" ||
        typeof jwk.x !== "string" || typeof jwk.y !== "string" ||
        jwk.d !== undefined || jwk.alg && jwk.alg !== "ES256") return false
    if (!b64url.test(input.signature)) return false
    const signature = Buffer.from(input.signature,"base64url")
    if (signature.length !== 64) return false
    const key = createPublicKey({key:jwk,format:"jwk"})
    return verify("sha256",message,{key,dsaEncoding:"ieee-p1363"},signature)
  } catch { return false }
}

/** Hash a browser-session token server-side; never place the token in a QR. */
export function browserSessionDigest(tokenValue: string): string {
  return createHash("sha256").update(tokenValue,"utf8").digest("hex")
}

/** Compare already-computed digests without exposing the underlying tokens. */
export function sameSessionDigest(a: string,b: string): boolean {
  if (!hexHash.test(a) || !hexHash.test(b)) return false
  return timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"))
}
