/**
 * SMS delivery safety policy. Does not alter Developer Settings sequence timing.
 * Consecutive failures apply to a single unsent step, reset on a successful send.
 */
export const SMS_RETRY_POLICY_VERSION = "navigator_sms_v1"
export const MAX_CONSECUTIVE_SMS_FAILURES = 3
export const RETRY_BACKOFF_MS = [5 * 60_000, 15 * 60_000] as const

export const PERMANENT_TWILIO_ERROR_CODES = new Set([
  21211, 21265, 21266, 21268, 21610,
])

export function getTwilioErrorCode(error: any): number | null {
  const raw = error?.code
  if (raw === null || raw === undefined || String(raw).trim() === "") return null
  const code = Number(raw)
  return Number.isInteger(code) && code > 0 ? code : null
}

export function isPermanentTwilioDeliveryFailure(error: any): boolean {
  const code = getTwilioErrorCode(error)
  return code !== null && PERMANENT_TWILIO_ERROR_CODES.has(code)
}

export function isSmsRetryExhausted(failureCount: number): boolean {
  return failureCount >= MAX_CONSECUTIVE_SMS_FAILURES
}

export function getSmsRetryCooldownMs(failureCount: number): number {
  if (failureCount <= 0 || isSmsRetryExhausted(failureCount)) return 0
  return RETRY_BACKOFF_MS[Math.min(failureCount - 1, RETRY_BACKOFF_MS.length - 1)]
}
