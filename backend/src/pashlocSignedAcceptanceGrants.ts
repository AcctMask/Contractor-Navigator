/** Operator provisioning from the existing isolated service. Env inputs are never logged.
 * Only issue a grant after independent identity verification. For a lost device,
 * explicitly choose revoke-and-recover; retain the revoked registration for audit.
 */
import bcrypt from "bcryptjs"
import { pool } from "./db/db"
import { migrateSignedAcceptance } from "./pashlocSignedAcceptanceMigration"

const slug="pashloc-genuine-acceptance-20261114"
const fixture="navigator-signed-hosted-test@example.invalid"
const validHash=(s:string|undefined):s is string=>!!s&&/^[a-f0-9]{64}$/.test(s)

export async function prepareSignedAcceptanceGrants() {
  if(process.env.PASHLOC_SIGNED_GRANT_HASH===undefined && process.env.PASHLOC_SIGNED_FIXTURE_UNTIL===undefined)return
  if(process.env.NODE_ENV!=="test"||process.env.PASHLOC_ACCEPTANCE_ONLY!=="yes"||
     process.env.PASHLOC_ACCEPTANCE_DATABASE_CONFIRMED!=="yes")throw Error("Signed grant provisioning restricted")
  await migrateSignedAcceptance()
  const grant=process.env.PASHLOC_SIGNED_GRANT_HASH
  const fixtureGrant=process.env.PASHLOC_SIGNED_FIXTURE_GRANT_HASH
  const fixturePassword=process.env.PASHLOC_SIGNED_FIXTURE_PASSWORD
  const fixtureUntil=Date.parse(process.env.PASHLOC_SIGNED_FIXTURE_UNTIL||"")
  const issueUntil=Date.parse(process.env.PASHLOC_SIGNED_GRANT_UNTIL||"")
  const email=process.env.PASHLOC_SIGNED_GRANT_ACCOUNT?.trim().toLowerCase()
  const recovery=process.env.PASHLOC_SIGNED_GRANT_MODE==="revoke-and-recover"
  const now=Date.now()
  const windowValid=(end:number)=>Number.isFinite(end)&&end>now&&end<=now+3600000
  const expiry=async()=>pool.query(`update app_users u set is_active=false from tenants t
      where t.id=u.tenant_id and t.slug=$1 and u.email=$2`,[slug,fixture])
  if(Number.isFinite(fixtureUntil)){
    if(!windowValid(fixtureUntil)){await expiry()}
    else {
      if(!validHash(fixtureGrant)||!fixturePassword||fixturePassword.length<32)throw Error("Invalid signed fixture configuration")
      const pass=await bcrypt.hash(fixturePassword,12)
      const client=await pool.connect()
      try {
        await client.query("BEGIN")
        const account=await client.query(`insert into app_users(tenant_id,email,full_name,role,is_active,
          password_hash,pashloc_mfa_required,pashloc_mfa_activated_at)
          select id,$1,'Disposable signed-approval fixture','platform_owner',true,$2,true,clock_timestamp() from tenants where slug=$3
          on conflict(tenant_id,email) do nothing returning id,tenant_id`,[fixture,pass,slug])
        if(account.rowCount===1){
          const row=account.rows[0]
          await client.query(`insert into pashloc_signed_enrollment_grants(grant_hash,tenant_id,app_user_id,expires_at)
            values($1,$2,$3,$4)`,[fixtureGrant,row.tenant_id,row.id,new Date(fixtureUntil)])
        }
        await client.query("COMMIT")
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
      setTimeout(()=>void expiry().catch(()=>console.error("SIGNED_FIXTURE_EXPIRY_FAILED")),fixtureUntil-Date.now()).unref()
    }
  }
  if(!grant || !windowValid(issueUntil))return
  if(!validHash(grant)||!email||email.endsWith("@example.invalid")||
     !["enroll","revoke-and-recover"].includes(process.env.PASHLOC_SIGNED_GRANT_MODE||""))throw Error("Invalid signed enrollment grant configuration")
  const client=await pool.connect()
  try{
    await client.query("BEGIN")
    const found=await client.query(`select u.id,u.tenant_id from app_users u join tenants t on t.id=u.tenant_id
      where u.is_active and u.pashloc_mfa_required and t.slug=$1 and lower(u.email)=$2 for update of u`,[slug,email])
    if(found.rowCount!==1)throw Error("Signed grant account not eligible")
    const {id,tenant_id}=found.rows[0]
    const issued=await client.query(`insert into pashloc_signed_enrollment_grants(grant_hash,tenant_id,app_user_id,expires_at)
      values($1,$2,$3,$4) on conflict do nothing returning grant_hash`,[grant,tenant_id,id,new Date(issueUntil)])
    if(issued.rowCount===1){
      await client.query(`update pashloc_signed_enrollment_grants set used_at=clock_timestamp()
        where tenant_id=$1 and app_user_id=$2 and used_at is null and grant_hash<>$3`,[tenant_id,id,grant])
      if(recovery)await client.query(`update pashloc_signed_devices set revoked_at=clock_timestamp()
        where tenant_id=$1 and app_user_id=$2 and revoked_at is null`,[tenant_id,id])
    }
    await client.query("COMMIT")
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
}
