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
 const existing=await pool.query("select u.id from app_users u join tenants t on t.id=u.tenant_id where t.slug=$1 and lower(u.email)=$2",[slug,email])
 if(existing.rowCount>0) {console.log("PASHLOC_CHAIRMAN_ACCEPTANCE_ALREADY_EXISTS");return}
 const randomUnusablePassword=await bcrypt.hash(randomBytes(48).toString("hex"),12)
 const created=await pool.query(`insert into app_users(tenant_id,email,full_name,role,is_active,financials_authorized,password_hash,pashloc_mfa_required,pashloc_mfa_activated_at)
 select id,$1,'Chairman MFA Acceptance','viewer',true,false,$2,true,now() from tenants where slug=$3
 returning id`,[email,randomUnusablePassword,slug])
 if(created.rowCount!==1)throw Error("Chairman isolated identity not provisioned")
 console.log("PASHLOC_CHAIRMAN_ACCEPTANCE_PROVISIONED")
}
