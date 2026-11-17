/** Prove genuine PostgreSQL-backed shared limiter state across independent clients.
 * Uses a unique acceptance-only bucket; rolls back all writes on success or failure.
 */
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
const expected="pashloc_iv_disposable_mfa_isolated"
const url=new URL(process.env.DATABASE_URL||"")
if(process.env.NODE_ENV!=="test"||decodeURIComponent(url.pathname.slice(1))!==expected)
 throw Error("Disposable-only rate limit verification")
const first=new Pool({connectionString:process.env.DATABASE_URL,max:1})
const second=new Pool({connectionString:process.env.DATABASE_URL,max:1})
const key="acceptance-shared-proof-"+randomUUID()
const minute=new Date(Math.floor(Date.now()/60000)*60000)
try {
 const identity=await first.query("select current_database() as db,current_user as role")
 if(identity.rows[0]?.db!==expected||identity.rows[0]?.role!=="pashloc_iv_disposable_mfa_isolated_user")
   throw Error("Database identity guard failed")
 const insert=await first.query(
  "insert into pashloc_mfa_request_limits(bucket,window_start,hits) values($1,$2,1) on conflict(bucket,window_start) do update set hits=pashloc_mfa_request_limits.hits+1 returning hits",
  [key,minute])
 if(Number(insert.rows[0]?.hits)!==1) throw Error("Unexpected existing proof bucket")
 const seen=await second.query("select hits from pashloc_mfa_request_limits where bucket=$1 and window_start=$2",[key,minute])
 if(Number(seen.rows[0]?.hits)!==1) throw Error("Independent connection cannot see shared limiter")
 const updated=await second.query(
  "insert into pashloc_mfa_request_limits(bucket,window_start,hits) values($1,$2,1) on conflict(bucket,window_start) do update set hits=pashloc_mfa_request_limits.hits+1 returning hits",
  [key,minute])
 const cross=await first.query("select hits from pashloc_mfa_request_limits where bucket=$1 and window_start=$2",[key,minute])
 if(Number(updated.rows[0]?.hits)!==2||Number(cross.rows[0]?.hits)!==2)
  throw Error("Shared atomic rate limit increment failed")
 console.log("PASHLOC_SHARED_RATE_LIMITS_PROOF",JSON.stringify({ok:true,independent_connections:true,shared_increment:true}))
} finally {
 await first.query("delete from pashloc_mfa_request_limits where bucket=$1",[key]).catch(()=>{})
 await Promise.all([first.end(),second.end()])
}
