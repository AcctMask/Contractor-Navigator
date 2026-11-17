import test from "node:test"
import assert from "node:assert/strict"
import {encodePashLocBase32,decodePashLocBase32,pashLocTotpAtStep,verifyPashLocTotp,generatePashLocTotpSecret} from "../src/services/pashlocTotp"

test("Base32 roundtrip and generated secret",()=>{
 const secret=generatePashLocTotpSecret()
 assert.equal(decodePashLocBase32(secret).length,20)
 assert.equal(encodePashLocBase32(decodePashLocBase32(secret)),secret)
 assert.throws(()=>decodePashLocBase32("!!!!"))
})
test("RFC6238 SHA1 test vector at 59 seconds, truncated to six digits",()=>{
 const secret=encodePashLocBase32(Buffer.from("12345678901234567890"))
 assert.equal(pashLocTotpAtStep(secret,1),"287082")
 assert.deepEqual(verifyPashLocTotp(secret,"287082",{nowMs:59000,allowedSkewSteps:0}),{acceptedStep:1})
 assert.equal(verifyPashLocTotp(secret,"287082",{nowMs:59000,lastAcceptedStep:1}),null)
 assert.equal(verifyPashLocTotp(secret,"287082",{nowMs:59000,allowedSkewSteps:0,lastAcceptedStep:1}),null)
})
test("rejects malformed codes and excessive skew",()=>{
 const secret=generatePashLocTotpSecret()
 assert.equal(verifyPashLocTotp(secret,"12345"),null)
 assert.throws(()=>verifyPashLocTotp(secret,"123456",{allowedSkewSteps:2}))
})
