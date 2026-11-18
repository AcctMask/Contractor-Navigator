import { test } from "node:test"
import { strict as assert } from "node:assert"
import { generateKeyPairSync, sign, randomBytes } from "node:crypto"
import { canonicalSignedApproval, verifySignedApproval, type SignedApprovalContext } from "../src/services/pashlocSignedApprovalV1"

test("registered P-256 signature is bound to browser, user, tenant, challenge and approval", () => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const publicJwk = keys.publicKey.export({ format: "jwk" })
  const context: SignedApprovalContext = {
    version: "AA-PASHLOC-LOGIN-V1", environment: "acceptance",
    tenantId: 3, userId: 19,
    deviceId: randomBytes(32).toString("base64url"),
    challengeId: randomBytes(32).toString("base64url"),
    browserSessionHash: randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    decision: "approve"
  }
  const signature = sign("sha256", canonicalSignedApproval(context),
    { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")
  const expected = { ...context }
  assert.equal(verifySignedApproval({context,registeredPublicJwk:publicJwk,signature,expected}),true)
  for (const field of ["tenantId","userId","deviceId","challengeId","browserSessionHash","expiresAt"] as const) {
    const wrong = { ...expected, [field]: field === "tenantId" || field === "userId"
      ? 999 : field === "expiresAt" ? new Date(Date.now()+90000).toISOString()
      : field === "browserSessionHash" ? randomBytes(32).toString("hex")
      : randomBytes(32).toString("base64url") }
    assert.equal(verifySignedApproval({context,registeredPublicJwk:publicJwk,signature,expected:wrong}),false,field)
  }
  assert.equal(verifySignedApproval({context:{...context,decision:"deny"},registeredPublicJwk:publicJwk,signature,expected}),false)
  assert.equal(verifySignedApproval({context,registeredPublicJwk:publicJwk,signature,expected,now:Date.parse(context.expiresAt)+1}),false)
  const otherKeys = generateKeyPairSync("ec",{namedCurve:"prime256v1"})
  assert.equal(verifySignedApproval({context,registeredPublicJwk:otherKeys.publicKey.export({format:"jwk"}),signature,expected}),false)
  assert.equal(verifySignedApproval({context,registeredPublicJwk:{...publicJwk,d:"secret"},signature,expected}),false)
})
