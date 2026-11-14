/** Genuine Navigator enrollment redemption. No session issuance.
 * Transaction serializes redemption and persists an immutable encrypted
 * envelope; only an approved, signed device can receive it.
 */
import {createHash,randomBytes} from "node:crypto"
import {pool} from "../db/db"
import {normalizedP256PublicKey,publicKeyFingerprint,redeemTranscript,verifyP1363Proof,encryptNavigatorCredentialV1} from "./pashlocEnrollV1Crypto"
import {generatePashLocTotpSecret} from "./pashlocTotp"
import {encryptPashLocSecret} from "./pashlocSecretCrypto"
const sha=(v:string)=>createHash("sha256").update(v,"utf8").digest("hex")
const token=/^[A-Za-z0-9_-]{43}$/
export async function redeemPashLocNavigator(input:{
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
      p.redemption_nonce_consumed_at,p.credential_envelope,
      p.credential_redeem_proof_hash,p.browser_approved_at,
      p.credential_retry_nonce_hash,p.credential_retry_nonce_expires_at,
      p.credential_recovery_expires_at,p.credential_retry_attempts,
      c.tenant_id,c.app_user_id,c.purpose,p.browser_approval_id
     from pashloc_mfa_pairings p
     join pashloc_mfa_challenges c on c.id=p.challenge_id
    where p.pairing_hash=$1 and p.claim_id_hash=$2 and p.claimant_hash=$3
      and p.claimed_at is not null and p.browser_approved_at is not null
      and p.denied_at is null
      and (p.expires_at>now() or (p.credential_envelope is not null and p.credential_recovery_expires_at>now()))
      and c.purpose='enroll' and c.consumed_at is null
      and (c.expires_at>now() or (p.credential_envelope is not null and p.credential_recovery_expires_at>now()))
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
  if(p.credential_envelope){
   // Fresh signed same-device nonce required; the original proof cannot be replayed.
   if(!p.credential_retry_nonce_hash||
      p.credential_retry_nonce_hash!==sha(input.redeem_nonce)||
      !p.credential_retry_nonce_expires_at||
      new Date(p.credential_retry_nonce_expires_at).getTime()<=Date.now()||
      !p.credential_recovery_expires_at||
      new Date(p.credential_recovery_expires_at).getTime()<=Date.now()||
      p.credential_retry_attempts>5){
    await client.query("ROLLBACK");return null
   }
   const consumed=await client.query(
    `update pashloc_mfa_pairings
      set credential_retry_nonce_hash=null,credential_retry_nonce_expires_at=null
      where id=$1 and credential_retry_nonce_hash=$2
        and credential_recovery_expires_at>now()
      returning id`,[p.id,sha(input.redeem_nonce)]
   )
   if(consumed.rowCount!==1){await client.query("ROLLBACK");return null}
   await client.query("COMMIT")
   return p.credential_envelope
  }
  if(p.redemption_nonce_consumed_at!==null||
     p.redemption_nonce_hash!==sha(input.redeem_nonce)||
     !p.redemption_nonce_expires_at||
     new Date(p.redemption_nonce_expires_at).getTime()<=Date.now()){
   await client.query("ROLLBACK");return null
  }
  if(!p.browser_approval_id){await client.query("ROLLBACK");return null}
  const accountId=randomBytes(24).toString("base64url")
  const credentialSecret=generatePashLocTotpSecret()
  const encrypted=encryptPashLocSecret(credentialSecret,Number(p.tenant_id),Number(p.app_user_id),accountId)
  const pending=await client.query(
   `insert into pashloc_mfa_enrollments
      (tenant_id,app_user_id,account_id,encrypted_secret,encryption_key_version,status,delivery_pairing_id)
     select tenant_id,id,$3,$4,'navigator-account-v1','pending',$5
       from app_users where tenant_id=$1 and id=$2 and is_active=true
     on conflict (tenant_id,app_user_id) do nothing returning id`,
   [p.tenant_id,p.app_user_id,accountId,encrypted,p.id]
  )
  if(pending.rowCount!==1){await client.query("ROLLBACK");return null}
  const context={
   version:"AA-PASHLOC-ENROLL-V1",
   // Distinct authenticated credential domain for explicitly isolated acceptance.
   // Never infer acceptance from a phone request or a QR parameter.
   environment:process.env.PASHLOC_ACCEPTANCE_ONLY==="yes" &&
     process.env.PASHLOC_ACCEPTANCE_DATABASE_CONFIRMED==="yes" &&
     process.env.NODE_ENV!=="production" &&
     process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME &&
     (()=>{try{return decodeURIComponent(new URL(process.env.DATABASE_URL||"").pathname.slice(1))===process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME}catch{return false}})()
     ? "acceptance" : "production",
   application:"Navigator",tenantId:String(p.tenant_id),
   userId:String(p.app_user_id),accountId,
   pairingRef:input.pairing_ref,claimId:input.claim_id,
   signingFingerprint:p.device_key_fingerprint,
   agreementFingerprint:p.device_ecdh_key_fingerprint,
   redeemNonce:input.redeem_nonce,approvalId:String(p.browser_approval_id)
  }
  const envelope=encryptNavigatorCredentialV1({
   secret:credentialSecret,deviceEcdhPublicJwk:agree,context
  })
  const update=await client.query(
   `update pashloc_mfa_pairings
       set credential_envelope=$2::jsonb,
           credential_redeem_proof_hash=$3,
           redemption_nonce_consumed_at=now(),
           redeemed_at=now(),
           credential_recovery_expires_at=now()+interval '5 minutes'
     where id=$1 and credential_envelope is null and redeemed_at is null
     returning id`,
   [p.id,JSON.stringify(envelope),proofHash]
  )
  if(update.rowCount!==1){await client.query("ROLLBACK");return null}
  await client.query("COMMIT")
  return envelope
 }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
}
