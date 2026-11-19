/** Isolated phone synthetic redemption; no genuine credentials or JWT. */
import type {FastifyInstance} from "fastify"
import {issuePashLocSyntheticRedeemNonce} from "../services/pashlocSyntheticRedeemNonceV1"
import {redeemPashLocSynthetic} from "../services/pashlocSyntheticRedeemV1"
const token=/^[A-Za-z0-9_-]{43}$/
export async function registerPashLocIsolatedSyntheticRedeemRoutes(app:FastifyInstance){
 if(process.env.PASHLOC_ISOLATED_CLAIM_API!=="enabled"||
    !["development","test"].includes(process.env.NODE_ENV||"")||
    process.env.PASHLOC_ISOLATED_SHARED_RATE_LIMITS_VERIFIED!=="yes")return
 const origin=process.env.PASHLOC_ISOLATED_PHONE_ORIGIN
 if(!origin||!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(origin))return
 const cors={"Access-Control-Allow-Origin":origin,
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"}
 const paths=["/auth/mfa/device/redeem-challenge","/auth/mfa/device/redeem"]
 for(const path of paths){
  app.options(path,async(req:any,reply)=>{
   if(req.headers.origin!==origin||
      req.headers["access-control-request-method"]!=="POST"||
      !/^content-type$/i.test(String(req.headers["access-control-request-headers"]||"").trim()))
    return reply.code(403).send()
   return reply.headers(cors).code(204).send()
  })
 }
 const allowed=(req:any)=>req.headers.origin===origin&&
  req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase()==="application/json"
 app.post(paths[0],async(req:any,reply)=>{
  reply.header("Cache-Control","no-store")
  if(!allowed(req))return reply.code(403).send({ok:false})
  const b=req.body
  if(!b||![b.pairing_ref,b.claim_id,b.claimant_proof].every((v:unknown)=>typeof v==="string"&&token.test(v)))
   return reply.code(400).send({ok:false})
  const result=await issuePashLocSyntheticRedeemNonce({
   pairingRef:b.pairing_ref,claimId:b.claim_id,claimantProof:b.claimant_proof
  })
  if(!result)return reply.code(409).send({ok:false})
  return reply.headers(cors).send({ok:true,...result})
 })
 app.post(paths[1],async(req:any,reply)=>{
  reply.header("Cache-Control","no-store")
  if(!allowed(req))return reply.code(403).send({ok:false})
  const b=req.body
  if(!b||typeof b!=="object")return reply.code(400).send({ok:false})
  const envelope=await redeemPashLocSynthetic(b)
  if(!envelope)return reply.code(409).send({ok:false})
  return reply.headers(cors).send({ok:true,envelope})
 })
}
