/** One-use redeem challenge for an approved PashLoc phone claim.
 * Synthetic-only isolated engineering. Does not transfer any credential.
 */
import {createHash,randomBytes} from "node:crypto"
import {pool} from "../db/db"
const sha=(v:string)=>createHash("sha256").update(v,"utf8").digest("hex")
const token=/^[A-Za-z0-9_-]{43}$/
export async function issuePashLocSyntheticRedeemNonce(input:{
 claimId:string;pairingRef:string;claimantProof:string
}):Promise<{redeem_nonce:string;expires_at:string}|null>{
 if(!token.test(input.claimId)||!token.test(input.pairingRef)||!token.test(input.claimantProof))return null
 const nonce=randomBytes(32).toString("base64url")
 const client=await pool.connect()
 try{
  await client.query("BEGIN")
  const r=await client.query(
   `update pashloc_mfa_pairings p set
      redemption_nonce_hash=$4,
      redemption_nonce_expires_at=least(p.expires_at,now()+interval '60 seconds'),
      redemption_nonce_consumed_at=null
     from pashloc_mfa_challenges c
    where p.challenge_id=c.id
      and p.pairing_hash=$1 and p.claim_id_hash=$2 and p.claimant_hash=$3
      and p.claimed_at is not null and p.browser_approved_at is not null
      and p.denied_at is null and p.redeemed_at is null
      and p.redemption_nonce_hash is null
      and p.expires_at>now()
      and c.purpose='enroll' and c.consumed_at is null and c.expires_at>now()
    returning p.redemption_nonce_expires_at`,
   [sha(input.pairingRef),sha(input.claimId),sha(input.claimantProof),sha(nonce)]
  )
  if(r.rowCount!==1){await client.query("ROLLBACK");return null}
  await client.query("COMMIT")
  return {redeem_nonce:nonce,expires_at:new Date(r.rows[0].redemption_nonce_expires_at).toISOString()}
 }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
}
