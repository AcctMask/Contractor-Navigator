/** Isolated first-code confirmation for a delivered disposable credential. */
import { createHash } from "node:crypto"
import { pool } from "../db/db"
import { decryptPashLocSecret } from "./pashlocSecretCrypto"
import { verifyPashLocTotp } from "./pashlocTotp"

const validToken = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s)
const sha = (s: string) => createHash("sha256").update(s).digest("hex")

// Diagnostic events contain only the failure stage, never a code, secret,
// pairing reference, challenge identifier, user identifier or credential.
const diagnostic = (reason: string) => {
  if (process.env.PASHLOC_ACCEPTANCE_ONLY === "yes" &&
      process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME === "pashloc_iv_disposable_mfa_isolated") {
    console.info("PASHLOC_ACCEPTANCE_CONFIRM_DIAGNOSTIC", JSON.stringify({reason}))
  }
}

export async function confirmPashLocFirstCode(input: {
  challengeId: string
  pairingId: string
  tenantId: number
  userId: number
  code: string
}): Promise<{ tenantId: number; userId: number; accountId: string } | null> {
  if (![input.challengeId, input.pairingId].every(validToken) ||
      !/^\d{6}$/.test(input.code)) return null

  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const challenge = await client.query(
      `select id,tenant_id,app_user_id,attempts,max_attempts
         from pashloc_mfa_challenges
        where challenge_hash=$1 and purpose='enroll'
          and consumed_at is null and expires_at>now()
          and tenant_id=$2 and app_user_id=$3
        for update`,
      [sha(input.challengeId),input.tenantId,input.userId]
    )
    if (challenge.rowCount !== 1) { diagnostic("challenge_missing_or_expired"); await client.query("ROLLBACK"); return null }
    const c = challenge.rows[0]
    if (c.attempts >= c.max_attempts) { diagnostic("challenge_attempt_limit"); await client.query("ROLLBACK"); return null }
    await client.query("update pashloc_mfa_challenges set attempts=attempts+1 where id=$1", [c.id])

    const pairing = await client.query(
      `select id from pashloc_mfa_pairings
        where challenge_id=$1 and pairing_hash=$2 and denied_at is null
          and claimed_at is not null and browser_approved_at is not null
          and redeemed_at is not null and credential_envelope is not null
          and (expires_at>now() or credential_recovery_expires_at>now())
        for update`,
      [c.id, sha(input.pairingId)]
    )
    if (pairing.rowCount !== 1) { diagnostic("pairing_state_or_expiration"); await client.query("COMMIT"); return null }

    const enrolled = await client.query(
      `select e.account_id,e.encrypted_secret,e.last_accepted_step
         from pashloc_mfa_enrollments e
         join app_users u on u.id=e.app_user_id and u.tenant_id=e.tenant_id
        where e.tenant_id=$1 and e.app_user_id=$2
          and e.delivery_pairing_id=$3 and e.encryption_key_version='navigator-account-v1'
          and e.status='pending' and u.is_active=true
        for update of e`,
      [c.tenant_id,c.app_user_id,pairing.rows[0].id]
    )
    if (enrolled.rowCount !== 1) { diagnostic("pending_credential_missing"); await client.query("COMMIT"); return null }
    const e = enrolled.rows[0]
    const secret = decryptPashLocSecret(e.encrypted_secret,Number(c.tenant_id),Number(c.app_user_id),e.account_id)
    const match = verifyPashLocTotp(secret,input.code,{
      lastAcceptedStep:e.last_accepted_step === null ? null : Number(e.last_accepted_step)
    })
    if (!match) { diagnostic("totp_mismatch"); await client.query("COMMIT"); return null }

    const confirmed = await client.query(
      `update pashloc_mfa_enrollments
          set status='confirmed',confirmed_at=now(),last_accepted_step=$3
        where tenant_id=$1 and app_user_id=$2 and status='pending' and delivery_pairing_id=$4
        returning account_id`,
      [c.tenant_id,c.app_user_id,match.acceptedStep,pairing.rows[0].id]
    )
    const consumed = await client.query(
      `update pashloc_mfa_challenges set consumed_at=now()
        where id=$1 and consumed_at is null and expires_at>now()
        returning id`,[c.id]
    )
    if (confirmed.rowCount !== 1 || consumed.rowCount !== 1) {
      diagnostic("confirmation_transaction_conflict")
      await client.query("ROLLBACK")
      return null
    }
    await client.query(
      `update pashloc_mfa_pairings
          set credential_envelope=null,credential_retry_nonce_hash=null,credential_retry_nonce_expires_at=null
        where id=$1`,[pairing.rows[0].id])
    // Activate MFA only for the exact successfully confirmed user in the same transaction.
    const activated = await client.query(
      `update app_users set pashloc_mfa_required=true,
         pashloc_mfa_activated_at=date_trunc('second',now())
       where id=$1 and tenant_id=$2 and is_active=true
         and pashloc_mfa_required=false
       returning id`, [c.app_user_id,c.tenant_id]
    )
    if (activated.rowCount !== 1) {
      // The disposable acceptance bootstrap pre-enables MFA solely to route
      // the acceptance account through enrollment. Accept that existing flag
      // only after the genuine TOTP matched and challenge was consumed.
      const acceptanceBootstrap =
        process.env.NODE_ENV === "test" &&
        process.env.PASHLOC_ACCEPTANCE_ONLY === "yes" &&
        process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME === "pashloc_iv_disposable_mfa_isolated" &&
        process.env.PASHLOC_ACCEPTANCE_BOOTSTRAP_ACCOUNT === "yes"
      if (!acceptanceBootstrap) {
        diagnostic("activation_not_allowed")
        await client.query("ROLLBACK")
        return null
      }
      const identity = await client.query("select current_database() as db,current_user as role")
      if (identity.rows[0]?.db !== "pashloc_iv_disposable_mfa_isolated" ||
          identity.rows[0]?.role !== "pashloc_iv_disposable_mfa_isolated_user") {
        diagnostic("acceptance_database_identity_rejected")
        await client.query("ROLLBACK")
        return null
      }
      const preenabled = await client.query(
        `select u.id from app_users u join tenants t on t.id=u.tenant_id
          where u.id=$1 and u.tenant_id=$2 and u.is_active=true
            and u.pashloc_mfa_required=true
            and u.email in ('navigator-acceptance@example.invalid','steve@g2groofing.com')
            and t.slug='pashloc-genuine-acceptance-20261114'`,
        [c.app_user_id,c.tenant_id]
      )
      if (preenabled.rowCount !== 1) {
        diagnostic("acceptance_preenabled_identity_rejected")
        await client.query("ROLLBACK")
        return null
      }
    }
    await client.query("COMMIT")
    diagnostic("confirmed")
    return {tenantId:Number(c.tenant_id),userId:Number(c.app_user_id),accountId:String(e.account_id)}
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
