/**
 * PashLoc IV MFA isolated device claim v2.
 * Performs a real database transaction. No TOTP secret or session is returned.
 * Requires the isolated pairing-protocol schema migration.
 */
import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto"
import { pool } from "../db/db"

const hash = (s: string) => createHash("sha256").update(s).digest("hex")
const token = /^[A-Za-z0-9_-]{43}$/
type PublicJwk = { kty: string; crv: string; x: string; y: string }

export async function claimPashLocDevice(input: {
  pairing_ref: string
  device_public_key_jwk: PublicJwk
  proof_nonce: string
  proof_signature: string
}): Promise<{ claim_id: string; claimant_proof: string; confirmation_code: string; expires_at: string } | null> {
  if (!token.test(input.pairing_ref) || !token.test(input.proof_nonce) ||
      !/^[A-Za-z0-9_-]{64,256}$/.test(input.proof_signature)) return null
  const jwk = input.device_public_key_jwk
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(jwk.x) ||
      !/^[A-Za-z0-9_-]{43}$/.test(jwk.y)) return null
  let publicKey
  try {
    publicKey = createPublicKey({ key: jwk as any, format: "jwk" })
    const signature = Buffer.from(input.proof_signature, "base64url")
    const transcript = Buffer.from("PASHLOC-IV-MFA-CLAIM-v1\n" + input.pairing_ref + "\n" + input.proof_nonce)
    if (!verifySignature("sha256", transcript, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)) return null
  } catch { return null }

  const claimId = randomBytes(32).toString("base64url")
  const claimantProof = randomBytes(32).toString("base64url")
  const confirmationCode = String(randomBytes(4).readUInt32BE() % 100000000).padStart(8,"0")
  const fingerprint = hash(JSON.stringify({ kty:"EC",crv:"P-256",x:jwk.x,y:jwk.y }))
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const nonceUsed = await client.query(`update pashloc_mfa_device_claim_nonces set consumed_at=now() where pairing_hash=$1 and nonce_hash=$2 and consumed_at is null and expires_at>now() returning id`,[hash(input.pairing_ref),hash(input.proof_nonce)])
    if(nonceUsed.rowCount!==1){await client.query("ROLLBACK");return null}
    const claimed = await client.query(
      `update pashloc_mfa_pairings p
         set claimant_hash=$2, claimed_at=now(), device_public_jwk=$3::jsonb,
             device_key_fingerprint=$4, claim_id_hash=$5, confirmation_code_hash=$6
        from pashloc_mfa_challenges c
       where p.challenge_id=c.id and p.pairing_hash=$1
         and p.claimant_hash is null and p.claimed_at is null
         and p.browser_approved_at is null and p.redeemed_at is null
         and p.denied_at is null and p.expires_at>now()
         and c.purpose='enroll' and c.consumed_at is null
         and c.expires_at>now() and c.attempts<c.max_attempts
       returning p.expires_at`,
      [hash(input.pairing_ref),hash(claimantProof),JSON.stringify(jwk),fingerprint,
       hash(claimId),hash(confirmationCode)]
    )
    if (claimed.rowCount !== 1) { await client.query("ROLLBACK"); return null }
    await client.query("COMMIT")
    return { claim_id:claimId, claimant_proof:claimantProof,
      confirmation_code:confirmationCode,
      expires_at:new Date(claimed.rows[0].expires_at).toISOString() }
  } catch (e) { await client.query("ROLLBACK"); throw e }
  finally { client.release() }
}
