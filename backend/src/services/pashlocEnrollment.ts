/**
 * PashLoc IV MFA — isolated pending enrollment staging.
 * No endpoint calls this. No QR, phone or browser receives the secret here.
 * Requires the reviewed additive schema and dedicated encryption key.
 */
import { randomBytes } from "node:crypto"
import { pool } from "../db/db"
import { generatePashLocTotpSecret } from "./pashlocTotp"
import { encryptPashLocSecret } from "./pashlocSecretCrypto"

export async function stagePashLocEnrollment(input: {
  tenantId: number
  userId: number
}): Promise<{ accountId: string; status: "pending" }> {
  const { tenantId, userId } = input
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 ||
      !Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("Invalid MFA enrollment scope")
  }
  const secret = generatePashLocTotpSecret()
  const encrypted = encryptPashLocSecret(secret, tenantId, userId)
  const accountId = randomBytes(24).toString("base64url")
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    // Serialize competing enrollments for this user, including when no
    // enrollment row exists yet. Never replace an established authenticator.
    const user = await client.query(
      "select id from app_users where id=$1 and tenant_id=$2 and is_active=true for update",
      [userId, tenantId]
    )
    if (user.rowCount !== 1) throw new Error("Active user not found")
    const existing = await client.query(
      "select id from pashloc_mfa_enrollments where tenant_id=$1 and app_user_id=$2",
      [tenantId, userId]
    )
    if (existing.rowCount) {
      throw new Error("MFA enrollment already exists; audited recovery required")
    }
    await client.query(
      `insert into pashloc_mfa_enrollments
       (tenant_id,app_user_id,account_id,encrypted_secret,encryption_key_version,status)
       values ($1,$2,$3,$4,'v1','pending')`,
      [tenantId, userId, accountId, encrypted]
    )
    await client.query("COMMIT")
    return { accountId, status: "pending" }
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
