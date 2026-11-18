/** Disposable per-run account provisioning. Never modifies existing users or MFA records. */
import {randomBytes} from "node:crypto"
import bcrypt from "bcryptjs"
import {pool} from "./db/db"
export async function provisionPashLocAcceptanceIdentity(password:string){
 const db=await pool.query("select current_database() db,current_user role")
 if(process.env.NODE_ENV!=="test"||process.env.PASHLOC_ACCEPTANCE_ONLY!=="yes"||
    process.env.PASHLOC_ACCEPTANCE_EXECUTE_PROTOCOL!=="yes"||
    db.rows[0]?.db!=="pashloc_iv_disposable_mfa_isolated"||
    db.rows[0]?.role!=="pashloc_iv_disposable_mfa_isolated_user")
   throw Error("Per-run identity provisioning isolation denied")
 const suffix=randomBytes(12).toString("hex")
 const email="navigator-run-"+suffix+"@example.invalid"
 const slug="pashloc-genuine-acceptance-20261114"
 const hash=await bcrypt.hash(password,12)
 const created=await pool.query(`
   insert into app_users (tenant_id,email,full_name,role,is_active,financials_authorized,
      password_hash,pashloc_mfa_required,pashloc_mfa_activated_at)
   select t.id,$1,'Disposable MFA Acceptance','viewer',true,false,$2,false,null
     from tenants t where t.slug=$3
   returning id,tenant_id`,[email,hash,slug])
 if(created.rowCount!==1)throw Error("Disposable acceptance tenant unavailable")
 console.log("PASHLOC_ACCEPTANCE_RUN_IDENTITY",JSON.stringify({created:true,tenant_bound:true,unique_suffix_length:suffix.length}))
 return {email,slug}
}
