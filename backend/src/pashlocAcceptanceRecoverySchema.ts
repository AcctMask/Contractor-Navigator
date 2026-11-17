/** One-time isolated acceptance schema correction for audited revoked enrollment history.
 * Retain the original row; only active (pending/confirmed) credentials are unique per user.
 */
import {pool} from "./db/db"
if(process.env.NODE_ENV!=="test"||process.env.PASHLOC_ACCEPTANCE_ONLY!=="yes"||process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME!=="pashloc_iv_disposable_mfa_isolated")throw Error("Acceptance-only migration")
const client=await pool.connect()
try{
 await client.query("BEGIN")
 const id=await client.query("select current_database() db,current_user role")
 if(id.rows[0]?.db!=="pashloc_iv_disposable_mfa_isolated"||id.rows[0]?.role!=="pashloc_iv_disposable_mfa_isolated_user")throw Error("Wrong database")
 const c=await client.query(`select conname,pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.pashloc_mfa_enrollments'::regclass and contype='u'`)
 const exact=c.rows.filter((r:{def:string})=>/^UNIQUE \\(tenant_id, app_user_id\\)$/.test(r.def))
 if(exact.length!==1)throw Error("Unexpected enrollment uniqueness schema")
 await client.query("create unique index if not exists pashloc_one_active_enrollment_per_user on pashloc_mfa_enrollments(tenant_id,app_user_id) where status in ('pending','confirmed')")
 await client.query('alter table pashloc_mfa_enrollments drop constraint "'+exact[0].conname.replace(/"/g,'""')+'"')
 await client.query("COMMIT")
 console.info("PASHLOC_ACCEPTANCE_RECOVERY_SCHEMA",{verified:true,revoked_retained:true,active_unique:true})
}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
