import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { pool } from "../src/db/db"
import { createPashLocLoginChallenge, reservePashLocChallengeAttempt } from "../src/services/pashlocChallenge"
import { createPashLocPairing } from "../src/services/pashlocPairing"

test("isolated database enrollment challenge and pairing lifecycle",async()=>{
  const tenant=await pool.query("insert into tenants default values returning id")
  const tenantId=Number(tenant.rows[0].id)
  const user=await pool.query("insert into app_users(tenant_id) values ($1) returning id,pashloc_mfa_required",[tenantId])
  const userId=Number(user.rows[0].id)
  assert.equal(user.rows[0].pashloc_mfa_required,false)
  const challenge=await createPashLocLoginChallenge({tenantId,userId,purpose:"enroll"})
  assert.match(challenge.challengeId,/^[A-Za-z0-9_-]{43}$/)
  const pairing=await createPashLocPairing({challengeId:challenge.challengeId,tenantId,userId})
  assert.match(pairing.pairingId,/^[A-Za-z0-9_-]{43}$/)
  const rows=await pool.query("select c.purpose,p.pairing_hash,p.expires_at <= c.expires_at as bounded from pashloc_mfa_pairings p join pashloc_mfa_challenges c on c.id=p.challenge_id where c.challenge_hash=$1",[createHash("sha256").update(challenge.challengeId).digest("hex")])
  assert.equal(rows.rowCount,1)
  assert.equal(rows.rows[0].purpose,"enroll")
  assert.equal(rows.rows[0].bounded,true)
  assert.equal(rows.rows[0].pairing_hash,createHash("sha256").update(pairing.pairingId).digest("hex"))
  for(let i=0;i<5;i++)assert.ok(await reservePashLocChallengeAttempt(challenge.challengeId))
  assert.equal(await reservePashLocChallengeAttempt(challenge.challengeId),null)
  await assert.rejects(createPashLocPairing({challengeId:challenge.challengeId,tenantId,userId}))
})
test.after(async()=>{await pool.end()})
