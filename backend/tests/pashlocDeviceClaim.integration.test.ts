import test from "node:test"
import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import { pool } from "../src/db/db"
import { createPashLocLoginChallenge } from "../src/services/pashlocChallenge"
import { createPashLocPairing } from "../src/services/pashlocPairing"
import { issuePashLocDeviceClaimNonce } from "../src/services/pashlocDeviceClaimChallenge"
import { claimPashLocDevice } from "../src/services/pashlocDeviceClaimV2"
import { approvePashLocDeviceClaim } from "../src/services/pashlocDeviceApprovalV2"
import { claimTranscript } from "../src/services/pashlocEnrollV1Crypto"

test("signed phone claim is single-use and eight-digit approval is browser-bound",async()=>{
 const tenantId=Number((await pool.query("insert into tenants default values returning id")).rows[0].id)
 const userId=Number((await pool.query("insert into app_users(tenant_id) values($1) returning id",[tenantId])).rows[0].id)
 const challenge=await createPashLocLoginChallenge({tenantId,userId,purpose:"enroll"})
 const pairing=await createPashLocPairing({challengeId:challenge.challengeId,tenantId,userId})
 const proofNonce=await issuePashLocDeviceClaimNonce(pairing.pairingId)
 assert.ok(proofNonce)
 const signing=generateKeyPairSync("ec",{namedCurve:"prime256v1"})
 const agreement=generateKeyPairSync("ec",{namedCurve:"prime256v1"})
 const device_public_key_jwk=signing.publicKey.export({format:"jwk"}) as any
 const device_ecdh_public_key_jwk=agreement.publicKey.export({format:"jwk"}) as any
 const transcript=claimTranscript({pairingRef:pairing.pairingId,nonce:proofNonce!,signingKey:device_public_key_jwk,agreementKey:device_ecdh_public_key_jwk})
 const proof_signature=sign("sha256",transcript,{key:signing.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url")
 const request={pairing_ref:pairing.pairingId,proof_nonce:proofNonce!,device_public_key_jwk,device_ecdh_public_key_jwk,proof_signature,protocol_version:"AA-PASHLOC-ENROLL-V1" as const}
 const claimed=await claimPashLocDevice(request)
 assert.ok(claimed)
 assert.equal((await claimPashLocDevice(request)),null,"claim nonce must not replay")
 assert.deepEqual(await approvePashLocDeviceClaim({challengeId:challenge.challengeId,pairingRef:pairing.pairingId,confirmationCode:"not-a-code",tenantId,userId}),{approved:false})
 const wrong=claimed!.confirmation_code==="00000000"?"00000001":"00000000"
 assert.deepEqual(await approvePashLocDeviceClaim({challengeId:challenge.challengeId,pairingRef:pairing.pairingId,confirmationCode:wrong,tenantId,userId}),{approved:false})
 const approved=await approvePashLocDeviceClaim({challengeId:challenge.challengeId,pairingRef:pairing.pairingId,confirmationCode:claimed!.confirmation_code,tenantId,userId})
 assert.equal(approved.approved,true)
 assert.deepEqual(await approvePashLocDeviceClaim({challengeId:challenge.challengeId,pairingRef:pairing.pairingId,confirmationCode:claimed!.confirmation_code,tenantId,userId}),{approved:false},"approval must not replay")
})
test.after(async()=>{await pool.end()})
