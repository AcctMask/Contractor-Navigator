/** Server-issued one-use PashLoc claim challenge; isolated, no session. */
import {createHash,randomBytes} from "node:crypto"
import {pool} from "../db/db"
const hash=(v:string)=>createHash("sha256").update(v).digest("hex")
const valid=(v:string)=>/^[A-Za-z0-9_-]{43}$/.test(v)
export async function issuePashLocDeviceClaimNonce(pairingRef:string) {
 if(!valid(pairingRef)) return null
 const nonce=randomBytes(32).toString("base64url")
 const result=await pool.query(
 `insert into pashloc_mfa_device_claim_nonces(pairing_hash,nonce_hash,expires_at)
 select p.pairing_hash,$2,least(p.expires_at,now()+interval '60 seconds')
 from pashloc_mfa_pairings p join pashloc_mfa_challenges c on c.id=p.challenge_id
 where p.pairing_hash=$1 and p.claimed_at is null and p.denied_at is null
 and p.expires_at>now() and c.consumed_at is null and c.purpose='enroll'
 and c.expires_at>now() returning expires_at`,
 [hash(pairingRef),hash(nonce)])
 return result.rowCount===1?{nonce,expires_at:new Date(result.rows[0].expires_at).toISOString()}:null
}
