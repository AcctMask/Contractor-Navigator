/** Isolated durable browser-session storage. No public issuance route.
 * Caller must verify password with Navigator authority before calling issue.
 * Does NOT issue Navigator JWT or grant authorization by itself.
 */
import { pool } from "../db/db"
import { issueRestrictedBrowserSecrets, readRestrictedSessionCookie, sha256, validateRestrictedBrowserRequest } from "./pashlocRestrictedBrowserV1"

export async function stageRestrictedBrowserSession(input:{
 tenantId:number;userId:number;challengeId:string;purpose:"enroll"|"verify"
}) {
 if(!Number.isSafeInteger(input.tenantId)||input.tenantId<=0||
    !Number.isSafeInteger(input.userId)||input.userId<=0||
    !/^[A-Za-z0-9_-]{43}$/.test(input.challengeId)) throw new Error("Invalid restricted-session scope")
 const secrets=issueRestrictedBrowserSecrets()
 const result=await pool.query(
  `insert into pashloc_mfa_restricted_browser_sessions
    (session_hash,csrf_hash,tenant_id,app_user_id,challenge_hash,purpose,expires_at)
   select $1,$2,c.tenant_id,c.app_user_id,c.challenge_hash,c.purpose,least($3::timestamptz,c.expires_at)
   from pashloc_mfa_challenges c
   where c.challenge_hash=$4 and c.tenant_id=$5 and c.app_user_id=$6
     and c.purpose=$7 and c.consumed_at is null and c.expires_at>now()
     and c.attempts<c.max_attempts
   returning expires_at`,
  [secrets.sessionHash,secrets.csrfHash,secrets.expiresAt,sha256(input.challengeId),
   input.tenantId,input.userId,input.purpose]
 )
 if(result.rowCount!==1) throw new Error("Restricted challenge unavailable")
 return {sessionId:secrets.sessionId,csrfToken:secrets.csrfToken,expiresAt:new Date(result.rows[0].expires_at).toISOString()}
}
export async function authorizeRestrictedBrowserRequest(input:{
 cookieHeader:unknown;csrfHeader:unknown;origin:unknown;expectedOrigin:string;
 secFetchSite:unknown;contentType:unknown;challengeId:string;purpose:"enroll"|"verify"
}):Promise<{tenantId:number;userId:number;challengeId:string}|null>{
 const cookie=readRestrictedSessionCookie(input.cookieHeader)
 if(!cookie||!/^[A-Za-z0-9_-]{43}$/.test(input.challengeId))return null
 const result=await pool.query(
  `select s.tenant_id,s.app_user_id,s.session_hash,s.csrf_hash,s.expires_at
     from pashloc_mfa_restricted_browser_sessions s
     join pashloc_mfa_challenges c on c.challenge_hash=s.challenge_hash
    where s.session_hash=$1 and s.challenge_hash=$2 and s.purpose=$3
      and s.revoked_at is null and s.expires_at>now()
      and c.consumed_at is null and c.expires_at>now()
      and c.attempts<c.max_attempts
      and c.tenant_id=s.tenant_id and c.app_user_id=s.app_user_id
      and c.purpose=s.purpose
    limit 1`,
  [sha256(cookie),sha256(input.challengeId),input.purpose]
 )
 if(result.rowCount!==1)return null
 const row=result.rows[0]
 const accepted=validateRestrictedBrowserRequest({
  origin:input.origin,expectedOrigin:input.expectedOrigin,
  secFetchSite:input.secFetchSite,contentType:input.contentType,
  cookieSession:cookie,csrfHeader:input.csrfHeader,
  sessionHash:row.session_hash,csrfHash:row.csrf_hash,
  expiresAtMs:new Date(row.expires_at).getTime()
 })
 return accepted?{tenantId:Number(row.tenant_id),userId:Number(row.app_user_id),challengeId:input.challengeId}:null
}
export async function revokeRestrictedBrowserSession(cookieHeader:unknown):Promise<void>{
 const cookie=readRestrictedSessionCookie(cookieHeader)
 if(!cookie)return
 await pool.query(
  "update pashloc_mfa_restricted_browser_sessions set revoked_at=now() where session_hash=$1 and revoked_at is null",
  [sha256(cookie)]
 )
}
