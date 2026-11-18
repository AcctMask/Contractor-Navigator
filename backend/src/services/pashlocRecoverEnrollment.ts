/** Acceptance-only, password-authorized recovery of an inaccessible redeemed enrollment.
 * The route authenticates the existing account password and requires an explicit recovery approval.
 * This transaction preserves the old enrollment row and all pairing/challenge audit rows.
 */
import {createHash,randomBytes} from "node:crypto"
import {pool} from "../db/db"

export async function recoverInaccessiblePashLocEnrollment(input:{tenantId:number;userId:number;challengeId:string;enrollmentId:number}){
 if(process.env.PASHLOC_ACCEPTANCE_ONLY!=="yes"||process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME!=="pashloc_iv_disposable_mfa_isolated")return null
 if(!Number.isSafeInteger(input.tenantId)||!Number.isSafeInteger(input.userId)||!Number.isSafeInteger(input.enrollmentId)||!/^[A-Za-z0-9_-]{43}$/.test(input.challengeId))return null
 const client=await pool.connect()
 try{
  await client.query("BEGIN")
  const db=await client.query("select current_database() as db,current_user as role")
  if(db.rows[0]?.db!=="pashloc_iv_disposable_mfa_isolated"||db.rows[0]?.role!=="pashloc_iv_disposable_mfa_isolated_user"){await client.query("ROLLBACK");return null}
  const identity=await client.query("select id from app_users where id=$1 and tenant_id=$2 and is_active=true for update",[input.userId,input.tenantId])
  if(identity.rowCount!==1){await client.query("ROLLBACK");return null}
  const old=await client.query(`select e.id from pashloc_mfa_enrollments e join pashloc_mfa_pairings p on p.id=e.delivery_pairing_id
   where e.id=$1 and e.tenant_id=$2 and e.app_user_id=$3 and e.status='pending' and p.redeemed_at is not null
   and p.browser_approved_at is not null and p.claimed_at is not null and p.denied_at is null for update of e`,[input.enrollmentId,input.tenantId,input.userId])
  const count=await client.query("select count(*)::int as n from pashloc_mfa_enrollments where tenant_id=$1 and app_user_id=$2 and status in ('pending','confirmed')",[input.tenantId,input.userId])
  if(old.rowCount!==1||Number(count.rows[0].n)!==1){await client.query("ROLLBACK");return null}
  // Preserve the superseded record. The accepted status is controlled by the deployed schema.
  const revoked=await client.query("update pashloc_mfa_enrollments set status='revoked' where id=$1 and status='pending' returning id",[input.enrollmentId])
  if(revoked.rowCount!==1){await client.query("ROLLBACK");return null}
  const pairingRef=randomBytes(32).toString("base64url")
  const hash=(v:string)=>createHash("sha256").update(v).digest("hex")
  const pairing=await client.query(`insert into pashloc_mfa_pairings(challenge_id,pairing_hash,expires_at)
    select c.id,$4,least(c.expires_at,now()+interval '180 seconds') from pashloc_mfa_challenges c
    where c.challenge_hash=$1 and c.tenant_id=$2 and c.app_user_id=$3 and c.purpose='enroll'
    and c.consumed_at is null and c.expires_at>now() and c.attempts<c.max_attempts returning expires_at`,
    [hash(input.challengeId),input.tenantId,input.userId,hash(pairingRef)])
  if(pairing.rowCount!==1){await client.query("ROLLBACK");return null}
  await client.query("COMMIT")
  console.info("PASHLOC_ACCEPTANCE_RECOVERY",{event:"pending_enrollment_superseded",enrollment_id:input.enrollmentId})
  return {pairing_ref:pairingRef,expires_at:new Date(pairing.rows[0].expires_at).toISOString()}
 }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
}
