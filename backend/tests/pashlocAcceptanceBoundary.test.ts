import test from "node:test"
import assert from "node:assert/strict"
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/pashloc_acceptance_disposable"
const { assertMfaAcceptanceEnvironment } = await import("../src/pashlocAcceptanceServer")

const valid = {
 PASHLOC_ACCEPTANCE_ONLY:"yes",
 PASHLOC_ACCEPTANCE_DATABASE_CONFIRMED:"yes",
 NODE_ENV:"development",
 DATABASE_URL:"postgresql://acceptance@disposable.internal/pashloc_acceptance_disposable",
 PASHLOC_ACCEPTANCE_DATABASE_NAME:"pashloc_acceptance_disposable",
 PASHLOC_NAVIGATOR_ENROLLMENT_ENABLED:"yes",
 PASHLOC_PHONE_CLAIM_ENABLED:"yes",
 PASHLOC_SHARED_RATE_LIMITS_VERIFIED:"yes",
 APP_BASE_URL:"https://navigator-acceptance.example.test",
 PASHLOC_PHONE_ORIGIN:"https://phone-acceptance.example.test"
} satisfies NodeJS.ProcessEnv

test("acceptance server rejects missing security controls and production databases",()=>{
 assert.doesNotThrow(()=>assertMfaAcceptanceEnvironment(valid))
 for(const key of ["PASHLOC_ACCEPTANCE_ONLY","PASHLOC_ACCEPTANCE_DATABASE_CONFIRMED",
  "PASHLOC_ACCEPTANCE_DATABASE_NAME","PASHLOC_NAVIGATOR_ENROLLMENT_ENABLED",
  "PASHLOC_PHONE_CLAIM_ENABLED","PASHLOC_SHARED_RATE_LIMITS_VERIFIED",
  "APP_BASE_URL","PASHLOC_PHONE_ORIGIN"] as const) {
   assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,[key]:""}),key)
 }
 for (const badOrigin of [
  "http://navigator-acceptance.example.test",
  "https://navigator-acceptance.example.test/path",
  "https://navigator-acceptance.example.test?mode=unsafe",
  "https://user:password@navigator-acceptance.example.test",
  "https://navigator-acceptance.example.test/#fragment"
 ]) {
  assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,APP_BASE_URL:badOrigin}),badOrigin)
 }
 // Exact origin comparison rejects prefix tricks at request time; a configured
 // syntactically valid hostname is not inherently invalid without a fixed allowlist.
 assert.doesNotThrow(()=>assertMfaAcceptanceEnvironment({...valid,APP_BASE_URL:"https://navigator-acceptance.example.test.evil.invalid"}))
 assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,PASHLOC_PHONE_ORIGIN:valid.APP_BASE_URL}))
 assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,NODE_ENV:"production"}))
 assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,DATABASE_URL:"postgresql://acceptance@prod.internal/navigator"}))
 assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,DATABASE_URL:"postgresql://acceptance@prod.internal/pashloc_acceptance_disposable_backup"}))
 assert.throws(()=>assertMfaAcceptanceEnvironment({...valid,DATABASE_URL:"postgresql://acceptance@prod.internal/pashloc_acceptance_disposable",PASHLOC_ACCEPTANCE_DATABASE_NAME:"navigator"}))
})
