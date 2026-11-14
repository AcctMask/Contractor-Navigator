import test from "node:test"
import assert from "node:assert/strict"
import { randomBytes, generateKeyPairSync } from "node:crypto"
import { encodeCanonicalContext, encryptSyntheticEnrollmentV1, encryptNavigatorCredentialV1, publicKeyFingerprint } from "../src/services/pashlocEnrollV1Crypto"

test("production context can be represented but synthetic delivery remains forbidden",()=>{
 const sign=generateKeyPairSync("ec",{namedCurve:"prime256v1"}).publicKey.export({format:"jwk"})
 const agree=generateKeyPairSync("ec",{namedCurve:"prime256v1"}).publicKey.export({format:"jwk"})
 const token=()=>randomBytes(32).toString("base64url")
 const context={version:"AA-PASHLOC-ENROLL-V1",environment:"production",application:"Navigator",tenantId:"1",userId:"2",accountId:token().slice(0,32),pairingRef:token(),claimId:token(),signingFingerprint:publicKeyFingerprint(sign),agreementFingerprint:publicKeyFingerprint(agree),redeemNonce:token(),approvalId:token().slice(0,32)}
 assert.ok(encodeCanonicalContext(context).length>0)
 assert.throws(()=>encryptSyntheticEnrollmentV1({syntheticSecret:"A".repeat(32),deviceEcdhPublicJwk:agree,context}),/forbidden in genuine credential contexts/)
 const envelope=encryptNavigatorCredentialV1({secret:"A".repeat(32),deviceEcdhPublicJwk:agree,context})
 const acceptance={...context,environment:"acceptance"}
 assert.ok(encodeCanonicalContext(acceptance).length>0)
 assert.throws(()=>encryptSyntheticEnrollmentV1({syntheticSecret:"A".repeat(32),deviceEcdhPublicJwk:agree,context:acceptance}),/forbidden in genuine credential contexts/)
 const acceptanceEnvelope=encryptNavigatorCredentialV1({secret:"A".repeat(32),deviceEcdhPublicJwk:agree,context:acceptance})
 assert.equal(acceptanceEnvelope.version,"AA-PASHLOC-ENROLL-V1")
 assert.ok(acceptanceEnvelope.ciphertext.length>0)
 assert.equal(envelope.version,"AA-PASHLOC-ENROLL-V1")
 assert.ok(envelope.ciphertext.length>0)
 assert.throws(()=>encryptNavigatorCredentialV1({secret:"A".repeat(32),deviceEcdhPublicJwk:agree,context:{...context,environment:"isolated"}}),/authorized genuine context/)
})
