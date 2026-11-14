/**
 * PashLoc IV MFA — isolated browser approval v2.
 * Must be invoked ONLY after the original Navigator restricted browser
 * challenge and CSRF token have been verified by the route layer.
 * The phone displays the 8-digit confirmation code; browser user enters it.
 * This does not return an enrollment secret or issue a session.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { pool } from "../db/db"

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")
const token = /^[A-Za-z0-9_-]{43}$/
const sameHash = (a: string, b: string) => {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex")
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function approvePashLocDeviceClaim(input: {
  challengeId: string
  claimId?: string
  pairingRef?: string
  confirmationCode: string
  tenantId: number
  userId: number
}): Promise<{ approved: boolean; expiresAt?: string }> {
  if (!token.test(input.challengeId) || !(input.claimId ? token.test(input.claimId) : token.test(input.pairingRef || "")) ||
      !/^\d{8}$/.test(input.confirmationCode) ||
      !Number.isSafeInteger(input.tenantId) || input.tenantId <= 0 ||
      !Number.isSafeInteger(input.userId) || input.userId <= 0) {
    return { approved: false }
  }
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await client.query(
      `select p.id,p.confirmation_code_hash,p.confirmation_attempts,p.expires_at
         from pashloc_mfa_challenges c
         join pashloc_mfa_pairings p on p.challenge_id=c.id
        where c.challenge_hash=$1 and c.tenant_id=$2 and c.app_user_id=$3
          and c.purpose='enroll' and c.consumed_at is null
          and c.expires_at>now() and c.attempts<c.max_attempts
          and (($4::text is not null and p.claim_id_hash=$4)
            or ($4 is null and p.pairing_hash=$5)) and p.claimed_at is not null
          and p.browser_approved_at is null and p.denied_at is null
          and p.redeemed_at is null and p.expires_at>now()
        for update of c,p`,
      [sha(input.challengeId),input.tenantId,input.userId,input.claimId ? sha(input.claimId) : null, input.pairingRef ? sha(input.pairingRef) : null]
    )
    if (result.rowCount !== 1) { await client.query("ROLLBACK"); return {approved:false} }
    const p = result.rows[0]
    if (p.confirmation_attempts >= 5) { await client.query("ROLLBACK"); return {approved:false} }
    await client.query(
      "update pashloc_mfa_pairings set confirmation_attempts=confirmation_attempts+1 where id=$1",
      [p.id]
    )
    const valid = sameHash(sha(input.confirmationCode),String(p.confirmation_code_hash))
    if (!valid) { await client.query("COMMIT"); return {approved:false} }
    const updated = await client.query(
      `update pashloc_mfa_pairings set browser_approved_at=now(),browser_approval_id=$2
        where id=$1 and browser_approved_at is null and denied_at is null
          and expires_at>now() returning expires_at`,
      [p.id,randomBytes(24).toString("base64url")]
    )
    await client.query("COMMIT")
    return updated.rowCount === 1
      ? {approved:true,expiresAt:new Date(updated.rows[0].expires_at).toISOString()}
      : {approved:false}
  } catch(e) { await client.query("ROLLBACK"); throw e }
  finally { client.release() }
}
