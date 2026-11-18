import test from "node:test"
import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import { pool } from "../src/db/db"
import { createPashLocLoginChallenge } from "../src/services/pashlocChallenge"
import { createPashLocPairing } from "../src/services/pashlocPairing"
import { issuePashLocDeviceClaimNonce } from "../src/services/pashlocDeviceClaimChallenge"
import { claimPashLocDevice } from "../src/services/pashlocDeviceClaimV2"
import { approvePashLocDeviceClaim } from "../src/services/pashlocDeviceApprovalV2"
import { issuePashLocNavigatorRedeemNonce } from "../src/services/pashlocNavigatorRedeemNonceV1"
import { claimTranscript } from "../src/services/pashlocEnrollV1Crypto"

test("expired unused redemption nonce can be replaced without bypassing device approval", async () => {
 const tenantId=Number((await pool.query("insert into tenants default values returning id")).rows[0].id)
 const userId=Number((await pool.query("insert into app_users(tenant_id) values($1) returning id",[tenantId])).rows[0].id)
 const challenge=await createPashLocLoginChallenge({tenantId,userId,purpose:"enroll"})
 const pairing=await createPashLocPairing({challengeId:challenge.challengeId,tenantId,userId})
 const signing=generateKeyPairSync("ec",{namedCurve:"prime256v1"})
 const agreement=generateKeyPairSync("ec",{namedCurve:"prime256v1"})
 const device_public_key_jwk=signing.publicKey.export({format:"jwk"}) as any
 const device_ecdh_public_key_jwk=agreement.publicKey.export({format:"jwk"}) as any
 const nonce=await issuePashLocDeviceClaimNonce(pairing.pairingId)
 assert.ok(nonce)
 const transcript=claimTranscript({pairingRef:pairing.pairingId,nonce:nonce!,signingKey:device_public_key_jwk,agreementKey:device_ecdh_public_key_jwk})
 const proof_signature=sign("sha256",transcript,{key:signing.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url")
 const claimed=await claimPashLocDevice({pairing_ref:pairing.pairingId,proof_nonce:nonce!,device_public_key_jwk,device_ecdh_public_key_jwk,proof_signature,protocol_version:"AA-PASHLOC-ENROLL-V1"})
 assert.ok(claimed)
 const args={claimId:claimed!.claim_id,pairingRef:pairing.pairingId,claimantProof:claimed!.claimant_proof}
 assert.equal(await issuePashLocNavigatorRedeemNonce(args),null,"unapproved phone cannot redeem")
 const approval=await approvePashLocDeviceClaim({challengeId:challenge.challengeId,pairingRef:pairing.pairingId,confirmationCode:claimed!.confirmation_code,tenantId,userId})
 assert.equal(approval.approved,true)
 const first=await issuePashLocNavigatorRedeemNonce(args)
 assert.ok(first)
 assert.equal(await issuePashLocNavigatorRedeemNonce(args),null,"unexpired nonce cannot be replaced")
 await pool.query("update pashloc_mfa_pairings set redemption_nonce_expires_at=now()-interval '1 second' where pairing_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",[pairing.pairingId])
 const second=await issuePashLocNavigatorRedeemNonce(args)
 assert.ok(second,"expired nonce can be replaced within pairing lifetime")
 assert.notEqual(second!.redeem_nonce,first!.redeem_nonce)
})
test.after(async()=>{await pool.end()})
