/** Isolated acceptance signed approval: atomic decision and one-time browser consumption. */
import { signToken } from "./authService"
import { pool } from "../db/db"
import { verifySignedApproval, sameSessionDigest, type SignedApprovalContext } from "./pashlocSignedApprovalV1"

function acceptanceOnly(): void {
 if(process.env.PASHLOC_ACCEPTANCE_ONLY!=="yes" ||
    process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME!=="pashloc_iv_disposable_mfa_isolated")
   throw new Error("Signed approval is isolated acceptance only")
}
export async function decideSignedApproval(input:{
 context:SignedApprovalContext;signature:string
}):Promise<boolean>{
 acceptanceOnly()
 const client=await pool.connect()
 try{
  await client.query("BEGIN")
  await client.query("SELECT set_config($1,$2,true)",["app.pashloc_test_tenants",process.env.PASHLOC_SIGNED_TEST_TENANTS || "pashloc-genuine-acceptance-20261114"])
  const rows=await client.query(`select c.id,c.tenant_id,c.app_user_id,c.browser_session_hash,
    c.expires_at,c.decision,d.device_id,d.public_jwk
    from pashloc_signed_challenges c
    join pashloc_signed_devices d on d.tenant_id=c.tenant_id and d.app_user_id=c.app_user_id
    join app_users u on u.id=c.app_user_id and u.tenant_id=c.tenant_id
    join tenants t on t.id=c.tenant_id
    where c.challenge_id=$1 and d.device_id=$2
      and t.slug = any(string_to_array(coalesce(nullif(current_setting('app.pashloc_test_tenants',true),''),'pashloc-genuine-acceptance-20261114'),','))
      and c.purpose='login' and c.expires_at>clock_timestamp() and c.consumed_at is null and c.decided_at is null
      and d.revoked_at is null and d.proof_verified_at is not null
      and u.is_active=true and u.pashloc_mfa_required=true
    for update of c for share of d,u`,[input.context.challengeId,input.context.deviceId])
  if(rows.rowCount!==1){await client.query("ROLLBACK");return false}
  const row=rows.rows[0]
  const expected={
   version:"AA-PASHLOC-LOGIN-V1" as const,environment:"acceptance" as const,
   tenantId:Number(row.tenant_id),userId:Number(row.app_user_id),
   deviceId:row.device_id,challengeId:input.context.challengeId,
   browserSessionHash:row.browser_session_hash,
   expiresAt:new Date(row.expires_at).toISOString()
  }
  if(!verifySignedApproval({context:input.context,registeredPublicJwk:row.public_jwk,signature:input.signature,expected,allowDeny:true})){
   await client.query("ROLLBACK");return false
  }
  const result=await client.query(`update pashloc_signed_challenges
   set decision=$5,decided_at=now(),approved_device_id=
      (select id from pashloc_signed_devices where device_id=$2 and tenant_id=$3 and app_user_id=$4)
   where id=$1 and decided_at is null and consumed_at is null and expires_at>clock_timestamp()
   returning id`,[row.id,input.context.deviceId,row.tenant_id,row.app_user_id,input.context.decision])
  if(result.rowCount!==1){await client.query("ROLLBACK");return false}
  await client.query("COMMIT");return true
 }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
}
export async function consumeSignedApproval(input:{
 challengeId:string;browserSessionHash:string;tenantId:number;userId:number
}):Promise<string|null>{
 acceptanceOnly()
 const client=await pool.connect()
 try{
  await client.query("BEGIN")
  const found=await client.query(`select c.id as challenge_row_id,c.browser_session_hash,u.id,u.tenant_id,u.email,u.full_name,
      u.mobile_phone,u.role,u.is_active,u.financials_authorized from pashloc_signed_challenges c
    join pashloc_signed_devices d on d.id=c.approved_device_id
      and d.tenant_id=c.tenant_id and d.app_user_id=c.app_user_id
    join app_users u on u.id=c.app_user_id and u.tenant_id=c.tenant_id
    where c.challenge_id=$1 and c.tenant_id=$2 and c.app_user_id=$3
      and c.purpose='login' and c.decision='approve' and c.decided_at is not null and c.consumed_at is null
      and c.expires_at>clock_timestamp() and d.revoked_at is null and d.proof_verified_at is not null
      and u.is_active=true and u.pashloc_mfa_required=true
    for update of c for share of d,u`,[input.challengeId,input.tenantId,input.userId])
  if(found.rowCount!==1 || !sameSessionDigest(found.rows[0].browser_session_hash,input.browserSessionHash)){
   await client.query("ROLLBACK");return null
  }
  const result=await client.query(`update pashloc_signed_challenges set consumed_at=now()
   where id=$1 and consumed_at is null and expires_at>clock_timestamp() returning id`,[found.rows[0].challenge_row_id])
  if(result.rowCount!==1){await client.query("ROLLBACK");return null}
  const token=signToken(found.rows[0],true)
  await client.query("COMMIT");return token
 }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
}
