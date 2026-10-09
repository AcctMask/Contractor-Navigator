import { createHash, randomBytes } from "node:crypto"

export const WORKFORCE_INVITATION_HOURS = 48

export function hashWorkforceInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function createWorkforceInvitationToken() {
  const token = randomBytes(32).toString("hex")
  const tokenHash = hashWorkforceInvitationToken(token)
  const expiresAt = new Date(
    Date.now() + WORKFORCE_INVITATION_HOURS * 60 * 60 * 1000
  )

  return { token, tokenHash, expiresAt }
}
