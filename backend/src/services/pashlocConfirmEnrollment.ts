/**
 * PashLoc IV MFA — isolated first-code enrollment confirmation.
 *
 * This is NOT a route and does not issue Navigator JWTs. The phone-secret
 * delivery protocol remains unimplemented; this function must not be exposed
 * until Security Assurance approves that protocol and its device binding.
 *
 * Transaction locks the enrollment challenge, pairing and enrollment rows.
 * A first valid code confirms only the same tenant/user's pending enrollment.
 */
import { createHash } from "node:crypto"
import { pool } from "../db/db"
import { decryptPashLocSecret } from "./pashlocSecretCrypto"
import { verifyPashLocTotp } from "./pashlocTotp"

const validToken = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s)
const sha = (s: string) => createHash("sha256").update(s).digest("hex")

export async function confirmPashLocFirstCode(input: {
  challengeId: string
  pairingId: string
  claimantToken: string
  code: string
}): Promise<{ tenantId: number; userId: number; accountId: string } | null> {
  if (![input.challengeId, input.pairingId, input.claimantToken].every(validToken) ||
      !/^\d{6}$/.test(input.code)) return null

  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const challenge = await client.query(
      `select id,tenant_id,app_user_id,attempts,max_attempts
         from pashloc_mfa_challenges
        where challenge_hash=$1 and purpose='enroll'
          and consumed_at is null and expires_at>now()
        for update`,
      [sha(input.challengeId)]
    )
    if (challenge.rowCount !== 1) { await client.query("ROLLBACK"); return null }
    const c = challenge.rows[0]
    if (c.attempts >= c.max_attempts) { await client.query("ROLLBACK"); return null }
    await client.query("update pashloc_mfa_challenges set attempts=attempts+1 where id=$1", [c.id])

    const pairing = await client.query(
      `select id from pashloc_mfa_pairings
        where challenge_id=$1 and pairing_hash=$2 and claimant_hash=$3
          and claimed_at is not null and browser_approved_at is not null
          and redeemed_at is not null and expires_at>now()
        for update`,
      [c.id, sha(input.pairingId), sha(input.claimantToken)]
    )
    if (pairing.rowCount !== 1) { await client.query("COMMIT"); return null }

    const enrolled = await client.query(
      `select e.account_id,e.encrypted_secret,e.last_accepted_step
         from pashloc_mfa_enrollments e
         join app_users u on u.id=e.app_user_id and u.tenant_id=e.tenant_id
        where e.tenant_id=$1 and e.app_user_id=$2
          and e.status='pending' and u.is_active=true
        for update of e`,
      [c.tenant_id,c.app_user_id]
    )
    if (enrolled.rowCount !== 1) { await client.query("COMMIT"); return null }
    const e = enrolled.rows[0]
    const secret = decryptPashLocSecret(e.encrypted_secret,Number(c.tenant_id),Number(c.app_user_id))
    const match = verifyPashLocTotp(secret,input.code,{
      lastAcceptedStep:e.last_accepted_step === null ? null : Number(e.last_accepted_step)
    })
    if (!match) { await client.query("COMMIT"); return null }

    const confirmed = await client.query(
      `update pashloc_mfa_enrollments
          set status='confirmed',confirmed_at=now(),last_accepted_step=$3
        where tenant_id=$1 and app_user_id=$2 and status='pending'
        returning account_id`,
      [c.tenant_id,c.app_user_id,match.acceptedStep]
    )
    const consumed = await client.query(
      `update pashloc_mfa_challenges set consumed_at=now()
        where id=$1 and consumed_at is null and expires_at>now()
        returning id`,[c.id]
    )
    if (confirmed.rowCount !== 1 || consumed.rowCount !== 1) {
      await client.query("ROLLBACK")
      return null
    }
    await client.query("COMMIT")
    return {tenantId:Number(c.tenant_id),userId:Number(c.app_user_id),accountId:String(e.account_id)}
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
