/** Narrow disposable-only CRM tenant compatibility migration. */
import {Pool} from "pg"
const url=new URL(process.env.DATABASE_URL||"")
if(process.env.NODE_ENV!=="test"||decodeURIComponent(url.pathname.slice(1))!=="pashloc_iv_disposable_mfa_isolated")
 throw Error("Acceptance database identity guard")
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1})
try {
 await pool.query(`BEGIN;
 DO $guard$ BEGIN
 IF current_database()<>'pashloc_iv_disposable_mfa_isolated'
 OR current_user<>'pashloc_iv_disposable_mfa_isolated_user'
 OR to_regclass('public.tenants') IS NULL
 THEN RAISE EXCEPTION 'Disposable tenant migration guard failed'; END IF;
 END $guard$;
 ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS name text;
 ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
 UPDATE public.tenants SET name=slug WHERE name IS NULL;
 COMMIT;`)
 const result=await pool.query("select count(*)::int as missing from tenants where name is null")
 if(result.rows[0].missing!==0) throw Error("Missing tenant display names")
 console.log("PASHLOC_DISPOSABLE_TENANT_COMPATIBILITY",JSON.stringify({ok:true,missing_names:0}))
} finally {await pool.end()}
