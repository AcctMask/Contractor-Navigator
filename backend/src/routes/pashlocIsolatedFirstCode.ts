/** First-code confirmation for the same original restricted Navigator browser. */
import type {FastifyInstance} from "fastify"
import {confirmPashLocFirstCode} from "../services/pashlocConfirmEnrollment"
import {authorizeRestrictedBrowserRequest} from "../services/pashlocRestrictedSessionStoreV1"
import {clearRestrictedCookie} from "../services/pashlocRestrictedBrowserV1"

export async function registerPashLocIsolatedFirstCode(app:FastifyInstance){
 const expectedOrigin=process.env.PASHLOC_ISOLATED_NAVIGATOR_ORIGIN
 if(!expectedOrigin)return
 app.post("/auth/mfa/enrollment/confirm",async(req,reply)=>{
  reply.headers({"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer"})
  const b=req.body as Record<string,unknown>|null
  if(!b||typeof b.challenge_id!=="string"||typeof b.pairing_ref!=="string"||typeof b.code!=="string")
   return reply.code(400).send({ok:false})
  const session=await authorizeRestrictedBrowserRequest({
   cookieHeader:req.headers.cookie,csrfHeader:req.headers["x-pashloc-csrf"],
   origin:req.headers.origin,expectedOrigin,secFetchSite:req.headers["sec-fetch-site"],
   contentType:req.headers["content-type"],challengeId:b.challenge_id,purpose:"enroll"
  })
  if(!session)return reply.code(403).send({ok:false})
  const verified=await confirmPashLocFirstCode({
   challengeId:session.challengeId,pairingId:b.pairing_ref,
   tenantId:session.tenantId,userId:session.userId,code:b.code
  })
  if(!verified)return reply.code(401).send({ok:false})
  reply.header("Set-Cookie",clearRestrictedCookie())
  return {ok:true,enrollment_confirmed:true,account_id:verified.accountId}
 })
}
