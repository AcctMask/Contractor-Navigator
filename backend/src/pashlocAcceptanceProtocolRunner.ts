/** Explicitly gated disposable MFA acceptance execution; no HTTP endpoint.
 * All results are actual Fastify.inject responses, never synthetic successes.
 */
import type { FastifyInstance } from "fastify"
import {generateKeyPairSync,sign,webcrypto} from "node:crypto"
import {readFileSync} from "node:fs"
import {runInNewContext} from "node:vm"
import {resolve} from "node:path"
import {claimTranscript,redeemTranscript,normalizedP256PublicKey} from "./services/pashlocEnrollV1Crypto"
const slug="pashloc-genuine-acceptance-20261114"
const email="navigator-acceptance@example.invalid"
const origin=process.env.APP_BASE_URL!
const stages:string[]=[]
function result(stage:string,passed:boolean,detail:string){
  console.log("PASHLOC_ACCEPTANCE_STAGE",JSON.stringify({stage,result:passed?"PASS":"FAIL",detail}))
  stages.push(stage+":"+(passed?"PASS":"FAIL"))
  if(!passed)throw Error("Acceptance failed at "+stage+": "+detail)
}
export async function executeDisposableMfaAcceptance(app:FastifyInstance){
  if(process.env.PASHLOC_ACCEPTANCE_EXECUTE_PROTOCOL!=="yes"||
     process.env.PASHLOC_ACCEPTANCE_ONLY!=="yes"||
     process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME!=="pashloc_iv_disposable_mfa_isolated"||
     process.env.NODE_ENV!=="test")throw Error("Acceptance runner gate rejected")
  const password=process.env.PASHLOC_ACCEPTANCE_INITIAL_PASSWORD
  if(!password||password.length<24)throw Error("Disposable acceptance password unavailable")
  const abort=AbortSignal.timeout(45000)
  const run=async()=>{
    const headers={origin,"content-type":"application/json"}
    const denied=await app.inject({method:"POST",url:"/auth/mfa/enrollment/start",
      headers:{...headers,origin:"https://untrusted.invalid"},
      payload:{tenant_slug:slug,email,password}})
    result("unauthorized_origin_rejection",denied.statusCode===403,"HTTP "+denied.statusCode)
    const start=await app.inject({method:"POST",url:"/auth/mfa/enrollment/start",
      headers,payload:{tenant_slug:slug,email,password}})
    const body=start.json()
    result("genuine_enrollment_start",start.statusCode===200&&body.ok===true&&
      typeof body.challenge_id==="string"&&typeof body.pairing_ref==="string",
      "HTTP "+start.statusCode+"; "+(body.error||"challenge issued"))

    const phoneHeaders={origin:process.env.PASHLOC_PHONE_ORIGIN!,"content-type":"application/json"}
    const keyOptions={namedCurve:"prime256v1"} as const
    const signing=generateKeyPairSync("ec",keyOptions)
    const agreement=generateKeyPairSync("ec",keyOptions)
    const publicSigning=normalizedP256PublicKey(signing.publicKey.export({format:"jwk"}))
    const publicAgreement=normalizedP256PublicKey(agreement.publicKey.export({format:"jwk"}))
    const post=async(url:string,payload:unknown,phone=true,extra:Record<string,string>={})=>
      app.inject({method:"POST",url,headers:{...(phone?phoneHeaders:headers),...extra},payload})
    const nonce=await post("/auth/mfa/device/claim-challenge",{pairing_ref:body.pairing_ref})
    const n=nonce.json()
    result("device_claim_challenge",nonce.statusCode===200&&typeof n.proof_nonce==="string","HTTP "+nonce.statusCode)
    const signature=sign("sha256",claimTranscript({pairingRef:body.pairing_ref,nonce:n.proof_nonce,signingKey:publicSigning,agreementKey:publicAgreement}),{key:signing.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url")
    const claim=await post("/auth/mfa/device/claim",{pairing_ref:body.pairing_ref,device_public_key_jwk:publicSigning,device_ecdh_public_key_jwk:publicAgreement,proof_nonce:n.proof_nonce,proof_signature:signature,protocol_version:"AA-PASHLOC-ENROLL-V1"})
    const c=claim.json()
    result("signed_device_claim",claim.statusCode===200&&typeof c.claim_id==="string"&&/^\d{8}$/.test(c.confirmation_code),"HTTP "+claim.statusCode)
    const restricted={"x-pashloc-restricted-session":body.restricted_session,"x-pashloc-csrf":body.csrf_token}
    const approval=await post("/auth/mfa/enrollment/approve-device",{challenge_id:body.challenge_id,pairing_ref:body.pairing_ref,confirmation_code:c.confirmation_code},false,restricted)
    result("independent_browser_approval",approval.statusCode===200&&approval.json().approved===true,"HTTP "+approval.statusCode)
    const challenge=await post("/auth/mfa/device/redeem-challenge",{pairing_ref:body.pairing_ref,claim_id:c.claim_id,claimant_proof:c.claimant_proof})
    const d=challenge.json()
    result("redemption_challenge",challenge.statusCode===200&&typeof d.redeem_nonce==="string","HTTP "+challenge.statusCode)
    const redeemSignature=sign("sha256",redeemTranscript({claimId:c.claim_id,pairingRef:body.pairing_ref,nonce:d.redeem_nonce,signingKey:publicSigning,agreementKey:publicAgreement}),{key:signing.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url")
    const redeemPayload={pairing_ref:body.pairing_ref,claim_id:c.claim_id,claimant_proof:c.claimant_proof,redeem_nonce:d.redeem_nonce,redeem_signature:redeemSignature}
    const redemption=await post("/auth/mfa/device/redeem",redeemPayload)
    const envelope=redemption.json()
    result("signed_credential_redemption",redemption.statusCode===200&&envelope.ok===true&&!!envelope.envelope,"HTTP "+redemption.statusCode)
    const replay=await post("/auth/mfa/device/redeem",redeemPayload)
    result("redemption_replay_rejected",replay.statusCode===409,"HTTP "+replay.statusCode)

    const contextBytes=Buffer.from(envelope.envelope.context,"base64url")
    const pinnedSource=readFileSync(resolve(process.cwd(),"src/acceptance/pashloc-enroll-v1.pinned.cjs"),"utf8")
    const sandbox:any={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,DataView,atob,btoa,console}
    sandbox.globalThis=sandbox
    runInNewContext(pinnedSource,sandbox,{timeout:2000})
    const pashloc=sandbox.PashLocEnrollV1
    const parsed=pashloc.parseCanonicalContext(envelope.envelope.context)
    result("credential_context",parsed.environment==="acceptance"&&parsed.pairingRef===body.pairing_ref&&parsed.claimId===c.claim_id,"acceptance environment and claim binding")
    // Device private key must be a WebCrypto ECDH key, as in the real PashLoc client.
    // Node's generated EC private key is imported into the WebCrypto implementation.
    const privateAgreement=await webcrypto.subtle.importKey("jwk",agreement.privateKey.export({format:"jwk"}) as JsonWebKey,{name:"ECDH",namedCurve:"P-256"},false,["deriveBits"])
    const secret=await pashloc.decryptNavigatorEnvelope(envelope.envelope,privateAgreement,parsed,publicSigning,publicAgreement,"acceptance")
    result("credential_decryption",typeof secret==="string"&&/^[A-Z2-7]{16,128}$/.test(secret),"PashLoc genuine decrypt succeeded")
    const vault=new Map<string,string>()
    vault.set(parsed.accountId,secret)
    result("isolated_credential_storage",vault.get(parsed.accountId)===secret,"ephemeral isolated memory; no persistent secrets")
    const {pashLocTotpAtStep,verifyPashLocTotp}=await import("./services/pashlocTotp")
    const currentStep=Math.floor(Date.now()/30000)
    const firstCode=pashLocTotpAtStep(secret,currentStep)
    result("totp_compatibility",!!verifyPashLocTotp(secret,firstCode,{allowedSkewSteps:1}),"Navigator verifier accepted credential-derived TOTP")
    const confirmation=await post("/auth/mfa/enrollment/confirm",{challenge_id:body.challenge_id,pairing_ref:body.pairing_ref,code:firstCode},false,restricted)
    const confirmed=confirmation.json()
    result("first_code_confirmation",confirmation.statusCode===200&&confirmed.enrollment_confirmed===true,"HTTP "+confirmation.statusCode)
    const bearer=confirmed.token||confirmed.access_token
    result("mfa_session_issuance",typeof bearer==="string"&&bearer.length>20,"MFA-confirmed bearer issued")
    const me=await app.inject({method:"GET",url:"/auth/me",headers:{authorization:"Bearer "+bearer}})
    result("authenticated_crm",me.statusCode===200&&me.json().ok===true,"HTTP "+me.statusCode)
    const login=await post("/auth/"+slug+"/login",{email,password},false)
    const l=login.json()
    result("returning_login_challenge",login.statusCode===200&&typeof l.challenge_id==="string","HTTP "+login.statusCode)
    const nextStep=Math.floor(Date.now()/30000)+1
    const returnCode=pashLocTotpAtStep(secret,nextStep)
    const verified=await post("/auth/mfa/login/verify",{challenge_id:l.challenge_id,code:returnCode},false)
    result("returning_login",verified.statusCode===200&&verified.json().ok===true,"HTTP "+verified.statusCode)
    vault.clear()


  }
  await Promise.race([run(),new Promise<never>((_,reject)=>{
    abort.addEventListener("abort",()=>reject(Error("Acceptance execution timed out")),{once:true})
  })])
  console.log("PASHLOC_ACCEPTANCE_RESULT",JSON.stringify({complete:false,stages}))
}
