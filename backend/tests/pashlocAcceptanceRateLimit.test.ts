import test from "node:test"
import assert from "node:assert/strict"
import Fastify from "fastify"
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/pashloc_acceptance_disposable"
const { pool } = await import("../src/db/db")
const { registerPashLocAcceptanceRateLimits } = await import("../src/services/pashlocAcceptanceRateLimit")

test("shared PostgreSQL rate limits, pinned origins, and per-IP/aggregate ceilings", async () => {
 const previousApp = process.env.APP_BASE_URL
 const previousPhone = process.env.PASHLOC_PHONE_ORIGIN
 process.env.APP_BASE_URL = "https://navigator-acceptance.example.test"
 process.env.PASHLOC_PHONE_ORIGIN = "https://phone-acceptance.example.test"
 const originalQuery = pool.query
 const hits = new Map<string,number>()
 const seen: string[][] = []
 ;(pool as any).query = async (_sql:string, params:any[]) => {
   const buckets = params[0] as string[]
   seen.push(buckets)
   const rows = buckets.map(bucket => {
     const count = Math.min((hits.get(bucket)||0)+1,101)
     hits.set(bucket,count)
     return {bucket,hits:count}
   })
   return {rows,rowCount:rows.length}
 }
 const app = Fastify()
 try {
   registerPashLocAcceptanceRateLimits(app)
   app.post("/auth/mfa/login/verify",async()=>({ok:true}))
   app.post("/auth/acceptance-a/login",async()=>({ok:true}))
   app.get("/auth/me",async()=>({ok:true}))
   await app.ready()
   const post = (origin:string,path="/auth/mfa/login/verify") =>
     app.inject({method:"POST",url:path,headers:{origin}})
   assert.equal((await post("https://navigator-acceptance.example.test.evil.invalid")).statusCode,403)
   assert.equal((await post("http://navigator-acceptance.example.test")).statusCode,403)
   assert.equal((await post("")).statusCode,403)
   assert.equal(seen.length,0,"rejected origins never consume database buckets")
   for(let i=0;i<20;i++) assert.equal((await post(process.env.APP_BASE_URL!)).statusCode,200)
   const limited=await post(process.env.PASHLOC_PHONE_ORIGIN!)
   assert.equal(limited.statusCode,429)
   assert.equal(limited.headers["retry-after"],"60")
   assert.equal(hits.get("/auth/mfa/login/verify|aggregate"),21)
   assert.equal(seen[0].length,2)
   assert.ok(seen[0][0].startsWith("/auth/mfa/login/verify|ip|"))
   assert.equal((await post(process.env.APP_BASE_URL!,"/auth/acceptance-a/login")).statusCode,200)
   const before=seen.length
   assert.equal((await app.inject({method:"GET",url:"/auth/me"})).statusCode,200)
   assert.equal(seen.length,before,"CRM GET does not consume MFA limits")
   // Simulate 80 requests from other instances/IPs in the same shared DB minute.
   hits.set("/auth/acceptance-a/login|aggregate",100)
   assert.equal((await post(process.env.APP_BASE_URL!,"/auth/acceptance-a/login")).statusCode,429)
 } finally {
   ;(pool as any).query=originalQuery
   if(previousApp===undefined) delete process.env.APP_BASE_URL
   else process.env.APP_BASE_URL=previousApp
   if(previousPhone===undefined) delete process.env.PASHLOC_PHONE_ORIGIN
   else process.env.PASHLOC_PHONE_ORIGIN=previousPhone
   await app.close()
 }
})
