/** Actual PostgreSQL and Fastify integration test. Disposable isolated DB ONLY.
 * Never use production database or real account credentials.
 */
import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {createHash,generateKeyPairSync,randomBytes,sign} from "node:crypto"
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
const {claimTranscript,redeemTranscript}=await import("../src/services/pashlocEnrollV1Crypto")
const sha=(x:string)=>createHash("sha256").update(x).digest("hex")
for(const sql of [
 "pashloc_iv_mfa_isolated_schema_20261112.sql",
 "pashloc_iv_mfa_pairing_protocol_isolated_20261112.sql",
 "pashloc_iv_mfa_device_claim_nonces_isolated_20261112.sql",
 "pashloc_iv_mfa_restricted_browser_sessions_isolated_20261112.sql",
 "pashloc_iv_mfa_synthetic_redemption_isolated_20261112.sql"
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
  challenge_id:st.challenge_id,claim_id:claim.claim_id,confirmation_code:claim.confirmation_code
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
 // Test existing isolated TOTP custody/activation primitives with a disposable
 // secret. This is NOT the PashLoc-delivered synthetic envelope credential.
 const {confirmPashLocFirstCode}=await import("../src/services/pashlocConfirmEnrollment")
 const {decryptPashLocSecret}=await import("../src/services/pashlocSecretCrypto")
 const {pashLocTotpAtStep}=await import("../src/services/pashlocTotp")
 const {createDecipheriv,hkdfSync,diffieHellman,createPublicKey}=await import("node:crypto")
 const context=Buffer.from(envelope.context,"base64url")
 const shared=diffieHellman({privateKey:device.agreement.privateKey,publicKey:createPublicKey({key:envelope.ephemeral_public_key_jwk,format:"jwk"})})
 const key=Buffer.from(hkdfSync("sha256",shared,Buffer.from(envelope.salt,"base64url"),Buffer.concat([Buffer.from("AA-PASHLOC-ENROLL-V1/HKDF-AES256GCM\0"),context]),32))
 const {publicKeyFingerprint}=await import("../src/services/pashlocEnrollV1Crypto")
 const fingerprint=publicKeyFingerprint(envelope.ephemeral_public_key_jwk)
 const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(envelope.nonce,"base64url"))
 decipher.setAAD(Buffer.concat([Buffer.from("AA-PASHLOC-ENROLL-V1/AES-GCM\0"),context,Buffer.from(fingerprint,"hex")]))
 decipher.setAuthTag(Buffer.from(envelope.tag,"base64url"))
 const phoneSecret=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,"base64url")),decipher.final()]).toString("utf8")
 key.fill(0);shared.fill(0)
 const secretRow=await pool.query(
  "select encrypted_secret,status from pashloc_mfa_enrollments where tenant_id=$1 and app_user_id=$2",
  [tenantId,userId])
 assert.equal(secretRow.rows[0].status,"pending")
 const isolatedSecret=decryptPashLocSecret(secretRow.rows[0].encrypted_secret,Number(tenantId),Number(userId))
 assert.equal(isolatedSecret,phoneSecret,"phone envelope seed must equal encrypted Navigator seed")
 assert.ok(!secretRow.rows[0].encrypted_secret.includes(Buffer.from(isolatedSecret)))
 const nowStep=Math.floor(Date.now()/30000)
 const badFirst=await confirmPashLocFirstCode({
  challengeId:st.challenge_id,pairingId:st.pairing_ref,
  claimantToken:claim.claimant_proof,code:"000000"
 })
 assert.equal(badFirst,null,"incorrect first TOTP must not activate")
 const firstCode=pashLocTotpAtStep(phoneSecret,nowStep-1)
 const confirmed=await confirmPashLocFirstCode({
  challengeId:st.challenge_id,pairingId:st.pairing_ref,
  claimantToken:claim.claimant_proof,code:firstCode
 })
 assert.equal(confirmed?.accountId,"synthetic_"+String(persisted.rows[0].id),"first valid TOTP activates same account")
 const duplicate=await confirmPashLocFirstCode({
  challengeId:st.challenge_id,pairingId:st.pairing_ref,
  claimantToken:claim.claimant_proof,code:firstCode
 })
 assert.equal(duplicate,null,"duplicate activation must fail")
 const loginStarted=await post("/auth/mfa/login/start",{
  tenant_slug:"isolated-tenant",email:"isolated@example.test",password:"Disposable-Test-Password!9"
 },browserHeaders)
 assert.equal(loginStarted.statusCode,200,loginStarted.body)
 const loginData=loginStarted.json()
 assert.equal(loginData.requires_mfa,true)
 const loginCookie=String(loginStarted.headers["set-cookie"]).split(";")[0]
 const loginHeaders={...browserHeaders,cookie:loginCookie,"x-pashloc-csrf":loginData.csrf_token}
 const invalidCsrf=await post("/auth/mfa/login/verify",{
  challenge_id:loginData.challenge_id,code:firstCode
 },{...loginHeaders,"x-pashloc-csrf":"wrong"})
 assert.equal(invalidCsrf.statusCode,403,"incorrect CSRF must be denied")
 const otpReplayResponse=await post("/auth/mfa/login/verify",{
  challenge_id:loginData.challenge_id,code:firstCode
 },loginHeaders)
 assert.equal(otpReplayResponse.statusCode,401,"already accepted enrollment step must not verify login")
 const verifiedResponse=await post("/auth/mfa/login/verify",{
  challenge_id:loginData.challenge_id,code:pashLocTotpAtStep(phoneSecret,nowStep)
 },loginHeaders)
 assert.equal(verifiedResponse.statusCode,200,verifiedResponse.body)
 assert.equal(verifiedResponse.json().mfa_verified,true)
 assert.equal(verifiedResponse.json().session_issued,false,"isolated MFA must not issue Navigator JWT")
 const reusedResponse=await post("/auth/mfa/login/verify",{
  challenge_id:loginData.challenge_id,code:firstCode
 },loginHeaders)
 assert.equal(reusedResponse.statusCode,403,"consumed login challenge must not be reusable")
 const badLogin=await post("/auth/mfa/login/start",{
  tenant_slug:"isolated-tenant",email:"isolated@example.test",password:"incorrect-password"
 },browserHeaders)
 assert.equal(badLogin.statusCode,401)
 console.log("PASS: disposable encrypted TOTP custody; wrong first code rejected; first valid activation; duplicate rejected; returning login challenge; TOTP replay rejection; consumed challenge rejection")
 console.log("PASS: disposable PostgreSQL migration; password-scoped enrollment; signed device claim; wrong approval; original browser approval; signed synthetic redemption; wrong signer; replay rejection; fresh same-device retry; concurrent same-nonce serialization; immutable envelope; cross-tenant denial")
} finally {
 await app.close()
 await pool.end()
}
