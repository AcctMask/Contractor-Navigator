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
  // The isolated acceptance identity uses the original pashloc_mfa policy,
  // not the additive operational navigator_mfa_epoch schema.
  const account=await client.query(`select u.id,u.tenant_id,u.pashloc_mfa_required
    from app_users u join tenants t on t.id=u.tenant_id
    where t.slug=$1 and u.is_active and u.pashloc_mfa_required=true
    order by u.id limit 1 for update of u`,["pashloc-genuine-acceptance-20261114"])
  if(account.rowCount!==1) throw Error("No eligible isolated MFA test identity")
  const u=account.rows[0]
  const before=await client.query(`select count(*)::int as n from pashloc_mfa_challenges
    where app_user_id=$1 and tenant_id=$2`,[u.id,u.tenant_id])
  const changed=await client.query(`update app_users set pashloc_mfa_required=false
    where id=$1 and tenant_id=$2 and pashloc_mfa_required=true
    returning id,tenant_id,pashloc_mfa_required`,[u.id,u.tenant_id])
  if(changed.rowCount!==1||changed.rows[0].pashloc_mfa_required!==false)
    throw Error("Scoped recovery rehearsal failed")
  const audit=await client.query(`insert into pashloc_mfa_admin_recovery_audit
    (tenant_id,app_user_id,action,reason)
    values($1,$2,'disable_pilot_mfa','Isolated recovery rehearsal rollback only')
    returning id`,[u.tenant_id,u.id])
  if(audit.rowCount!==1)throw Error("Recovery audit rehearsal failed")
  const observed=await client.query(`select count(*)::int as n from pashloc_mfa_admin_recovery_audit
    where id=$1 and app_user_id=$2 and tenant_id=$3`,[audit.rows[0].id,u.id,u.tenant_id])
  if(observed.rows[0].n!==1)throw Error("Recovery audit missing")
  await client.query("ROLLBACK")
  const restored=await pool.query(`select pashloc_mfa_required from app_users
    where id=$1 and tenant_id=$2`,[u.id,u.tenant_id])
  const auditRestored=await pool.query(`select count(*)::int as n from pashloc_mfa_admin_recovery_audit
    where id=$1`,[audit.rows[0].id])
  if(restored.rowCount!==1||restored.rows[0].pashloc_mfa_required!==true ||
     auditRestored.rows[0].n!==0)throw Error("Recovery rollback failed")
  console.info("NAVIGATOR_PRIVATE_RECOVERY_REHEARSAL",JSON.stringify({
    result:"PASS",identity:"isolated",account_scoped:true,policy_toggle:true,
    audit_insert_verified:true,audit_rollback_verified:true,identity_restored:true,
    existing_challenge_count:before.rows[0].n,
    operational_epoch_session_invalidation:"CI_VERIFIED_NOT_ISOLATED_REHEARSED",
    original_device_registration:"UNCHANGED"
  }))
 } catch(e){try{await client.query("ROLLBACK")}catch{}throw e}finally{client.release()}
}
