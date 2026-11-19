/** Nonproduction isolated MFA enrollment initiation.
 * Verifies existing Navigator password WITHOUT issuing a Navigator JWT.
 * The cookie is restricted to enrollment; no session or secret is returned.
 * Requires shared gateway rate limits before network deployment.
 */
import type {FastifyInstance} from "fastify"
import {verifyPashLocRestrictedCredentials} from "../services/pashlocRestrictedCredentialsV1"
import {createPashLocLoginChallenge} from "../services/pashlocChallenge"
import {createPashLocPairing} from "../services/pashlocPairing"
import {stageRestrictedBrowserSession} from "../services/pashlocRestrictedSessionStoreV1"
import {restrictedCookie} from "../services/pashlocRestrictedBrowserV1"

export async function registerPashLocIsolatedEnrollmentStartRoutes(app:FastifyInstance){
 if(process.env.PASHLOC_ISOLATED_CLAIM_API!=="enabled"||
    !["development","test"].includes(process.env.NODE_ENV||""))return
 const origin=process.env.PASHLOC_ISOLATED_NAVIGATOR_ORIGIN
 if(!origin||!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(origin))return
 // Do not expose a password-verification endpoint without gateway throttling.
 if(process.env.PASHLOC_ISOLATED_SHARED_RATE_LIMITS_VERIFIED!=="yes")return
 app.post("/auth/mfa/enrollment/start",async(request:any,reply)=>{
  reply.header("Cache-Control","no-store, private")
  reply.header("Referrer-Policy","no-referrer")
  const h=request.headers
  if(h.origin!==origin||
     (h["sec-fetch-site"]!==undefined&&h["sec-fetch-site"]!=="same-origin")||
     h["content-type"]?.split(";")[0]?.trim().toLowerCase()!=="application/json")
   return reply.code(403).send({ok:false,error:"forbidden"})
  const b=request.body
  if(!b||typeof b!=="object"||typeof b.tenant_slug!=="string"||
     typeof b.email!=="string"||typeof b.password!=="string")
   return reply.code(400).send({ok:false,error:"invalid_request"})
  try{
   const account=await verifyPashLocRestrictedCredentials({
    tenantSlug:b.tenant_slug,email:b.email,password:b.password
   })
   if(!account)return reply.code(401).send({ok:false,error:"invalid_credentials"})
   const challenge=await createPashLocLoginChallenge({
    tenantId:account.tenantId,userId:account.userId,purpose:"enroll"
   })
   const pairing=await createPashLocPairing({
    challengeId:challenge.challengeId,tenantId:account.tenantId,userId:account.userId
   })
   const session=await stageRestrictedBrowserSession({
    tenantId:account.tenantId,userId:account.userId,
    challengeId:challenge.challengeId,purpose:"enroll"
   })
   reply.header("Set-Cookie",restrictedCookie(session.sessionId))
   return {ok:true,challenge_id:challenge.challengeId,
    pairing_ref:pairing.pairingId,csrf_token:session.csrfToken,
    expires_at:pairing.expiresAt}
  }catch{
   return reply.code(401).send({ok:false,error:"unavailable"})
  }
 })
}
