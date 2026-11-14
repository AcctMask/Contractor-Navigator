/**
 * PashLoc IV MFA — isolated pairing issuance for Mac-to-phone enrollment.
 * NOT mounted on a route; requires an existing restricted enrollment challenge.
 * The QR carries only a random pairing token. It never carries a TOTP secret.
 * Claims, browser confirmation, redemption and delivery must be implemented
 * with Security Assurance review before this can be used for real enrollment.
 */
import { createHash, randomBytes } from "node:crypto"
import { pool } from "../db/db"

const TTL_SECONDS = 180
const hash = (value: string) => createHash("sha256").update(value).digest("hex")

export async function createPashLocPairing(input: {
  challengeId: string
  tenantId: number
  userId: number
}): Promise<{ pairingId: string; expiresAt: string }> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.challengeId) ||
      !Number.isSafeInteger(input.tenantId) || input.tenantId <= 0 ||
      !Number.isSafeInteger(input.userId) || input.userId <= 0) {
    throw new Error("Invalid pairing scope")
  }
  const pairingId = randomBytes(32).toString("base64url")
  const result = await pool.query(
    `insert into pashloc_mfa_pairings (challenge_id,pairing_hash,expires_at)
     select c.id,$4,least(c.expires_at,now()+($5 * interval '1 second'))
     from pashloc_mfa_challenges c
     where c.challenge_hash=$1 and c.tenant_id=$2 and c.app_user_id=$3
       and c.purpose='enroll' and c.consumed_at is null
       and c.expires_at>now() and c.attempts<c.max_attempts
     returning expires_at`,
    [hash(input.challengeId),input.tenantId,input.userId,hash(pairingId),TTL_SECONDS]
  )
  if (result.rowCount !== 1) throw new Error("Enrollment challenge unavailable")
  return { pairingId, expiresAt: new Date(result.rows[0].expires_at).toISOString() }
}
