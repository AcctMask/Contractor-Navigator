import { createPublicKey, randomBytes, verify } from "node:crypto"
import type { FastifyInstance, FastifyReply } from "fastify"
import { pool } from "../db/db"
import { browserSessionDigest, sameSessionDigest } from "../services/pashlocSignedApprovalV1"
import { consumeSignedApproval, decideSignedApproval } from "../services/pashlocSignedApprovalStoreV1"
import { completePashLocNavigatorLogin } from "../services/authService"

import { verifyPashLocRestrictedCredentials } from "../services/pashlocRestrictedCredentialsV1"

const prefix = "/auth/mfa/signed/"
// The allowlist is test-only. Never infer tenant authorization from a browser-selected slug.
const tenantAllowed = (slug: unknown): slug is string =>
  typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
  process.env.PASHLOC_ACCEPTANCE_ONLY === "yes" &&
  process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME === "pashloc_iv_disposable_mfa_isolated" &&
  (process.env.PASHLOC_SIGNED_TEST_TENANTS || "pashloc-genuine-acceptance-20261114")
    .split(",").map(x => x.trim()).includes(slug)
const tenantForChallenge = async (reference: string): Promise<string | null> => {
  const result = await pool.query(`select t.slug from pashloc_signed_challenges c
    join tenants t on t.id=c.tenant_id where c.challenge_id=$1`,[reference])
  const slug = result.rows[0]?.slug
  return tenantAllowed(slug) ? slug : null
}
const opaque = (v:unknown):v is string => typeof v==="string" && /^[A-Za-z0-9_-]{43}$/.test(v)
const mint = () => randomBytes(32).toString("base64url")
const eligible = "u.is_active=true and u.pashloc_mfa_required=true and t.slug=$2"
const fail = (reply:FastifyReply, status:number,error:string) => reply.code(status).send({ok:false,error})
const iso = (value: Date) => value.toISOString()

export function registerSignedAcceptance(app:FastifyInstance) {
  const route = (path:string, phone:boolean,
      handler:(b:any, reply:FastifyReply)=>Promise<unknown>) => {
    app.post(prefix+path,async(req,reply)=>{
      reply.header("Cache-Control","no-store, private")
      if(req.headers.origin!==(phone ? process.env.PASHLOC_PHONE_ORIGIN : process.env.APP_BASE_URL) ||
          req.headers["content-type"]?.split(";")[0].trim()!=="application/json")
        return fail(reply,403,"forbidden")
      if(!req.body || typeof req.body!=="object" || Array.isArray(req.body)) return fail(reply,400,"malformed")
      return handler(req.body,reply)
    })
  }
  route("start",false,async (b,r)=>{
    if(!tenantAllowed(b.tenantSlug) || typeof b.email!=="string" || typeof b.password!=="string" ||
        !["login","register"].includes(b.mode)) return fail(r,400,"malformed")
    const identity=await verifyPashLocRestrictedCredentials({tenantSlug:b.tenantSlug,email:b.email,password:b.password})
    if(!identity) return fail(r,401,"invalid_credentials")
    const reference=mint(), browserProof=mint()
    const row=await pool.query(`select u.tenant_id,u.id as app_user_id,exists(
      select 1 from pashloc_signed_devices d where d.tenant_id=u.tenant_id and d.app_user_id=u.id
      and d.revoked_at is null and d.proof_verified_at is not null) as registered
      from app_users u join tenants t on t.id=u.tenant_id
      where u.id=$1 and ${eligible} and u.tenant_id=$3`,
      [identity.userId,b.tenantSlug,identity.tenantId])
    const account=row.rows[0]
    if(!account) return fail(r,404,"unavailable")
    if(account.registered!==(b.mode==="login"))
      return fail(r,409,account.registered?"already_registered":"registration_required")
    const result=await pool.query(`insert into pashloc_signed_challenges
      (challenge_id,browser_session_hash,tenant_id,app_user_id,purpose,expires_at)
      values($1,$2,$3,$4,$5,clock_timestamp()+case when $5='register' then interval '10 minutes' else interval '110 seconds' end) returning expires_at`,
      [reference,browserSessionDigest(browserProof),account.tenant_id,account.app_user_id,b.mode])
    const phoneUrl=new URL("/", process.env.PASHLOC_PHONE_ORIGIN)
    phoneUrl.hash=(b.mode==="login"?"navigator-sign=":"navigator-register=")+reference
    return {ok:true,reference,browserProof,expiresAt:iso(result.rows[0].expires_at),phoneUrl:phoneUrl.href}
  })
  route("registration-info",true,async (b,r)=>{
    if(!opaque(b.reference)) return fail(r,400,"malformed")
    const {rows:[row]}=await pool.query(`select c.tenant_id,c.app_user_id,c.expires_at,u.email,c.decided_at
      from pashloc_signed_challenges c join app_users u on u.id=c.app_user_id and u.tenant_id=c.tenant_id
      join tenants t on t.id=c.tenant_id where c.challenge_id=$1 and ${eligible} and c.purpose='register'`,
      [b.reference,await tenantForChallenge(b.reference)])
    if(!row)return fail(r,404,"unavailable")
    if(row.expires_at<=new Date() || row.decided_at)return fail(r,410,"expired_or_used")
    return {ok:true,tenantId:Number(row.tenant_id),userId:Number(row.app_user_id),account:row.email,application:"Navigator",expiresAt:iso(row.expires_at)}
  })
  route("register",true,async (b,r)=>{
    const j=b.publicJwk
    if(!opaque(b.reference)||!opaque(b.deviceId)||!opaque(b.grant)||
       !j||Object.keys(j).sort().join(",")!=="crv,kty,x,y"||
       j.kty!=="EC"||j.crv!=="P-256"||!opaque(j.x)||!opaque(j.y)||
       typeof b.signature!=="string"||!/^[A-Za-z0-9_-]{86}$/.test(b.signature))
       return fail(r,400,"malformed")
    const client=await pool.connect()
    try {
      await client.query("BEGIN")
      const {rows:[row]}=await client.query(`select c.id,c.tenant_id,c.app_user_id,c.expires_at,c.decided_at
        from pashloc_signed_challenges c join app_users u on u.id=c.app_user_id and u.tenant_id=c.tenant_id
        join tenants t on t.id=c.tenant_id where c.challenge_id=$1 and ${eligible}
        and c.purpose='register' for update of c,u`,[b.reference,tenant])
      if(!row || row.expires_at<=new Date() || row.decided_at) {
        await client.query("ROLLBACK")
        return fail(r,row?410:404,row?"expired_or_used":"unavailable")
      }
      const proof=Buffer.from(["AA-PASHLOC-LOGIN-V1/REGISTER","acceptance",row.tenant_id,row.app_user_id,
        b.reference,b.deviceId,iso(row.expires_at),j.x,j.y].join("\n"))
      let valid=false
      try { valid=verify("sha256",proof,{key:createPublicKey({key:j,format:"jwk"}),dsaEncoding:"ieee-p1363"},Buffer.from(b.signature,"base64url")) } catch { /* invalid key or proof */ }
      if(!valid){await client.query("ROLLBACK");return fail(r,404,"unavailable")}
      const grant=await client.query(`update pashloc_signed_enrollment_grants set used_at=clock_timestamp()
        where grant_hash=$1 and tenant_id=$2 and app_user_id=$3 and used_at is null
        and expires_at>clock_timestamp() returning grant_hash`,
        [browserSessionDigest(b.grant),row.tenant_id,row.app_user_id])
      if(grant.rowCount!==1){await client.query("ROLLBACK");return fail(r,404,"unavailable")}
      const inserted=await client.query(`insert into pashloc_signed_devices(tenant_id,app_user_id,device_id,public_jwk,proof_verified_at)
        values($1,$2,$3,$4,clock_timestamp()) on conflict do nothing returning id`,[row.tenant_id,row.app_user_id,b.deviceId,j])
      if(inserted.rowCount!==1){await client.query("ROLLBACK");return fail(r,409,"already_registered")}
      const updated=await client.query(`update pashloc_signed_challenges set decision='approve',decided_at=clock_timestamp(),approved_device_id=$2
        where id=$1 and expires_at>clock_timestamp() returning id`,[row.id,inserted.rows[0].id])
      if(updated.rowCount!==1){await client.query("ROLLBACK");return fail(r,410,"expired_or_used")}
      await client.query("COMMIT")
      return {ok:true,tenantId:Number(row.tenant_id),userId:Number(row.app_user_id),deviceId:b.deviceId}
    } catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
  })
  route("challenge",true,async (b,r)=>{
    if(!opaque(b.reference)||!opaque(b.deviceId))return fail(r,400,"malformed")
    const {rows:[row]}=await pool.query(`select c.tenant_id,c.app_user_id,c.browser_session_hash,c.expires_at,c.decided_at,u.email
      from pashloc_signed_challenges c join app_users u on u.id=c.app_user_id and u.tenant_id=c.tenant_id
      join tenants t on t.id=c.tenant_id join pashloc_signed_devices d on d.device_id=$3 and d.tenant_id=c.tenant_id
       and d.app_user_id=c.app_user_id and d.revoked_at is null and d.proof_verified_at is not null
      where c.challenge_id=$1 and ${eligible} and c.purpose='login'`,[b.reference,await tenantForChallenge(b.reference),b.deviceId])
    if(!row)return fail(r,404,"unavailable")
    if(row.expires_at<=new Date()||row.decided_at)return fail(r,410,"expired_or_used")
    return {ok:true,context:{version:"AA-PASHLOC-LOGIN-V1",environment:"acceptance",tenantId:row.tenant_id,
      userId:row.app_user_id,deviceId:b.deviceId,challengeId:b.reference,browserSessionHash:row.browser_session_hash,
      expiresAt:iso(row.expires_at)},account:row.email,application:"Navigator"}
  })
  route("decision",true,async (b,r)=>{
    if(!b.context||!opaque(b.context.challengeId)||!opaque(b.context.deviceId)||typeof b.signature!=="string")
      return fail(r,400,"malformed")
    if(!await tenantForChallenge(b.context.challengeId) || !await decideSignedApproval(b))return fail(r,404,"unavailable")
    return {ok:true}
  })
  route("complete",false,async(b,r)=>{
    if(!opaque(b.reference)||!opaque(b.browserProof))return fail(r,400,"malformed")
    if(!await tenantForChallenge(b.reference))return fail(r,404,"unavailable")
    const digest=browserSessionDigest(b.browserProof)
    const {rows:[row]}=await pool.query(`select id,tenant_id,app_user_id,browser_session_hash,expires_at,consumed_at,decision,purpose
      from pashloc_signed_challenges where challenge_id=$1`,[b.reference])
    if(!row||!sameSessionDigest(row.browser_session_hash,digest))return fail(r,404,"unavailable")
    if(row.consumed_at||row.expires_at<=new Date())return fail(r,410,"expired_or_used")
    if(!row.decision) return r.code(202).send({ok:true,state:"pending"})
    if(row.purpose==="register")return {ok:true,state:"registered"}
    if(row.decision==="deny")return {ok:true,state:"denied"}
    const token=await consumeSignedApproval({challengeId:b.reference,browserSessionHash:digest,tenantId:Number(row.tenant_id),userId:Number(row.app_user_id)})
    return token ? {ok:true,state:"approved",token} : fail(r,410,"expired_or_used")
  })
  route("revoke",false,async(b,r)=>{
    if(!opaque(b.fallbackChallengeId)||!opaque(b.deviceId)||typeof b.code!=="string"||!/^\d{6}$/.test(b.code))
      return fail(r,400,"malformed")
    let account
    try { account=(await completePashLocNavigatorLogin(b.fallbackChallengeId,b.code)).user }
    catch { return fail(r,404,"unavailable") }
    const revoked=await pool.query(`update pashloc_signed_devices d set revoked_at=clock_timestamp()
      from tenants t where t.id=d.tenant_id and t.slug=$4 and d.tenant_id=$1 and d.app_user_id=$2
      and d.device_id=$3 and d.revoked_at is null returning d.id`,[account.tenant_id,account.id,b.deviceId,await tenantForChallenge(b.fallbackChallengeId)])
    return revoked.rowCount===1 ? {ok:true} : fail(r,404,"unavailable")
  })
}
