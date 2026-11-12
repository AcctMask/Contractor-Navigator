/** Isolated synthetic-only redemption. NEVER use a real account secret.
 * Transaction serializes redemption and persists an immutable encrypted
 * envelope; only an approved, signed device can receive it.
 */
import {createHash,randomBytes} from "node:crypto"
import {pool} from "../db/db"
import {normalizedP256PublicKey,publicKeyFingerprint,redeemTranscript,verifyP1363Proof,encryptSyntheticEnrollmentV1} from "./pashlocEnrollV1Crypto"
const sha=(v:string)=>createHash("sha256").update(v,"utf8").digest("hex")
const token=/^[A-Za-z0-9_-]{43}$/
export async function redeemPashLocSynthetic(input:{
 pairing_ref:string;claim_id:string;claimant_proof:string;
 redeem_nonce:string;redeem_signature:string
}):Promise<unknown|null>{
 if(!input||![input.pairing_ref,input.claim_id,input.claimant_proof,input.redeem_nonce].every(v=>typeof v==="string"&&token.test(v))||
    typeof input.redeem_signature!=="string")return null
 const client=await pool.connect()
 try{
  await client.query("BEGIN")
  const r=await client.query(
   `select p.id,p.device_public_jwk,p.device_ecdh_public_jwk,
      p.device_key_fingerprint,p.device_ecdh_key_fingerprint,
      p.redemption_nonce_hash,p.redemption_nonce_expires_at,
      p.redemption_nonce_consumed_at,p.synthetic_envelope,
      p.synthetic_redeem_proof_hash,p.browser_approved_at,
      p.synthetic_retry_nonce_hash,p.synthetic_retry_nonce_expires_at,
      p.synthetic_recovery_expires_at,p.synthetic_retry_attempts,
      c.tenant_id,c.app_user_id,c.purpose
     from pashloc_mfa_pairings p
     join pashloc_mfa_challenges c on c.id=p.challenge_id
    where p.pairing_hash=$1 and p.claim_id_hash=$2 and p.claimant_hash=$3
      and p.claimed_at is not null and p.browser_approved_at is not null
      and p.denied_at is null
      and (p.expires_at>now() or (p.synthetic_envelope is not null and p.synthetic_recovery_expires_at>now()))
      and c.purpose='enroll' and c.consumed_at is null
    for update of p,c`,
   [sha(input.pairing_ref),sha(input.claim_id),sha(input.claimant_proof)]
  )
  if(r.rowCount!==1){await client.query("ROLLBACK");return null}
  const p=r.rows[0]
  const sign=normalizedP256PublicKey(p.device_public_jwk)
  const agree=normalizedP256PublicKey(p.device_ecdh_public_jwk)
  if(publicKeyFingerprint(sign)!==p.device_key_fingerprint||
     publicKeyFingerprint(agree)!==p.device_ecdh_key_fingerprint){
   await client.query("ROLLBACK");return null
  }
  const transcript=redeemTranscript({
   claimId:input.claim_id,pairingRef:input.pairing_ref,nonce:input.redeem_nonce,
   signingKey:sign,agreementKey:agree
  })
  if(!verifyP1363Proof(sign,transcript,input.redeem_signature)){
   await client.query("ROLLBACK");return null
  }
  const proofHash=sha(input.redeem_nonce+"."+input.redeem_signature)
  if(p.synthetic_envelope){
   // Fresh signed same-device nonce required; the original proof cannot be replayed.
   if(!p.synthetic_retry_nonce_hash||
      p.synthetic_retry_nonce_hash!==sha(input.redeem_nonce)||
      !p.synthetic_retry_nonce_expires_at||
      new Date(p.synthetic_retry_nonce_expires_at).getTime()<=Date.now()||
      !p.synthetic_recovery_expires_at||
      new Date(p.synthetic_recovery_expires_at).getTime()<=Date.now()||
      p.synthetic_retry_attempts>5){
    await client.query("ROLLBACK");return null
   }
   const consumed=await client.query(
    `update pashloc_mfa_pairings
      set synthetic_retry_nonce_hash=null,synthetic_retry_nonce_expires_at=null
      where id=$1 and synthetic_retry_nonce_hash=$2
        and synthetic_recovery_expires_at>now()
      returning id`,[p.id,sha(input.redeem_nonce)]
   )
   if(consumed.rowCount!==1){await client.query("ROLLBACK");return null}
   await client.query("COMMIT")
   return p.synthetic_envelope
  }
  if(p.redemption_nonce_consumed_at!==null||
     p.redemption_nonce_hash!==sha(input.redeem_nonce)||
     !p.redemption_nonce_expires_at||
     new Date(p.redemption_nonce_expires_at).getTime()<=Date.now()){
   await client.query("ROLLBACK");return null
  }
  // Synthetic, random, disposable test-only Base32 secret; not sourced
  // from a real enrollment, user account, environment, or credential store.
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  const raw=randomBytes(32)
  const syntheticSecret=Array.from(raw,b=>alphabet[b&31]).join("")
  raw.fill(0)
  const context={
   version:"AA-PASHLOC-ENROLL-V1",environment:"isolated",
   application:"Navigator",tenantId:String(p.tenant_id),
   userId:String(p.app_user_id),accountId:"synthetic_"+String(p.id),
   pairingRef:input.pairing_ref,claimId:input.claim_id,
   signingFingerprint:p.device_key_fingerprint,
   agreementFingerprint:p.device_ecdh_key_fingerprint,
   redeemNonce:input.redeem_nonce,approvalId:"approval_"+String(p.id)
  }
  const envelope=encryptSyntheticEnrollmentV1({
   syntheticSecret,deviceEcdhPublicJwk:agree,context
  })
  const update=await client.query(
   `update pashloc_mfa_pairings
       set synthetic_envelope=$2::jsonb,
           synthetic_redeem_proof_hash=$3,
           redemption_nonce_consumed_at=now(),
           redeemed_at=now(),
           synthetic_recovery_expires_at=now()+interval '5 minutes'
     where id=$1 and synthetic_envelope is null and redeemed_at is null
     returning id`,
   [p.id,JSON.stringify(envelope),proofHash]
  )
  if(update.rowCount!==1){await client.query("ROLLBACK");return null}
  await client.query("COMMIT")
  return envelope
 }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
}
