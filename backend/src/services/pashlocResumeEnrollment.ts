/** Password-authorized confirmation of an existing, redeemed pending PashLoc credential.
 * Fresh enroll-purpose challenge and restricted browser session are issued by the caller.
 * Never re-authorize the expired device pairing or reveal the credential.
 */
import {createHash} from "node:crypto"
import {pool} from "../db/db"
import {decryptPashLocSecret} from "./pashlocSecretCrypto"
import {verifyPashLocTotp} from "./pashlocTotp"

export async function findResumablePashLocEnrollment(tenantId:number,userId:number):Promise<{id:number;accountId:string}|null>{
 if(process.env.PASHLOC_ACCEPTANCE_ONLY!=="yes" || process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME!=="pashloc_iv_disposable_mfa_isolated")return null
 const r=await pool.query(`select e.id,e.account_id from pashloc_mfa_enrollments e
   join pashloc_mfa_pairings p on p.id=e.delivery_pairing_id
   join pashloc_mfa_challenges original on original.id=p.challenge_id
   where e.tenant_id=$1 and e.app_user_id=$2 and e.status='pending'
     and e.encryption_key_version='navigator-account-v1'
     and p.redeemed_at is not null and p.browser_approved_at is not null
     and p.claimed_at is not null and p.denied_at is null
     and original.tenant_id=$1 and original.app_user_id=$2 and original.purpose='enroll'
   order by e.id desc limit 2`,[tenantId,userId])
 // Multiple pending redeemed credentials are ambiguous: fail closed rather than guess.
 return r.rowCount===1?{id:Number(r.rows[0].id),accountId:String(r.rows[0].account_id)}:null
}

export async function confirmResumedPashLocEnrollment(input:{
 tenantId:number;userId:number;challengeId:string;enrollmentId:number;code:string
}):Promise<{tenantId:number;userId:number;accountId:string}|null>{
 if(process.env.PASHLOC_ACCEPTANCE_ONLY!=="yes" || process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME!=="pashloc_iv_disposable_mfa_isolated")return null
 if(!/^[A-Za-z0-9_-]{43}$/.test(input.challengeId)||!/^[0-9]{6}$/.test(input.code)||
    !Number.isSafeInteger(input.enrollmentId)||input.enrollmentId<=0)return null
 const hash=createHash("sha256").update(input.challengeId).digest("hex")
 const client=await pool.connect()
 try{
  await client.query("BEGIN")
  const challenge=await client.query(`select id,attempts,max_attempts from pashloc_mfa_challenges
    where challenge_hash=$1 and tenant_id=$2 and app_user_id=$3 and purpose='enroll'
      and consumed_at is null and expires_at>now() for update`,[hash,input.tenantId,input.userId])
  if(challenge.rowCount!==1){await client.query("ROLLBACK");return null}
  const c=challenge.rows[0]
  if(c.attempts>=c.max_attempts){await client.query("ROLLBACK");return null}
  await client.query("update pashloc_mfa_challenges set attempts=attempts+1 where id=$1",[c.id])
  const enrollment=await client.query(`select e.id,e.account_id,e.encrypted_secret,e.last_accepted_step
    from pashloc_mfa_enrollments e
    join app_users u on u.id=e.app_user_id and u.tenant_id=e.tenant_id and u.is_active=true
    join pashloc_mfa_pairings p on p.id=e.delivery_pairing_id
    join pashloc_mfa_challenges original on original.id=p.challenge_id
    where e.id=$1 and e.tenant_id=$2 and e.app_user_id=$3 and e.status='pending'
      and e.encryption_key_version='navigator-account-v1'
      and p.redeemed_at is not null and p.browser_approved_at is not null
      and p.claimed_at is not null and p.denied_at is null
      and original.tenant_id=$2 and original.app_user_id=$3 and original.purpose='enroll'
    for update of e`,[input.enrollmentId,input.tenantId,input.userId])
  if(enrollment.rowCount!==1){await client.query("COMMIT");return null}
  // Refuse ambiguous credential selection even if the client supplied a valid id.
  const other=await client.query(`select count(*)::int as n from pashloc_mfa_enrollments
    where tenant_id=$1 and app_user_id=$2 and status='pending' and id<>$3`,
    [input.tenantId,input.userId,input.enrollmentId])
  if(Number(other.rows[0].n)!==0){await client.query("COMMIT");return null}
  const e=enrollment.rows[0]
  const secret=decryptPashLocSecret(e.encrypted_secret,input.tenantId,input.userId,e.account_id)
  const match=verifyPashLocTotp(secret,input.code,{lastAcceptedStep:e.last_accepted_step===null?null:Number(e.last_accepted_step)})
  if(!match){await client.query("COMMIT");return null}
  const confirmed=await client.query(`update pashloc_mfa_enrollments
    set status='confirmed',confirmed_at=now(),last_accepted_step=$2
    where id=$1 and status='pending' returning account_id`,[e.id,match.acceptedStep])
  const consumed=await client.query(`update pashloc_mfa_challenges set consumed_at=now()
    where id=$1 and consumed_at is null and expires_at>now() returning id`,[c.id])
  if(confirmed.rowCount!==1||consumed.rowCount!==1){await client.query("ROLLBACK");return null}
  // Existing acceptance bootstrap pre-enables MFA; never downgrade it.
  const identity=await client.query("select current_database() as db,current_user as role")
  if(identity.rows[0]?.db!=="pashloc_iv_disposable_mfa_isolated" || identity.rows[0]?.role!=="pashloc_iv_disposable_mfa_isolated_user"){await client.query("ROLLBACK");return null}
  const active=await client.query(`update app_users
    set pashloc_mfa_required=true,pashloc_mfa_activated_at=coalesce(pashloc_mfa_activated_at,date_trunc('second',now()))
    where id=$1 and tenant_id=$2 and is_active=true returning id`,[input.userId,input.tenantId])
  if(active.rowCount!==1){await client.query("ROLLBACK");return null}
  await client.query("COMMIT")
  return {tenantId:input.tenantId,userId:input.userId,accountId:String(e.account_id)}
 }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
}
