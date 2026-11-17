/** One-time Chairman identity provisioning, restricted to the disposable acceptance database. */
import {randomBytes} from "node:crypto"
import bcrypt from "bcryptjs"
import {pool} from "./db/db"
export async function provisionChairmanAcceptanceIdentity(){
 if(process.env.NODE_ENV!=="test"||process.env.PASHLOC_ACCEPTANCE_ONLY!=="yes"||
    process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME!=="pashloc_iv_disposable_mfa_isolated")throw Error("Isolated provisioning denied")
 const db=await pool.query("select current_database() db,current_user role")
 if(db.rows[0]?.db!=="pashloc_iv_disposable_mfa_isolated"||db.rows[0]?.role!=="pashloc_iv_disposable_mfa_isolated_user")throw Error("Isolated database role rejected")
 const slug="pashloc-genuine-acceptance-20261114",email="steve@g2groofing.com"
 const existing=await pool.query("select u.id,u.role,u.is_active,u.pashloc_mfa_required from app_users u join tenants t on t.id=u.tenant_id where t.slug=$1 and lower(u.email)=$2",[slug,email])
 if(existing.rowCount>0) {
   if(existing.rowCount!==1)throw Error("Chairman identity uniqueness rejected")
   const user=existing.rows[0]
   if(user.role==="platform_owner"){console.log("PASHLOC_CHAIRMAN_ACCEPTANCE_OWNER_VERIFIED");return}
   if(user.role!=="viewer"||user.is_active!==true||user.pashloc_mfa_required!==true)throw Error("Chairman role restoration preconditions rejected")
   const updated=await pool.query(`update app_users set role='platform_owner' where id=$1 and role='viewer' and is_active=true and pashloc_mfa_required=true and tenant_id=(select id from tenants where slug=$2) and email=$3 and (select count(*) from pashloc_mfa_enrollments where app_user_id=$1 and status='confirmed')=1 returning id,role`,[user.id,slug,email])
   if(updated.rowCount!==1)throw Error("Chairman owner role restoration rejected: confirmed enrollment or identity mismatch")
   console.log("PASHLOC_CHAIRMAN_ACCEPTANCE_OWNER_RESTORED",JSON.stringify({user_id:String(user.id),role:"platform_owner",isolated:true}))
   return
 }
 const randomUnusablePassword=await bcrypt.hash(randomBytes(48).toString("hex"),12)
 const created=await pool.query(`insert into app_users(tenant_id,email,full_name,role,is_active,financials_authorized,password_hash,pashloc_mfa_required,pashloc_mfa_activated_at)
 select id,$1,'Chairman MFA Acceptance','platform_owner',true,false,$2,true,now() from tenants where slug=$3
 returning id`,[email,randomUnusablePassword,slug])
 if(created.rowCount!==1)throw Error("Chairman isolated identity not provisioned")
 console.log("PASHLOC_CHAIRMAN_ACCEPTANCE_PROVISIONED")
}
