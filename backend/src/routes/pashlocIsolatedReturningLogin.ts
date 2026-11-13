/** Isolated returning-login MFA verification. NEVER issues Navigator JWTs.
 * Real session issuance must be integrated separately after Security Assurance approval.
 */
import type {FastifyInstance} from "fastify"
import {pool} from "../db/db"
import {verifyPashLocRestrictedCredentials} from "../services/pashlocRestrictedCredentialsV1"
import {createPashLocLoginChallenge} from "../services/pashlocChallenge"
import {stageRestrictedBrowserSession,authorizeRestrictedBrowserRequest,revokeRestrictedBrowserSession} from "../services/pashlocRestrictedSessionStoreV1"
import {restrictedCookie,clearRestrictedCookie} from "../services/pashlocRestrictedBrowserV1"
import {verifyPashLocReturningLogin} from "../services/pashlocVerifyLogin"

export async function registerPashLocIsolatedReturningLoginRoutes(app:FastifyInstance){
 if(process.env.PASHLOC_ISOLATED_CLAIM_API!=="enabled"||
    !["development","test"].includes(process.env.NODE_ENV||"")||
    process.env.PASHLOC_ISOLATED_SHARED_RATE_LIMITS_VERIFIED!=="yes")return
 const origin=process.env.PASHLOC_ISOLATED_NAVIGATOR_ORIGIN
 if(!origin||!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(origin))return
 const allowed=(r:any)=>r.headers.origin===origin&&
  (r.headers["sec-fetch-site"]===undefined||r.headers["sec-fetch-site"]==="same-origin")&&
  r.headers["content-type"]?.split(";")[0]?.trim().toLowerCase()==="application/json"
 app.post("/auth/mfa/login/start",async(req:any,reply)=>{
  reply.header("Cache-Control","no-store, private")
  if(!allowed(req))return reply.code(403).send({ok:false})
  const b=req.body
  if(!b||typeof b!=="object")return reply.code(400).send({ok:false})
  const account=await verifyPashLocRestrictedCredentials({
   tenantSlug:b.tenant_slug,email:b.email,password:b.password
  })
  if(!account)return reply.code(401).send({ok:false,error:"invalid_credentials"})
  const enrollment=await pool.query(
   "select 1 from pashloc_mfa_enrollments where tenant_id=$1 and app_user_id=$2 and status='confirmed' limit 1",
   [account.tenantId,account.userId])
  if(enrollment.rowCount!==1)return reply.code(403).send({ok:false,error:"mfa_not_enrolled"})
  const challenge=await createPashLocLoginChallenge({
   tenantId:account.tenantId,userId:account.userId,purpose:"verify"
  })
  const session=await stageRestrictedBrowserSession({
   tenantId:account.tenantId,userId:account.userId,
   challengeId:challenge.challengeId,purpose:"verify"
  })
  reply.header("Set-Cookie",restrictedCookie(session.sessionId))
  return {ok:true,challenge_id:challenge.challengeId,csrf_token:session.csrfToken,
   expires_at:session.expiresAt,requires_mfa:true}
 })
 app.post("/auth/mfa/login/verify",async(req:any,reply)=>{
  reply.header("Cache-Control","no-store, private")
  if(!allowed(req))return reply.code(403).send({ok:false})
  const b=req.body
  if(!b||typeof b.challenge_id!=="string"||typeof b.code!=="string")
   return reply.code(400).send({ok:false})
  const session=await authorizeRestrictedBrowserRequest({
   cookieHeader:req.headers.cookie,csrfHeader:req.headers["x-pashloc-csrf"],
   origin:req.headers.origin,expectedOrigin:origin,
   secFetchSite:req.headers["sec-fetch-site"],contentType:req.headers["content-type"],
   challengeId:b.challenge_id,purpose:"verify"
  })
  if(!session)return reply.code(403).send({ok:false})
  const verified=await verifyPashLocReturningLogin(session.challengeId,b.code)
  if(!verified||verified.tenantId!==session.tenantId||verified.userId!==session.userId)
   return reply.code(401).send({ok:false,error:"invalid_code"})
  await revokeRestrictedBrowserSession(req.headers.cookie)
  reply.header("Set-Cookie",clearRestrictedCookie())
  return {ok:true,mfa_verified:true,session_issued:false}
 })
}
