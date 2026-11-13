/**
 * Isolated Navigator original-browser approval endpoint.
 * Restricted session MUST have been issued following password verification
 * by Navigator's authentication authority. No public session issuance here.
 * No real credential transfer, JWT issuance, or production activation.
 */
import type {FastifyInstance} from "fastify"
import {authorizeRestrictedBrowserRequest} from "../services/pashlocRestrictedSessionStoreV1"
import {approvePashLocDeviceClaim} from "../services/pashlocDeviceApprovalV2"

export async function registerPashLocIsolatedBrowserApprovalRoutes(app:FastifyInstance){
 if(process.env.PASHLOC_ISOLATED_CLAIM_API!=="enabled"||
    !["development","test"].includes(process.env.NODE_ENV||""))return
 const expectedOrigin=process.env.PASHLOC_ISOLATED_NAVIGATOR_ORIGIN
 if(!expectedOrigin||!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(expectedOrigin))return
 app.post("/auth/mfa/enrollment/approve-device",async(request:any,reply)=>{
  reply.header("Cache-Control","no-store, private")
  reply.header("Referrer-Policy","no-referrer")
  reply.header("X-Content-Type-Options","nosniff")
  const body=request.body
  if(!body||typeof body!=="object"||
     typeof body.challenge_id!=="string"||
     ((typeof body.claim_id==="string")===(typeof body.pairing_ref==="string"))||
     typeof body.confirmation_code!=="string")
   return reply.code(400).send({ok:false,error:"invalid_request"})
  const session=await authorizeRestrictedBrowserRequest({
   cookieHeader:request.headers.cookie,
   csrfHeader:request.headers["x-pashloc-csrf"],
   origin:request.headers.origin,
   expectedOrigin,
   secFetchSite:request.headers["sec-fetch-site"],
   contentType:request.headers["content-type"],
   challengeId:body.challenge_id,
   purpose:"enroll"
  })
  if(!session)return reply.code(403).send({ok:false,error:"forbidden"})
  const result=await approvePashLocDeviceClaim({
   challengeId:session.challengeId,
   claimId:body.claim_id,
   pairingRef:body.pairing_ref,
   confirmationCode:body.confirmation_code,
   tenantId:session.tenantId,
   userId:session.userId
  })
  if(!result.approved)return reply.code(409).send({ok:false,error:"unavailable"})
  return {ok:true,approved:true,expires_at:result.expiresAt}
 })
}
