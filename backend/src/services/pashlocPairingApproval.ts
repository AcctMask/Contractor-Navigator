/**
 * PashLoc IV MFA — isolated browser approval of a phone pairing claimant.
 *
 * Security boundary: the browser must receive the claimant token via a
 * separate, user-confirmed channel (for example a phone-displayed code).
 * Merely scanning the QR or knowing the pairing reference is insufficient.
 * This does NOT release a TOTP secret, confirm enrollment, or issue a JWT.
 *
 * NOT connected to production routes.
 */
import { createHash } from "node:crypto"
import { pool } from "../db/db"

const tokenPattern = /^[A-Za-z0-9_-]{43}$/
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex")

export async function approvePashLocPairing(input: {
  challengeId: string
  pairingId: string
  claimantToken: string
  tenantId: number
  userId: number
}): Promise<{ expiresAt: string } | null> {
  if (!tokenPattern.test(input.challengeId) ||
      !tokenPattern.test(input.pairingId) ||
      !tokenPattern.test(input.claimantToken) ||
      !Number.isSafeInteger(input.tenantId) || input.tenantId <= 0 ||
      !Number.isSafeInteger(input.userId) || input.userId <= 0) return null

  const result = await pool.query(
    `update pashloc_mfa_pairings p
       set browser_approved_at=now()
      from pashloc_mfa_challenges c
     where p.challenge_id=c.id
       and c.challenge_hash=$1
       and c.tenant_id=$2 and c.app_user_id=$3
       and c.purpose='enroll'
       and c.consumed_at is null
       and c.expires_at>now()
       and c.attempts<c.max_attempts
       and p.pairing_hash=$4
       and p.claimant_hash=$5
       and p.claimed_at is not null
       and p.browser_approved_at is null
       and p.redeemed_at is null
       and p.expires_at>now()
     returning p.expires_at`,
    [sha256(input.challengeId), input.tenantId, input.userId,
      sha256(input.pairingId), sha256(input.claimantToken)]
  )
  if (result.rowCount !== 1) return null
  return { expiresAt: new Date(result.rows[0].expires_at).toISOString() }
}
