/**
 * PashLoc IV MFA: restricted login challenge storage.
 * Isolated module only. No Navigator route imports this module yet.
 * Never use a challenge as a Navigator bearer token.
 */
import { createHash, randomBytes } from "node:crypto"
import { pool } from "../db/db"

const CHALLENGE_TTL_SECONDS = 300
const CHALLENGE_ATTEMPTS = 5

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export type PashLocChallengePurpose = "enroll" | "verify" | "recover"

export async function createPashLocLoginChallenge(input: {
  tenantId: number
  userId: number
  purpose: PashLocChallengePurpose
}): Promise<{ challengeId: string; expiresAt: string }> {
  if (!Number.isSafeInteger(input.tenantId) || input.tenantId <= 0 ||
      !Number.isSafeInteger(input.userId) || input.userId <= 0) {
    throw new Error("Invalid account scope")
  }
  const challengeId = randomBytes(32).toString("base64url")
  const result = await pool.query(
    `insert into pashloc_mfa_challenges
       (tenant_id, app_user_id, challenge_hash, purpose, expires_at, max_attempts)
     values ($1,$2,$3,$4,now() + ($5 * interval '1 second'),$6)
     returning expires_at`,
    [input.tenantId, input.userId, digest(challengeId), input.purpose,
      CHALLENGE_TTL_SECONDS, CHALLENGE_ATTEMPTS]
  )
  return { challengeId, expiresAt: new Date(result.rows[0].expires_at).toISOString() }
}

/**
 * Atomically reserves an attempt and returns challenge metadata, without
 * issuing a session. Caller must validate the OTP and atomically consume
 * challenge + update replay step in the SAME transaction.
 */
export async function reservePashLocChallengeAttempt(challengeId: string): Promise<{
  id: number
  tenantId: number
  userId: number
  purpose: PashLocChallengePurpose
} | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(challengeId)) return null
  const result = await pool.query(
    `update pashloc_mfa_challenges
       set attempts = attempts + 1
     where challenge_hash = $1 and consumed_at is null
       and expires_at > now() and attempts < max_attempts
     returning id, tenant_id, app_user_id, purpose`,
    [digest(challengeId)]
  )
  if (!result.rowCount) return null
  const row = result.rows[0]
  return {
    id: Number(row.id), tenantId: Number(row.tenant_id),
    userId: Number(row.app_user_id), purpose: row.purpose
  }
}

/**
 * Call only inside a transaction holding the challenge row lock and
 * after TOTP replay-state update succeeds. This standalone helper is
 * intentionally NOT an authorization primitive.
 */
export async function consumePashLocChallengeInTransaction(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rowCount: number | null }> },
  challengeRowId: number
): Promise<boolean> {
  const result = await client.query(
    `update pashloc_mfa_challenges
       set consumed_at = now()
     where id = $1 and consumed_at is null and expires_at > now()
     returning id`,
    [challengeRowId]
  )
  return result.rowCount === 1
}
