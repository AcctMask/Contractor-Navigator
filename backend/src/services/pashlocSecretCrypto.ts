/**
 * PashLoc IV MFA isolated cryptographic custody.
 * NOT wired to Navigator login. Requires dedicated 32-byte key in environment.
 * Never use JWT_SECRET or plaintext database secrets for TOTP storage.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

function loadKey(): Buffer {
  const raw = process.env.PASHLOC_MFA_ENCRYPTION_KEY_BASE64 || ""
  const key = Buffer.from(raw, "base64")
  if (key.length !== 32 || key.toString("base64") !== raw) {
    throw new Error("PashLoc MFA encryption key is missing or invalid")
  }
  return key
}

function scope(tenantId: number, userId: number, accountId?: string): Buffer {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 ||
      !Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid MFA account scope")
  if (accountId !== undefined) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(accountId)) throw new Error("Invalid isolated account ID")
    return Buffer.from(`pashloc-iv-mfa:isolated:Navigator:v1:${tenantId}:${userId}:${accountId}`, "utf8")
  }
  return Buffer.from(`pashloc-iv-mfa:v1:${tenantId}:${userId}`, "utf8")
}

export function encryptPashLocSecret(secret: string, tenantId: number, userId: number, accountId?: string): Buffer {
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", loadKey(), nonce)
  cipher.setAAD(scope(tenantId, userId, accountId))
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
}

export function decryptPashLocSecret(payload: Buffer, tenantId: number, userId: number, accountId?: string): string {
  if (!Buffer.isBuffer(payload) || payload.length < 29) throw new Error("Invalid encrypted MFA secret")
  const decipher = createDecipheriv("aes-256-gcm", loadKey(), payload.subarray(0, 12))
  decipher.setAAD(scope(tenantId, userId, accountId))
  decipher.setAuthTag(payload.subarray(12, 28))
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8")
}
