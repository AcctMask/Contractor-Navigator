/** Create actual empty CRM tables only in verified disposable acceptance database.
 * No production customer data or synthetic HTTP response fixtures.
 */
import {Pool} from "pg"
const u=new URL(process.env.DATABASE_URL||"")
if(process.env.NODE_ENV!=="test"||decodeURIComponent(u.pathname.slice(1))!=="pashloc_iv_disposable_mfa_isolated")
 throw Error("Disposable CRM schema boundary")
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1})
try {
 const id=await pool.query("select current_database() as db,current_user as role")
 if(id.rows[0]?.db!=="pashloc_iv_disposable_mfa_isolated"||id.rows[0]?.role!=="pashloc_iv_disposable_mfa_isolated_user")
  throw Error("Disposable identity mismatch")
 await pool.query(`
 BEGIN;
 CREATE TABLE IF NOT EXISTS customers (
  id bigserial primary key, tenant_id bigint not null references tenants(id),
  full_name text
 );
 CREATE TABLE IF NOT EXISTS jobs (
  id bigserial primary key, tenant_id bigint not null references tenants(id),
  customer_id bigint references customers(id), external_job_id text, stage text,
  crm_flow_key text, crm_substatus text, bot_paused boolean default false,
  manual_owner text, address1 text, city text, state text, zip text, carrier text,
  claim_number text, wa_status text, estimate_status text, contract_status text,
  lead_source text, lead_source_detail text, marketing_campaign text,
  created_at timestamptz default now(), updated_at timestamptz default now()
 );
 CREATE TABLE IF NOT EXISTS crew_assignments (
  id bigserial primary key, tenant_id bigint not null references tenants(id),
  job_id bigint references jobs(id), app_user_id bigint references app_users(id),
  crew_name text, status text, assigned_at timestamptz default now()
 );
 CREATE TABLE IF NOT EXISTS job_assets (
  id bigserial primary key, tenant_id bigint not null references tenants(id),
  job_id bigint references jobs(id), asset_type text
 );
 CREATE TABLE IF NOT EXISTS timeline_events (
  id bigserial primary key, tenant_id bigint not null references tenants(id),
  job_id bigint references jobs(id), kind text, message text, meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
 );
 CREATE TABLE IF NOT EXISTS calendar_events (
  id bigserial primary key, tenant_id bigint not null references tenants(id),
  job_id bigint references jobs(id), title text not null default 'Calendar Event',
  start_time timestamptz not null, end_time timestamptz, location text, notes text,
  event_type text default 'general', automation_managed boolean default false,
  automation_stage_key text, created_at timestamptz default now(),updated_at timestamptz default now()
 );
 COMMIT;`)
 console.log("PASHLOC_DISPOSABLE_CRM_SCHEMA",JSON.stringify({ok:true,tables:6}))
}finally{await pool.end()}
