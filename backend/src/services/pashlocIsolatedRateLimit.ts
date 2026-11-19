/** Shared fixed-window throttle for the dedicated disposable service.
 * Use the transport IP only. The bounded aggregate protects this small test
 * environment even behind a gateway or if untrusted headers are supplied.
 */
import {createHash} from "node:crypto"
import type {FastifyInstance} from "fastify"
import {pool} from "../db/db"

export function registerPashLocIsolatedRateLimits(app:FastifyInstance){
 app.addHook("preHandler",async(req,reply)=>{
  const path=req.routeOptions.url
  if(req.method!=="POST"||!path?.startsWith("/auth/mfa/"))return
  const origin=path.startsWith("/auth/mfa/device/")?
   process.env.PASHLOC_ISOLATED_PHONE_ORIGIN:process.env.PASHLOC_ISOLATED_NAVIGATOR_ORIGIN
  if(req.headers.origin!==origin)return
  const ip=createHash("sha256").update(req.ip).digest("hex")
  const result=await pool.query(
   `insert into pashloc_mfa_request_limits(bucket,window_start,hits)
     select bucket,date_trunc('minute',now()),1 from unnest($1::text[]) as t(bucket) order by bucket
     on conflict(bucket,window_start) do update set hits=least(pashloc_mfa_request_limits.hits+1,101)
     returning bucket,hits`,[[path+"|"+ip,path+"|aggregate"]])
  if(result.rows.some(row=>row.hits>(row.bucket.endsWith("|aggregate")?100:20))){
   return reply.header("Cache-Control","no-store").header("Retry-After","60").code(429).send({ok:false})
  }
 })
}
