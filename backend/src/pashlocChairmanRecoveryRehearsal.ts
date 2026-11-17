/** Non-destructive transaction rehearsal on the actual Chairman pending acceptance record.
 * No credential replacement is committed. The real recovery endpoint still requires
 * the Chairman's fresh password and explicit consent.
 */
import {randomBytes,createHash} from "node:crypto"
import {pool} from "./db/db"
export async function certifyChairmanRecoveryRehearsal(){
 const client=await pool.connect()
 try{
  await client.query("BEGIN")
  const db=await client.query("select current_database() db,current_user role")
  if(db.rows[0]?.db!=="pashloc_iv_disposable_mfa_isolated"||db.rows[0]?.role!=="pashloc_iv_disposable_mfa_isolated_user")throw Error("Recovery rehearsal database guard")
  const identity=await client.query(`select u.id,u.tenant_id from app_users u join tenants t on t.id=u.tenant_id
    where t.slug='pashloc-genuine-acceptance-20261114' and lower(u.email)='steve@g2groofing.com' and u.is_active=true for update of u`)
  if(identity.rowCount!==1)throw Error("Existing Chairman identity unavailable")
  const u=identity.rows[0]
  const old=await client.query(`select e.id from pashloc_mfa_enrollments e join pashloc_mfa_pairings p on p.id=e.delivery_pairing_id
    where e.tenant_id=$1 and e.app_user_id=$2 and e.status='pending' and p.redeemed_at is not null
      and p.browser_approved_at is not null and p.claimed_at is not null and p.denied_at is null for update of e`,[u.tenant_id,u.id])
  if(old.rowCount!==1)throw Error("Existing redeemed pending enrollment mismatch")
  const oldId=old.rows[0].id
  const challenge=randomBytes(32).toString("base64url")
  const pairing=randomBytes(32).toString("base64url")
  const hash=(s:string)=>createHash("sha256").update(s).digest("hex")
  const ch=await client.query(`insert into pashloc_mfa_challenges(tenant_id,app_user_id,challenge_hash,purpose,expires_at)
    values($1,$2,$3,'enroll',now()+interval '180 seconds') returning id`,[u.tenant_id,u.id,hash(challenge)])
  const revoke=await client.query("update pashloc_mfa_enrollments set status='revoked' where id=$1 and status='pending' returning id",[oldId])
  const issued=await client.query(`insert into pashloc_mfa_pairings(challenge_id,pairing_hash,expires_at)
    values($1,$2,now()+interval '180 seconds') returning id`,[ch.rows[0].id,hash(pairing)])
  if(revoke.rowCount!==1||issued.rowCount!==1)throw Error("Recovery transaction rehearsal failed")
  const preserved=await client.query("select count(*)::int n from app_users where id=$1 and tenant_id=$2",[u.id,u.tenant_id])
  if(preserved.rows[0].n!==1)throw Error("Identity changed")
  await client.query("ROLLBACK")
  const verify=await pool.query("select id,status from pashloc_mfa_enrollments where id=$1",[oldId])
  if(verify.rowCount!==1||verify.rows[0].status!=="pending")throw Error("Rehearsal did not restore original enrollment")
  console.info("PASHLOC_CHAIRMAN_RECOVERY_REHEARSAL",JSON.stringify({result:"PASS",same_identity:true,old_enrollment_preserved:true,atomic_revocation_and_pairing:true,rollback_verified:true,actual_recovery_authorization:"NOT_PERFORMED"}))
 }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
}
