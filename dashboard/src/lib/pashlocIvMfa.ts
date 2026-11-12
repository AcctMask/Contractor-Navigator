/**
 * PashLoc IV MFA account-launch URL builder for the Navigator login UI.
 * The QR renderer must encode this URL, not request the desktop camera.
 * Enrollment uses a server-issued opaque pairing reference; NEVER put
 * the TOTP secret or the password in a QR URL.
 */
export const PASHLOC_IV_MFA_APP_ORIGIN = "https://pashloc-c8kqd3okl-secure-purchase.vercel.app"

export function pashLocReturningAccountUrl(accountId: string): string {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(accountId)) {
    throw new Error("Invalid PashLoc account identifier")
  }
  const url = new URL(PASHLOC_IV_MFA_APP_ORIGIN)
  url.searchParams.set("type", "open")
  url.searchParams.set("issuer", "Navigator")
  url.searchParams.set("account", accountId)
  return url.toString()
}

export function pashLocEnrollmentPairingUrl(pairingId: string): string {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(pairingId)) {
    throw new Error("Invalid enrollment pairing reference")
  }
  const url = new URL(PASHLOC_IV_MFA_APP_ORIGIN)
  url.searchParams.set("type", "enroll")
  url.searchParams.set("issuer", "Navigator")
  url.searchParams.set("pairing", pairingId)
  return url.toString()
}
