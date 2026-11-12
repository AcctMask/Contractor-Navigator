/**
 * PashLoc IV MFA isolated device claim v2.
 * Performs a real database transaction. No TOTP secret or session is returned.
 * Requires the isolated pairing-protocol schema migration.
 */
import { createHash, randomBytes, randomInt } from "node:crypto"
import { claimTranscript, normalizedP256PublicKey, publicKeyFingerprint, verifyP1363Proof } from "./pashlocEnrollV1Crypto"
import { pool } from "../db/db"

const hash = (s: string) => createHash("sha256").update(s).digest("hex")
const token = /^[A-Za-z0-9_-]{43}$/
type PublicJwk = { kty: string; crv: string; x: string; y: string }

export async function claimPashLocDevice(input: {
  pairing_ref: string
  device_public_key_jwk: PublicJwk
  device_ecdh_public_key_jwk: PublicJwk
  proof_nonce: string
  proof_signature: string
  protocol_version: "AA-PASHLOC-ENROLL-V1"
}): Promise<{ claim_id: string; claimant_proof: string; confirmation_code: string; expires_at: string } | null> {
  if (!token.test(input.pairing_ref) || !token.test(input.proof_nonce) ||
      !/^[A-Za-z0-9_-]{64,256}$/.test(input.proof_signature)) return null
  if (input.protocol_version !== "AA-PASHLOC-ENROLL-V1") return null
  let jwk: ReturnType<typeof normalizedP256PublicKey>
  let agreement: ReturnType<typeof normalizedP256PublicKey>
  try {
    jwk = normalizedP256PublicKey(input.device_public_key_jwk)
    agreement = normalizedP256PublicKey(input.device_ecdh_public_key_jwk)
    const transcript = claimTranscript({
      pairingRef: input.pairing_ref,
      nonce: input.proof_nonce,
      signingKey: jwk,
      agreementKey: agreement,
    })
    if (!verifyP1363Proof(jwk, transcript, input.proof_signature)) return null
  } catch { return null }

  const claimId = randomBytes(32).toString("base64url")
  const claimantProof = randomBytes(32).toString("base64url")
  const confirmationCode = String(randomInt(0, 100000000)).padStart(8,"0")
  const fingerprint = publicKeyFingerprint(jwk)
  const agreementFingerprint = publicKeyFingerprint(agreement)
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const nonceUsed = await client.query(`update pashloc_mfa_device_claim_nonces set consumed_at=now() where pairing_hash=$1 and nonce_hash=$2 and consumed_at is null and expires_at>now() returning id`,[hash(input.pairing_ref),hash(input.proof_nonce)])
    if(nonceUsed.rowCount!==1){await client.query("ROLLBACK");return null}
    const claimed = await client.query(
      `update pashloc_mfa_pairings p
         set claimant_hash=$2, claimed_at=now(), device_public_jwk=$3::jsonb,
             device_key_fingerprint=$4, claim_id_hash=$5, confirmation_code_hash=$6,
             device_ecdh_public_jwk=$7::jsonb, device_ecdh_key_fingerprint=$8
        from pashloc_mfa_challenges c
       where p.challenge_id=c.id and p.pairing_hash=$1
         and p.claimant_hash is null and p.claimed_at is null
         and p.browser_approved_at is null and p.redeemed_at is null
         and p.denied_at is null and p.expires_at>now()
         and c.purpose='enroll' and c.consumed_at is null
         and c.expires_at>now() and c.attempts<c.max_attempts
       returning p.expires_at`,
      [hash(input.pairing_ref),hash(claimantProof),JSON.stringify(jwk),fingerprint,
       hash(claimId),hash(confirmationCode),JSON.stringify(agreement),agreementFingerprint]
    )
    if (claimed.rowCount !== 1) { await client.query("ROLLBACK"); return null }
    await client.query("COMMIT")
    return { claim_id:claimId, claimant_proof:claimantProof,
      confirmation_code:confirmationCode,
      expires_at:new Date(claimed.rows[0].expires_at).toISOString() }
  } catch (e) { await client.query("ROLLBACK"); throw e }
  finally { client.release() }
}
