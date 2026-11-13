/** Single-use phone claim nonce, scoped to an unexpired enrollment pairing. */
import { createHash, randomBytes } from "node:crypto"
import { pool } from "../db/db"
const sha=(s:string)=>createHash("sha256").update(s).digest("hex")
export async function issuePashLocDeviceClaimNonce(pairingRef:string):Promise<string|null>{
 if(typeof pairingRef!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(pairingRef))return null
 const nonce=randomBytes(32).toString("base64url")
 const result=await pool.query(`insert into pashloc_mfa_device_claim_nonces(pairing_hash,nonce_hash,expires_at)
 select p.pairing_hash,$2,least(p.expires_at,now()+interval '90 seconds')
 from pashloc_mfa_pairings p join pashloc_mfa_challenges c on c.id=p.challenge_id
 where p.pairing_hash=$1 and p.claimed_at is null and p.denied_at is null
 and p.expires_at>now() and c.purpose='enroll' and c.consumed_at is null
 and c.expires_at>now() and c.attempts<c.max_attempts
 returning id`,[sha(pairingRef),sha(nonce)])
 return result.rowCount===1?nonce:null
}
