/**
 * PashLoc IV MFA — isolated RFC 6238 verification regression checks.
 * Run from backend: npx tsx --test scripts/testPashlocTotp.ts
 * No database, secrets, deployment or Navigator login required.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  decodePashLocBase32, encodePashLocBase32, generatePashLocTotpSecret,
  pashLocTotpAtStep, verifyPashLocTotp
} from "../src/services/pashlocTotp"

// RFC 6238 Appendix B SHA-1 reference key (ASCII 12345678901234567890).
const secret = encodePashLocBase32(Buffer.from("12345678901234567890", "ascii"))

test("RFC 6238 SHA1 reference values truncated to six digits", () => {
  const cases: Array<[number, string]> = [
    [59, "287082"], [1111111109, "081804"], [1111111111, "050471"],
    [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]
  ]
  for (const [seconds, expected] of cases) {
    assert.equal(pashLocTotpAtStep(secret, Math.floor(seconds / 30)), expected)
  }
})

test("Base32 roundtrip and invalid padding bits", () => {
  const raw = Buffer.from("PashLoc IV MFA")
  assert.deepEqual(decodePashLocBase32(encodePashLocBase32(raw)), raw)
  assert.throws(() => decodePashLocBase32("AB"), /padding bits/)
})

test("random enrollment secrets have 160 bits", () => {
  const a = generatePashLocTotpSecret()
  const b = generatePashLocTotpSecret()
  assert.equal(decodePashLocBase32(a).length, 20)
  assert.notEqual(a, b)
})

test("TOTP verification rejects replayed steps and malformed input", () => {
  const nowMs = 59_000
  const code = pashLocTotpAtStep(secret, 1)
  assert.deepEqual(verifyPashLocTotp(secret, code, { nowMs }), { acceptedStep: 1 })
  assert.equal(verifyPashLocTotp(secret, code, { nowMs, lastAcceptedStep: 1 }), null)
  assert.equal(verifyPashLocTotp(secret, "12345", { nowMs }), null)
  assert.equal(verifyPashLocTotp(secret, "abcdef", { nowMs }), null)
})

test("clock tolerance is bounded to one step", () => {
  const nowMs = 90_000
  assert.deepEqual(verifyPashLocTotp(secret, pashLocTotpAtStep(secret, 2), { nowMs }), { acceptedStep: 2 })
  assert.equal(verifyPashLocTotp(secret, pashLocTotpAtStep(secret, 1), { nowMs }), null)
  assert.throws(() => verifyPashLocTotp(secret, "000000", { allowedSkewSteps: 2 }), /skew/)
})
