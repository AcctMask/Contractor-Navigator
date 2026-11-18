/**
 * PashLoc IV MFA — isolated TOTP primitive.
 *
 * NOT connected to Navigator authentication. No MFA enforcement, token issuance,
 * enrollment, QR exchange, database mutation, or production activation here.
 * A caller must enforce tenant/user binding, encrypted secret custody, attempt
 * limits, atomic replay prevention and challenge consumption transactionally.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
export const PASHLOC_TOTP_PERIOD_SECONDS = 30
export const PASHLOC_TOTP_DIGITS = 6

export function encodePashLocBase32(bytes: Buffer): string {
  let buffer = 0
  let bits = 0
  let result = ""
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      result += ALPHABET[(buffer >>> bits) & 31]
    }
  }
  if (bits > 0) result += ALPHABET[(buffer << (5 - bits)) & 31]
  return result
}

export function decodePashLocBase32(value: string): Buffer {
  const normalized = value.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase()
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error("Invalid Base32 TOTP secret")
  }
  let buffer = 0
  let bits = 0
  const bytes: number[] = []
  for (const char of normalized) {
    buffer = (buffer << 5) | ALPHABET.indexOf(char)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >>> bits) & 255)
      buffer &= (1 << bits) - 1
    }
  }
  if (bits > 0 && buffer !== 0) {
    throw new Error("Invalid Base32 padding bits")
  }
  return Buffer.from(bytes)
}

export function generatePashLocTotpSecret(): string {
  return encodePashLocBase32(randomBytes(20))
}

export function pashLocTotpAtStep(secret: string, step: number): string {
  if (!Number.isSafeInteger(step) || step < 0) throw new Error("Invalid TOTP step")
  const key = decodePashLocBase32(secret)
  if (key.length < 10) throw new Error("TOTP secret too short")
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac("sha1", key).update(counter).digest()
  const offset = digest[digest.length - 1] & 15
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(value).padStart(PASHLOC_TOTP_DIGITS, "0")
}

export type PashLocTotpMatch = { acceptedStep: number } | null

/**
 * Checks a bounded clock window and rejects a step already accepted.
 * The caller MUST atomically persist acceptedStep with the challenge
 * consumption; a read-then-write outside a transaction is replayable.
 */
export function verifyPashLocTotp(
  secret: string,
  suppliedCode: string,
  options: {
    nowMs?: number
    allowedSkewSteps?: number
    lastAcceptedStep?: number | null
  } = {},
): PashLocTotpMatch {
  if (!/^\d{6}$/.test(suppliedCode)) return null
  const nowMs = options.nowMs ?? Date.now()
  const skew = options.allowedSkewSteps ?? 1
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error("Invalid clock")
  if (!Number.isSafeInteger(skew) || skew < 0 || skew > 1) {
    throw new Error("Unsupported clock skew")
  }
  const currentStep = Math.floor(nowMs / (PASHLOC_TOTP_PERIOD_SECONDS * 1000))
  const lastStep = options.lastAcceptedStep ?? -1
  if (!Number.isSafeInteger(lastStep)) throw new Error("Invalid replay boundary")
  for (let step = currentStep - skew; step <= currentStep + skew; step++) {
    if (step < 0 || step <= lastStep) continue
    const expected = pashLocTotpAtStep(secret, step)
    if (timingSafeEqual(Buffer.from(suppliedCode), Buffer.from(expected))) {
      return { acceptedStep: step }
    }
  }
  return null
}
