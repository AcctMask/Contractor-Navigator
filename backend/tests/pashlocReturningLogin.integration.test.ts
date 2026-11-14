import test from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { pool } from "../src/db/db"
import { createPashLocLoginChallenge } from "../src/services/pashlocChallenge"
import { encryptPashLocSecret } from "../src/services/pashlocSecretCrypto"
import { generatePashLocTotpSecret, pashLocTotpAtStep } from "../src/services/pashlocTotp"
import { verifyPashLocReturningLogin } from "../src/services/pashlocVerifyLogin"

test("returning login consumes a valid challenge and prevents TOTP replay across fresh challenges",async()=>{
 const tenantId=Number((await pool.query("insert into tenants default values returning id")).rows[0].id)
 const userId=Number((await pool.query("insert into app_users(tenant_id,pashloc_mfa_required,pashloc_mfa_activated_at) values($1,true,now()) returning id",[tenantId])).rows[0].id)
 const secret=generatePashLocTotpSecret()
 const accountId=randomBytes(24).toString("base64url")
 const pairingChallenge=await createPashLocLoginChallenge({tenantId,userId,purpose:"enroll"})
 const pairing=await pool.query("insert into pashloc_mfa_pairings(challenge_id,pairing_hash,expires_at) select id,$2,now()+interval '2 minutes' from pashloc_mfa_challenges where challenge_hash=$1 returning id",[await import("node:crypto").then(m=>m.createHash("sha256").update(pairingChallenge.challengeId).digest("hex")),randomBytes(32).toString("hex")])
 await pool.query("insert into pashloc_mfa_enrollments(tenant_id,app_user_id,account_id,encrypted_secret,encryption_key_version,status,delivery_pairing_id) values($1,$2,$3,$4,'navigator-account-v1','confirmed',$5)",[tenantId,userId,accountId,encryptPashLocSecret(secret,tenantId,userId,accountId),pairing.rows[0].id])
 const code=pashLocTotpAtStep(secret,Math.floor(Date.now()/30000))
 const first=await createPashLocLoginChallenge({tenantId,userId,purpose:"verify"})
 assert.deepEqual(await verifyPashLocReturningLogin(first.challengeId,code),{tenantId,userId})
 assert.equal(await verifyPashLocReturningLogin(first.challengeId,code),null,"challenge cannot be reused")
 const second=await createPashLocLoginChallenge({tenantId,userId,purpose:"verify"})
 assert.equal(await verifyPashLocReturningLogin(second.challengeId,code),null,"code cannot be replayed with a new challenge")
 const rows=await pool.query("select last_accepted_step from pashloc_mfa_enrollments where tenant_id=$1 and app_user_id=$2",[tenantId,userId])
 assert.ok(rows.rows[0].last_accepted_step!==null)
})
test.after(async()=>{await pool.end()})
