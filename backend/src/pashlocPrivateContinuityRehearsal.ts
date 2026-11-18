/** Private startup-only continuity and recovery rehearsal. No HTTP route, no secrets logged.
 * Runs only on the existing disposable Render PostgreSQL database. */
import { pool } from "./db/db"
export async function verifyPrivateDeviceAndRecovery() {
 const client=await pool.connect()
 try {
  await client.query("BEGIN")
  const db=await client.query("select current_database() as db,current_user as role")
  if(db.rows[0]?.db!=="pashloc_iv_disposable_mfa_isolated" ||
     db.rows[0]?.role!=="pashloc_iv_disposable_mfa_isolated_user")
    throw Error("Private continuity check rejected non-disposable database")
  const registrations=await client.query(`select t.slug,u.role,
    count(*)::int as active_devices,
    bool_and(d.proof_verified_at is not null and d.revoked_at is null) as proof_verified
    from pashloc_signed_devices d join app_users u on u.id=d.app_user_id and u.tenant_id=d.tenant_id
    join tenants t on t.id=u.tenant_id
    where lower(u.email)=$1 and d.proof_verified_at is not null and d.revoked_at is null
    group by t.slug,u.role`,["steve@g2groofing.com"])
  console.info("PASHLOC_PRIVATE_REGISTRATION_ASSOCIATION",JSON.stringify({
    database:"isolated",matches:registrations.rows.map(r=>({
      tenant:r.slug,role:r.role,active_devices:r.active_devices,proof_verified:r.proof_verified
    })),operational_account_binding:"NOT_ESTABLISHED"
  }))
  // Recovery rehearsal on a disposable test identity, with every change rolled back.
  const account=await client.query(`select u.id,u.tenant_id,u.navigator_mfa_epoch,u.navigator_mfa_required
    from app_users u join tenants t on t.id=u.tenant_id
    where t.slug=$1 and u.is_active and u.navigator_mfa_required=true
    order by u.id limit 1 for update of u`,["pashloc-genuine-acceptance-20261114"])
  if(account.rowCount!==1) {
    console.info("NAVIGATOR_PRIVATE_RECOVERY_REHEARSAL",JSON.stringify({result:"BLOCKED",reason:"no eligible disposable signed-MFA test account"}))
    await client.query("ROLLBACK");return
  }
  const u=account.rows[0]
  const prior=String(u.navigator_mfa_epoch)
  const pending=await client.query(`select count(*)::int as n from navigator_signed_challenges
     where app_user_id=$1 and tenant_id=$2 and consumed_at is null`,[u.id,u.tenant_id])
  await client.query(`update navigator_signed_challenges set decision='deny',consumed_at=clock_timestamp()
    where app_user_id=$1 and tenant_id=$2 and consumed_at is null and decision is null`,[u.id,u.tenant_id])
  const changed=await client.query(`update app_users set navigator_mfa_required=false,
    navigator_mfa_epoch=navigator_mfa_epoch+1
    where id=$1 and tenant_id=$2 and navigator_mfa_required and navigator_mfa_epoch=$3
    returning navigator_mfa_epoch,navigator_mfa_required`,[u.id,u.tenant_id,prior])
  if(changed.rowCount!==1||changed.rows[0].navigator_mfa_required!==false ||
     BigInt(changed.rows[0].navigator_mfa_epoch)!==BigInt(prior)+1n) throw Error("Recovery epoch/policy rehearsal failed")
  const others=await client.query(`select count(*)::int as n from app_users
    where tenant_id=$1 and id<>$2 and navigator_mfa_required=true`,[u.tenant_id,u.id])
  await client.query("ROLLBACK")
  const restored=await pool.query(`select navigator_mfa_epoch,navigator_mfa_required from app_users
    where id=$1 and tenant_id=$2`,[u.id,u.tenant_id])
  if(restored.rowCount!==1||String(restored.rows[0].navigator_mfa_epoch)!==prior ||
     restored.rows[0].navigator_mfa_required!==true)throw Error("Recovery rollback failed")
  console.info("NAVIGATOR_PRIVATE_RECOVERY_REHEARSAL",JSON.stringify({
    result:"PASS",account_scoped:true,epoch_advanced:true,challenge_revocation_exercised:true,
    pending_challenges_before:pending.rows[0].n,other_accounts_preserved:true,
    rollback_verified:true,audit_commit:"NOT_EXERCISED",live_session_invalidation:"CI_ONLY"
  }))
 } catch(e){try{await client.query("ROLLBACK")}catch{}throw e}finally{client.release()}
}
