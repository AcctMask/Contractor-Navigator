/**
 * PashLoc IV MFA deep links for Navigator.
 * PashLoc IV MFA's existing acceptLink() reads the "mode" parameter,
 * NOT "type". Do not change that contract without updating both apps.
 *
 * Returning-user QR opens the already-enrolled phone account.
 * Enrollment QR only routes to a pending flow: PashLoc IV MFA currently
 * rejects enrollment until a separately approved redemption protocol exists.
 * No secret, password, JWT, or browser challenge belongs in a QR URL.
 */
export const PASHLOC_IV_MFA_APP_ORIGIN = "https://pashloc-c8kqd3okl-secure-purchase.vercel.app"

export function pashLocReturningAccountUrl(accountId: string): string {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(accountId)) {
    throw new Error("Invalid PashLoc account identifier")
  }
  const url = new URL(PASHLOC_IV_MFA_APP_ORIGIN)
  url.searchParams.set("mode", "open")
  url.searchParams.set("issuer", "Navigator")
  url.searchParams.set("account", accountId)
  return url.toString()
}

export function pashLocEnrollmentPairingUrl(pairingId: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(pairingId)) {
    throw new Error("Invalid enrollment pairing reference")
  }
  const url = new URL(PASHLOC_IV_MFA_APP_ORIGIN)
  url.searchParams.set("mode", "enroll")
  url.searchParams.set("issuer", "Navigator")
  url.searchParams.set("pairing", pairingId)
  return url.toString()
}
