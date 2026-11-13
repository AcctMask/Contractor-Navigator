/** One-time schema initializer for the dedicated PashLoc IV disposable Render database.
 * Run explicitly from a Render runtime on the private network; never from CI or
 * production. Does not create users or print credentials.
 */
import {readFileSync} from "node:fs"
import pg from "pg"
const url=process.env.DATABASE_URL
if(process.env.PASHLOC_ISOLATED_SCHEMA_INIT!=="explicit-one-time" || !url)
 throw new Error("Explicit isolated schema initialization authorization required")
const parsed=new URL(url)
const expectedDb="pashloc_iv_disposable_mfa_isolated"
if(parsed.protocol!=="postgresql:" && parsed.protocol!=="postgres:")
 throw new Error("PostgreSQL URL required")
if(decodeURIComponent(parsed.pathname.slice(1))!==expectedDb ||
   !parsed.hostname.startsWith("dpg-dbrfo7ec6qcc73dp7g00-a") ||
   process.env.NODE_ENV!=="development" ||
   process.env.PASHLOC_ISOLATED_CLAIM_API!=="enabled")
 throw new Error("Refusing non-isolated database or environment")
const client=new pg.Client({connectionString:url,ssl:false})
const migrations=[
 "pashloc_iv_mfa_isolated_schema_20261112.sql",
 "pashloc_iv_mfa_pairing_protocol_isolated_20261112.sql",
 "pashloc_iv_mfa_device_claim_nonces_isolated_20261112.sql",
 "pashloc_iv_mfa_restricted_browser_sessions_isolated_20261112.sql",
 "pashloc_iv_mfa_synthetic_redemption_isolated_20261112.sql",
 "pashloc_iv_mfa_disposable_activation_isolated_20261113.sql"
]
await client.connect()
try {
 await client.query("BEGIN")
 await client.query("SELECT pg_advisory_xact_lock(20261113, 44)")
 const identity=await client.query("SELECT current_database() AS db, inet_server_addr() IS NOT NULL AS tcp")
 if(identity.rows[0]?.db!==expectedDb || !identity.rows[0]?.tcp)
  throw new Error("Database identity verification failed")
 await client.query(`CREATE TABLE IF NOT EXISTS pashloc_isolated_migration_control (
   id integer PRIMARY KEY CHECK (id=1), completed_at timestamptz NOT NULL DEFAULT now()
 )`)
 const done=await client.query("SELECT id FROM pashloc_isolated_migration_control WHERE id=1")
 if(done.rowCount) {
  console.log("Isolated schema already initialized; no changes applied")
 } else {
  const existing=await client.query(`SELECT to_regclass('public.tenants') AS tenants,
    to_regclass('public.app_users') AS users, to_regclass('public.pashloc_mfa_enrollments') AS mfa`)
  if(existing.rows[0].tenants || existing.rows[0].users || existing.rows[0].mfa)
   throw new Error("Unexpected pre-existing identity/MFA tables; refusing to modify")
  await client.query(`CREATE TABLE tenants(id bigserial PRIMARY KEY,slug text UNIQUE NOT NULL);
   CREATE TABLE app_users(id bigserial PRIMARY KEY,
    tenant_id bigint NOT NULL REFERENCES tenants(id),
    email text NOT NULL,password_hash text NOT NULL,
    is_active boolean NOT NULL DEFAULT true)`)
  for(const file of migrations)
   await client.query(readFileSync(new URL("../sql/"+file,import.meta.url),"utf8"))
  await client.query("INSERT INTO pashloc_isolated_migration_control(id) VALUES(1)")
  console.log("Dedicated disposable schema initialized; no users or secrets created")
 }
 await client.query("COMMIT")
} catch(e) {
 await client.query("ROLLBACK")
 throw e
} finally {await client.end()}
