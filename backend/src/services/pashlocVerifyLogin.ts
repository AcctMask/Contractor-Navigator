/** Production-compatible one-time PashLoc verification. Never issues a session. */
import { pool } from "../db/db"
import { decryptPashLocSecret } from "./pashlocSecretCrypto"
import { verifyPashLocTotp } from "./pashlocTotp"
import { createHash } from "node:crypto"

export async function verifyPashLocReturningLogin(
  challengeId: string,
  suppliedCode: string
): Promise<{ tenantId: number; userId: number } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(challengeId) || !/^\d{6}$/.test(suppliedCode)) return null
  const hash = createHash("sha256").update(challengeId).digest("hex")
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const challenge = await client.query(
      `select id,tenant_id,app_user_id,attempts,max_attempts
       from pashloc_mfa_challenges
       where challenge_hash=$1 and purpose='verify'
         and consumed_at is null and expires_at>now()
       for update`,
      [hash]
    )
    if (!challenge.rowCount) { await client.query("ROLLBACK"); return null }
    const c = challenge.rows[0]
    if (c.attempts >= c.max_attempts) { await client.query("ROLLBACK"); return null }
    await client.query(
      "update pashloc_mfa_challenges set attempts=attempts+1 where id=$1",
      [c.id]
    )
    // Lock the account policy in the same transaction as OTP consumption.
    // Recovery or account deactivation must invalidate pending challenges.
    const policy = await client.query(
      `select pashloc_mfa_required,pashloc_mfa_activated_at
       from app_users where id=$1 and tenant_id=$2 and is_active=true
       for share`,
      [c.app_user_id,c.tenant_id]
    )
    if (policy.rowCount !== 1 || policy.rows[0].pashloc_mfa_required !== true ||
        !policy.rows[0].pashloc_mfa_activated_at) {
      await client.query("COMMIT"); return null
    }
    const enrolled = await client.query(
      `select e.id,e.account_id,e.encrypted_secret,e.last_accepted_step
       from pashloc_mfa_enrollments e
       join app_users u on u.id=e.app_user_id and u.tenant_id=e.tenant_id
       where e.tenant_id=$1 and e.app_user_id=$2
         and e.status='confirmed' and u.is_active=true
         and e.delivery_pairing_id is not null and e.encryption_key_version='navigator-account-v1'
       for update of e`,
      [c.tenant_id,c.app_user_id]
    )
    if (!enrolled.rowCount) { await client.query("COMMIT"); return null }
    const e = enrolled.rows[0]
    const secret = decryptPashLocSecret(e.encrypted_secret,Number(c.tenant_id),Number(c.app_user_id),e.account_id)
    const match = verifyPashLocTotp(secret,suppliedCode,{
      lastAcceptedStep: e.last_accepted_step === null ? null : Number(e.last_accepted_step)
    })
    if (!match) { await client.query("COMMIT"); return null }
    const updated = await client.query(
      `update pashloc_mfa_enrollments set last_accepted_step=$3
       where tenant_id=$1 and app_user_id=$2
         and (last_accepted_step is null or last_accepted_step<$3)
       returning id`,
      [c.tenant_id,c.app_user_id,match.acceptedStep]
    )
    if (updated.rowCount !== 1) { await client.query("ROLLBACK"); return null }
    const consumed = await client.query(
      `update pashloc_mfa_challenges set consumed_at=now()
       where id=$1 and consumed_at is null and expires_at>now()
       returning id`,[c.id]
    )
    if (consumed.rowCount !== 1) { await client.query("ROLLBACK"); return null }
    await client.query("COMMIT")
    return {tenantId:Number(c.tenant_id),userId:Number(c.app_user_id)}
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
