/**
 * PashLoc IV MFA — isolated pairing claim.
 * A QR scan alone NEVER enrolls an account, reveals a TOTP secret, or logs in.
 * This function only records the first phone claimant for a live pairing.
 * Browser approval, claimant proof, secret transfer and recovery are separate
 * security-reviewed milestones. NOT exposed as a production endpoint.
 */
import { createHash, randomBytes } from "node:crypto"
import { pool } from "../db/db"

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")
const tokenPattern = /^[A-Za-z0-9_-]{43}$/

export async function claimPashLocPairing(pairingId: string): Promise<{
  claimantToken: string
  expiresAt: string
} | null> {
  if (!tokenPattern.test(pairingId)) return null
  const claimantToken = randomBytes(32).toString("base64url")
  const result = await pool.query(
    `update pashloc_mfa_pairings p
        set claimant_hash=$2, claimed_at=now()
      from pashloc_mfa_challenges c
      where p.challenge_id=c.id
        and p.pairing_hash=$1
        and p.claimant_hash is null
        and p.claimed_at is null
        and p.browser_approved_at is null
        and p.redeemed_at is null
        and p.expires_at>now()
        and c.purpose='enroll'
        and c.consumed_at is null
        and c.expires_at>now()
        and c.attempts<c.max_attempts
      returning p.expires_at`,
    [sha256(pairingId), sha256(claimantToken)]
  )
  if (result.rowCount !== 1) return null
  return {
    claimantToken,
    expiresAt: new Date(result.rows[0].expires_at).toISOString()
  }
}

/** Read-only claimant status; does not prove browser approval or enrollment. */
export async function isPashLocPairingClaimant(
  pairingId: string,
  claimantToken: string
): Promise<boolean> {
  if (!tokenPattern.test(pairingId) || !tokenPattern.test(claimantToken)) return false
  const result = await pool.query(
    `select 1
       from pashloc_mfa_pairings p
       join pashloc_mfa_challenges c on c.id=p.challenge_id
      where p.pairing_hash=$1 and p.claimant_hash=$2
        and p.claimed_at is not null
        and p.expires_at>now()
        and p.redeemed_at is null
        and c.purpose='enroll'
        and c.consumed_at is null
        and c.expires_at>now()
      limit 1`,
    [sha256(pairingId),sha256(claimantToken)]
  )
  return result.rowCount === 1
}
