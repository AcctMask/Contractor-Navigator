/** Disposable-only one-shot schema setup; no production credentials or network exposure. */
import { readFileSync } from "node:fs"
import { Pool } from "pg"
const expected="pashloc_iv_disposable_mfa_isolated"
const user="pashloc_iv_disposable_mfa_isolated_user"
const connectionString=process.env.DATABASE_URL||""
const parsed=new URL(connectionString)
if(process.env.NODE_ENV!=="test" || decodeURIComponent(parsed.pathname.slice(1))!==expected ||
   !["postgres:","postgresql:"].includes(parsed.protocol)) throw Error("Disposable migration boundary failed")
const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:10000})
try {
 const identity=await pool.query("select current_database() as db,current_user as role")
 if(identity.rows[0]?.db!==expected||identity.rows[0]?.role!==user) throw Error("Database identity mismatch")
 const tables=await pool.query("select count(*)::int as count from information_schema.tables where table_schema='public'")
 console.log("DISPOSABLE_PRE_MIGRATION_SCHEMA",JSON.stringify({tables:tables.rows[0].count}))
 const sql=readFileSync(new URL("../../sql/pashloc_mfa_acceptance_private_disposable.sql",import.meta.url),"utf8")
 await pool.query(sql)
 const result=await pool.query("select to_regclass('public.pashloc_mfa_enrollments') is not null as enrollments,to_regclass('public.pashloc_mfa_challenges') is not null as challenges,to_regclass('public.pashloc_mfa_pairings') is not null as pairings,to_regclass('public.pashloc_mfa_request_limits') is not null as limits")
 console.log("DISPOSABLE_POST_MIGRATION_SCHEMA",JSON.stringify(result.rows[0]))
 if(Object.values(result.rows[0]).some(v=>v!==true)) throw Error("MFA schema incomplete")
} finally {await pool.end()}
