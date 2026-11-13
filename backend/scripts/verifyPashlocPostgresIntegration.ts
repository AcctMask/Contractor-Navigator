/** Actual PostgreSQL and Fastify integration test. Disposable isolated DB ONLY.
 * Never use production database or real account credentials.
 */
import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {createHash,createDecipheriv,createPublicKey,diffieHellman,generateKeyPairSync,hkdfSync,randomBytes,sign} from "node:crypto"
import bcrypt from "bcryptjs"
const dbUrl=process.env.DATABASE_URL||""
const u=new URL(dbUrl)
assert.ok(["127.0.0.1","localhost"].includes(u.hostname),"Refusing nonloopback DB")
assert.equal(process.env.NODE_ENV,"test")
assert.equal(process.env.PASHLOC_ISOLATED_PG_NO_SSL,"yes")
process.env.PASHLOC_ISOLATED_CLAIM_API="enabled"
process.env.PASHLOC_ISOLATED_SHARED_RATE_LIMITS_VERIFIED="yes"
process.env.PASHLOC_ISOLATED_NAVIGATOR_ORIGIN="https://navigator-isolated.example.test"
process.env.PASHLOC_ISOLATED_PHONE_ORIGIN="https://pashloc-isolated.example.test"
process.env.PASHLOC_MFA_ENCRYPTION_KEY_BASE64=randomBytes(32).toString("base64")
const {pool}=await import("../src/db/db")
const {buildPashLocIsolatedServer}=await import("../src/pashlocIsolatedServer")
const {claimTranscript,redeemTranscript,encodeCanonicalContext,publicKeyFingerprint}=await import("../src/services/pashlocEnrollV1Crypto")
const sha=(x:string)=>createHash("sha256").update(x).digest("hex")
for(const sql of [
 "pashloc_iv_mfa_isolated_schema_20261112.sql",
 "pashloc_iv_mfa_pairing_protocol_isolated_20261112.sql",
 "pashloc_iv_mfa_device_claim_nonces_isolated_20261112.sql",
 "pashloc_iv_mfa_restricted_browser_sessions_isolated_20261112.sql",
 "pashloc_iv_mfa_synthetic_redemption_isolated_20261112.sql",
 "pashloc_iv_mfa_disposable_activation_isolated_20261113.sql"
]) {
 if(sql==="pashloc_iv_mfa_isolated_schema_20261112.sql"){
  await pool.query(`create table tenants(id bigserial primary key,slug text unique not null);
   create table app_users(id bigserial primary key,tenant_id bigint not null references tenants(id),
    email text not null,password_hash text not null,is_active boolean not null default true)`)
 }
 await pool.query(readFileSync(new URL("../sql/"+sql,import.meta.url),"utf8"))
}
const tenant=await pool.query("insert into tenants(slug) values('isolated-tenant') returning id")
const tenantId=tenant.rows[0].id
const user=await pool.query("insert into app_users(tenant_id,email,password_hash,is_active) values($1,$2,$3,true) returning id",
 [tenantId,"isolated@example.test",await bcrypt.hash("Disposable-Test-Password!9",10)])
const userId=user.rows[0].id
const app=await buildPashLocIsolatedServer()
const navigatorOrigin="https://navigator-isolated.example.test"
const phoneOrigin="https://pashloc-isolated.example.test"
const browserHeaders={origin:navigatorOrigin,"content-type":"application/json","sec-fetch-site":"same-origin"}
const phoneHeaders={origin:phoneOrigin,"content-type":"application/json"}
const post=async(path:string,body:unknown,headers:Record<string,string>)=>
 app.inject({method:"POST",url:path,headers,payload:body as object})
const makeDevice=()=>{
 const signing=generateKeyPairSync("ec",{namedCurve:"prime256v1"})
 const agreement=generateKeyPairSync("ec",{namedCurve:"prime256v1"})
 const publicSign=signing.publicKey.export({format:"jwk"}) as any
 const publicAgree=agreement.publicKey.export({format:"jwk"}) as any
 return {signing,agreement,publicSign,publicAgree}
}
const signTranscript=(key:any,transcript:Buffer)=>sign("sha256",transcript,{key:key.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url")
try {
 const started=await post("/auth/mfa/enrollment/start",{
  tenant_slug:"isolated-tenant",email:"isolated@example.test",password:"Disposable-Test-Password!9"
 },browserHeaders)
 assert.equal(started.statusCode,200,started.body)
 const st=started.json()
 const cookie=String(started.headers["set-cookie"]).split(";")[0]
 assert.equal(typeof st.pairing_ref,"string")
 const browser=await app.inject({method:"GET",url:"/isolated/mfa"})
 assert.equal(browser.statusCode,200)
 assert.match(browser.body,/Navigator MFA acceptance test/)
 const spanish=await app.inject({method:"GET",url:"/isolated/mfa?lang=es"})
 assert.equal(spanish.headers["content-language"],"es")
 assert.match(spanish.body,/Prueba de aceptación de MFA de Navigator/)
 assert.match(spanish.body,/Cerrar sesión/)
 const javascript=await app.inject({method:"GET",url:"/isolated/mfa/browser.js"})
 assert.equal(javascript.statusCode,200)
 assert.doesNotThrow(()=>new Function(javascript.body))
 assert.match(javascript.body,/Demasiados intentos/)
 const enrollmentQr=await post("/auth/mfa/browser-qr",{
  mode:"enroll",challenge_id:st.challenge_id,pairing_ref:st.pairing_ref
 },{...browserHeaders,cookie,"x-pashloc-csrf":st.csrf_token})
 assert.equal(enrollmentQr.statusCode,200)
 assert.match(enrollmentQr.json().image,/^data:image\/png;base64,/)
 const expired=await post("/auth/mfa/enrollment/start",{
  tenant_slug:"isolated-tenant",email:"isolated@example.test",password:"Disposable-Test-Password!9"
 },browserHeaders)
 assert.equal(expired.statusCode,200)
 const expiredPair=expired.json().pairing_ref
 await pool.query("update pashloc_mfa_pairings set expires_at=now()-interval '1 second' where pairing_hash=$1",[sha(expiredPair)])
 assert.equal((await post("/auth/mfa/device/claim-challenge",{pairing_ref:expiredPair},phoneHeaders)).statusCode,404)
 const device=makeDevice()
 const nonce=await post("/auth/mfa/device/claim-challenge",{pairing_ref:st.pairing_ref},phoneHeaders)
 assert.equal(nonce.statusCode,200,nonce.body)
 const n=nonce.json().proof_nonce
 const signature=signTranscript(device.signing,claimTranscript({
  pairingRef:st.pairing_ref,nonce:n,
  signingKey:device.publicSign,agreementKey:device.publicAgree
 }))
 const claimed=await post("/auth/mfa/device/claim",{
  pairing_ref:st.pairing_ref,proof_nonce:n,proof_signature:signature,
  device_public_key_jwk:device.publicSign,device_ecdh_public_key_jwk:device.publicAgree,
  protocol_version:"AA-PASHLOC-ENROLL-V1"
 },phoneHeaders)
 assert.equal(claimed.statusCode,200,claimed.body)
 const claim=claimed.json()
 const replayClaim=await post("/auth/mfa/device/claim",{
  pairing_ref:st.pairing_ref,proof_nonce:n,proof_signature:signature,
  device_public_key_jwk:device.publicSign,device_ecdh_public_key_jwk:device.publicAgree,
  protocol_version:"AA-PASHLOC-ENROLL-V1"
 },phoneHeaders)
 assert.equal(replayClaim.statusCode,409,"claim nonce replay must fail")
 const approvedHeaders={...browserHeaders,cookie,"x-pashloc-csrf":st.csrf_token}
 const wrong=await post("/auth/mfa/enrollment/approve-device",{
  challenge_id:st.challenge_id,claim_id:claim.claim_id,
  confirmation_code:claim.confirmation_code==="00000000"?"99999999":"00000000"
 },approvedHeaders)
 assert.equal(wrong.statusCode,409,"wrong approval must fail")
 const approval=await post("/auth/mfa/enrollment/approve-device",{
  challenge_id:st.challenge_id,pairing_ref:st.pairing_ref,confirmation_code:claim.confirmation_code
 },approvedHeaders)
 assert.equal(approval.statusCode,200,approval.body)
 const redemptionChallenge=await post("/auth/mfa/device/redeem-challenge",{
  pairing_ref:st.pairing_ref,claim_id:claim.claim_id,claimant_proof:claim.claimant_proof
 },phoneHeaders)
 assert.equal(redemptionChallenge.statusCode,200,redemptionChallenge.body)
 const firstNonce=redemptionChallenge.json().redeem_nonce
 const redemptionBody=(nonce:string,deviceKey= device)=>({
  pairing_ref:st.pairing_ref,claim_id:claim.claim_id,claimant_proof:claim.claimant_proof,
  redeem_nonce:nonce,
  redeem_signature:signTranscript(deviceKey.signing,redeemTranscript({
   claimId:claim.claim_id,pairingRef:st.pairing_ref,nonce,
   signingKey:device.publicSign,agreementKey:device.publicAgree
  }))
 })
 const alien=makeDevice()
 const wrongDevice=await post("/auth/mfa/device/redeem",redemptionBody(firstNonce,alien),phoneHeaders)
 assert.equal(wrongDevice.statusCode,409,"wrong signer must fail")
 const first=await post("/auth/mfa/device/redeem",redemptionBody(firstNonce),phoneHeaders)
 assert.equal(first.statusCode,200,first.body)
 const envelope=first.json().envelope
 assert.equal(envelope.version,"AA-PASHLOC-ENROLL-V1")
 const replay=await post("/auth/mfa/device/redeem",redemptionBody(firstNonce),phoneHeaders)
 assert.equal(replay.statusCode,409,"consumed original nonce must fail")
 const retryChallenge=await post("/auth/mfa/device/redeem-challenge",{
  pairing_ref:st.pairing_ref,claim_id:claim.claim_id,claimant_proof:claim.claimant_proof
 },phoneHeaders)
 assert.equal(retryChallenge.statusCode,200,retryChallenge.body)
 const retryNonce=retryChallenge.json().redeem_nonce
 assert.notEqual(retryNonce,firstNonce,"retry needs a fresh nonce")
 const concurrent=await Promise.all([
  post("/auth/mfa/device/redeem",redemptionBody(retryNonce),phoneHeaders),
  post("/auth/mfa/device/redeem",redemptionBody(retryNonce),phoneHeaders)
 ])
 assert.deepEqual(concurrent.map(r=>r.statusCode).sort((a,b)=>a-b),[200,409],
  "concurrent use of one retry nonce must allow exactly one success")
 const retry=concurrent.find(r=>r.statusCode===200)!
 assert.deepEqual(retry.json().envelope,envelope,"retry must not issue new secret")
 const retryReplay=await post("/auth/mfa/device/redeem",redemptionBody(retryNonce),phoneHeaders)
 assert.equal(retryReplay.statusCode,409,"retry nonce must be atomic single-use")
 const persisted=await pool.query("select synthetic_envelope,synthetic_retry_attempts,redeemed_at from pashloc_mfa_pairings where pairing_hash=$1",[sha(st.pairing_ref)])
 assert.equal(persisted.rowCount,1)
 assert.deepEqual(persisted.rows[0].synthetic_envelope,envelope)
 assert.equal(persisted.rows[0].synthetic_retry_attempts,1)
 assert.ok(persisted.rows[0].redeemed_at)
 const scope=await post("/auth/mfa/enrollment/start",{
  tenant_slug:"wrong-tenant",email:"isolated@example.test",password:"Disposable-Test-Password!9"
 },browserHeaders)
 assert.equal(scope.statusCode,401,"cross-tenant password attempt denied")
 const {decryptPashLocSecret}=await import("../src/services/pashlocSecretCrypto")
 const {pashLocTotpAtStep}=await import("../src/services/pashlocTotp")
 const secretRow=await pool.query(
  `select e.*,p.browser_approval_id from pashloc_mfa_enrollments e
    join pashloc_mfa_pairings p on p.id=e.delivery_pairing_id
    where e.tenant_id=$1 and e.app_user_id=$2 and p.pairing_hash=$3`,[tenantId,userId,sha(st.pairing_ref)])
 assert.equal(secretRow.rowCount,1)
 const row=secretRow.rows[0]
 assert.equal(row.status,"pending","delivery must not activate MFA")
 const context=encodeCanonicalContext({
  version:"AA-PASHLOC-ENROLL-V1",environment:"isolated",application:"Navigator",
  tenantId:String(tenantId),userId:String(userId),accountId:row.account_id,approvalId:row.browser_approval_id,
  pairingRef:st.pairing_ref,claimId:claim.claim_id,redeemNonce:firstNonce,
  signingFingerprint:publicKeyFingerprint(device.publicSign),agreementFingerprint:publicKeyFingerprint(device.publicAgree)
 })
 const recovered=retry.json().envelope
 assert.equal(recovered.context,context.toString("base64url"))
 const open=(privateKey:typeof device.agreement.privateKey,transcript:Buffer)=>{
  const peer=createPublicKey({key:recovered.ephemeral_public_key_jwk,format:"jwk"})
  const shared=diffieHellman({privateKey,publicKey:peer})
  const key=Buffer.from(hkdfSync("sha256",shared,Buffer.from(recovered.salt,"base64url"),
   Buffer.concat([Buffer.from("AA-PASHLOC-ENROLL-V1/HKDF-AES256GCM\0"),transcript]),32))
  const cipher=createDecipheriv("aes-256-gcm",key,Buffer.from(recovered.nonce,"base64url"))
  cipher.setAAD(Buffer.concat([Buffer.from("AA-PASHLOC-ENROLL-V1/AES-GCM\0"),transcript,
   Buffer.from(publicKeyFingerprint(recovered.ephemeral_public_key_jwk),"hex")]))
  cipher.setAuthTag(Buffer.from(recovered.tag,"base64url"))
  return Buffer.concat([cipher.update(Buffer.from(recovered.ciphertext,"base64url")),cipher.final()]).toString()
 }
 assert.throws(()=>open(alien.agreement.privateKey,context),"wrong ECDH key must fail")
 assert.throws(()=>open(device.agreement.privateKey,Buffer.concat([context,Buffer.from("altered")])),"altered context must fail")
 const phoneSecret=open(device.agreement.privateKey,context)
 assert.match(phoneSecret,/^[A-Z2-7]{32}$/)
 assert.ok(!row.encrypted_secret.includes(Buffer.from(phoneSecret)))
 assert.ok(phoneSecret===decryptPashLocSecret(row.encrypted_secret,Number(tenantId),Number(userId),row.account_id))
 assert.throws(()=>decryptPashLocSecret(row.encrypted_secret,Number(tenantId)+1,Number(userId),row.account_id))
 assert.throws(()=>decryptPashLocSecret(row.encrypted_secret,Number(tenantId),Number(userId),"A".repeat(32)))
 for(const response of [started,approval,first,retry])assert.ok(!response.body.includes(phoneSecret))
 const activate=(code:string,headers=approvedHeaders)=>post("/auth/mfa/enrollment/confirm",{
  challenge_id:st.challenge_id,pairing_ref:st.pairing_ref,code
 },headers)
 const nowStep=Math.floor(Date.now()/30000)
 const firstCode=pashLocTotpAtStep(phoneSecret,nowStep)
 const incorrect=Array.from({length:8},(_,i)=>String(i).padStart(6,"0")).find(
  candidate=>![-1,0,1,2].some(offset=>pashLocTotpAtStep(phoneSecret,nowStep+offset)===candidate))!
 assert.equal((await activate(firstCode,{...approvedHeaders,origin:phoneOrigin})).statusCode,403)
 assert.equal((await activate(incorrect)).statusCode,401,"incorrect first TOTP must not activate")
 const confirmed=await activate(firstCode)
 assert.equal(confirmed.statusCode,200)
 assert.equal(confirmed.json().account_id,row.account_id)
 assert.ok(!confirmed.body.includes(phoneSecret))
 assert.equal((await activate(firstCode)).statusCode,403,"duplicate activation must fail")
 assert.equal((await pool.query("select synthetic_envelope from pashloc_mfa_pairings where pairing_hash=$1",[sha(st.pairing_ref)])).rows[0].synthetic_envelope,null)
 const loginStarted=await post("/auth/mfa/login/start",{
  tenant_slug:"isolated-tenant",email:"isolated@example.test",password:"Disposable-Test-Password!9"
 },browserHeaders)
 assert.equal(loginStarted.statusCode,200,loginStarted.body)
 const loginData=loginStarted.json()
 assert.equal(loginData.requires_mfa,true)
 assert.equal(loginData.account_id,row.account_id)
 const loginCookie=String(loginStarted.headers["set-cookie"]).split(";")[0]
 const loginHeaders={...browserHeaders,cookie:loginCookie,"x-pashloc-csrf":loginData.csrf_token}
 const returningQr=await post("/auth/mfa/browser-qr",{
  mode:"login",challenge_id:loginData.challenge_id,account_id:loginData.account_id
 },loginHeaders)
 assert.equal(returningQr.statusCode,200)
 assert.match(returningQr.json().image,/^data:image\/png;base64,/)
 const invalidCsrf=await post("/auth/mfa/login/verify",{
  challenge_id:loginData.challenge_id,code:firstCode
 },{...loginHeaders,"x-pashloc-csrf":"wrong"})
 assert.equal(invalidCsrf.statusCode,403,"incorrect CSRF must be denied")
 const otpReplayResponse=await post("/auth/mfa/login/verify",{
  challenge_id:loginData.challenge_id,code:firstCode
 },loginHeaders)
 assert.equal(otpReplayResponse.statusCode,401,"already accepted enrollment step must not verify login")
 const protectedRoute=(cookie:string)=>app.inject({method:"GET",url:"/isolated/mfa/session-check",headers:{cookie}})
 assert.equal((await protectedRoute(loginCookie)).statusCode,401,"restricted cookie must not grant a session")
 assert.equal((await app.inject({method:"GET",url:"/jobs",headers:{cookie:loginCookie}})).statusCode,404)
 const nextStep=nowStep+1
 // Wait for the later step on the real clock. Never reset persisted replay state.
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,nextStep*30000-Date.now()+50)))
 const verifiedResponse=await post("/auth/mfa/login/verify",{
  challenge_id:loginData.challenge_id,code:pashLocTotpAtStep(phoneSecret,nextStep)
 },loginHeaders)
 assert.equal(verifiedResponse.statusCode,200,verifiedResponse.body)
 assert.equal(verifiedResponse.json().session_scope,"isolated-test-only")
 const setCookies=verifiedResponse.headers["set-cookie"]
 assert.ok(Array.isArray(setCookies))
 const operationalCookie=setCookies.find(v=>v.startsWith("__Host-pashloc_disposable="))!.split(";")[0]
 const authorized=await protectedRoute(operationalCookie)
 assert.equal(authorized.statusCode,200)
 assert.equal(authorized.json().account_id,row.account_id)
 assert.equal((await app.inject({method:"GET",url:"/jobs",headers:{cookie:operationalCookie}})).statusCode,404)
 assert.equal((await pool.query("select last_accepted_step from pashloc_mfa_enrollments where id=$1",[row.id])).rows[0].last_accepted_step,String(nextStep))
 assert.equal((await post("/auth/mfa/login/sign-out",{}, {...browserHeaders,cookie:operationalCookie})).statusCode,200)
 assert.equal((await protectedRoute(operationalCookie)).statusCode,401)
 const reusedResponse=await post("/auth/mfa/login/verify",{
  challenge_id:loginData.challenge_id,code:firstCode
 },loginHeaders)
 assert.equal(reusedResponse.statusCode,403,"consumed login challenge must not be reusable")
 const badLogin=await post("/auth/mfa/login/start",{
  tenant_slug:"isolated-tenant",email:"isolated@example.test",password:"incorrect-password"
 },browserHeaders)
 assert.equal(badLogin.statusCode,401)
 for(const [path,headers] of [
  ["/auth/mfa/enrollment/start",browserHeaders],["/auth/mfa/login/start",browserHeaders],
  ["/auth/mfa/device/claim-challenge",phoneHeaders],["/auth/mfa/enrollment/approve-device",browserHeaders],
  ["/auth/mfa/device/redeem",phoneHeaders],["/auth/mfa/enrollment/confirm",browserHeaders],
  ["/auth/mfa/login/verify",browserHeaders]
 ] as const){
  // Seed the previous hits in this minute so the HTTP assertion cannot straddle a window.
  const ip=sha("127.0.0.1")
  await pool.query(
   `insert into pashloc_mfa_request_limits(bucket,window_start,hits) values ($1,date_trunc('minute',now()),20)
    on conflict(bucket,window_start) do update set hits=20`,[path+"|"+ip])
  let limited=await post(path,{},headers)
  for(let attempt=0;attempt<20&&limited.statusCode!==429;attempt++)limited=await post(path,{},headers)
  assert.equal(limited.statusCode,429,path+" must enforce throttling")
  assert.equal(limited.headers["retry-after"],"60")
 }
 console.log("PASS: exact-origin enrollment and returning QR; observed HTTP throttling across password, claim, approval, redemption and TOTP")
 console.log("PASS: one delivered disposable seed for encrypted custody, first-code activation and later returning login; restricted and isolated test session boundaries; TOTP replay rejected without resetting state")
 console.log("PASS: disposable PostgreSQL migration; password-scoped enrollment; signed device claim; wrong approval; original browser approval; signed synthetic redemption; wrong signer; replay rejection; fresh same-device retry; concurrent same-nonce serialization; immutable envelope; cross-tenant denial")
} finally {
 await app.close()
 await pool.end()
}
