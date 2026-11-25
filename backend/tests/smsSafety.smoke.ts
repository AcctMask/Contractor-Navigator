import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  getTwilioErrorCode,
  isPermanentTwilioDeliveryFailure,
  getSmsRetryCooldownMs,
  isSmsRetryExhausted,
  SMS_RETRY_POLICY_VERSION,
} from "../src/services/smsDeliveryPolicy"

for (const code of [21211, 21265, 21266, 21268, 21610]) {
  assert.equal(isPermanentTwilioDeliveryFailure({ code }), true, String(code))
}
for (const code of [undefined, null, "", "oops", 30001, 500, 0]) {
  assert.equal(isPermanentTwilioDeliveryFailure({ code }), false, String(code))
}
assert.equal(getTwilioErrorCode({ code: "21610" }), 21610)
assert.equal(getTwilioErrorCode({ code: null }), null)
assert.equal(isSmsRetryExhausted(0), false)
assert.equal(isSmsRetryExhausted(1), false)
assert.equal(isSmsRetryExhausted(2), false)
assert.equal(isSmsRetryExhausted(3), true)
assert.equal(getSmsRetryCooldownMs(1), 300000)
assert.equal(getSmsRetryCooldownMs(2), 900000)
assert.equal(getSmsRetryCooldownMs(3), 0)

const engine = readFileSync(resolve("src/services/followupEngine.ts"), "utf8")
const scheduler = readFileSync(resolve("src/services/followupScheduler.ts"), "utf8")
const stats = readFileSync(resolve("src/services/smsDeliveryStats.ts"), "utf8")
const queue = engine.slice(engine.indexOf("export async function queueAiFollowupByTenantSlug"))
assert.ok(queue.indexOf("if (customerIsDnc)") < queue.indexOf('"ai_message_generated"'), "DNC before generation")
assert.ok(queue.includes("markPhoneAsDnc(tenantId, callbackNumber"), "Twilio 21610 persists DNC")
assert.ok(queue.includes("sms_retry_policy: SMS_RETRY_POLICY_VERSION"), "versioned failure events")
assert.ok(queue.includes("isSmsRetryExhausted(failureCount)"), "pause after three send failures")
assert.ok(queue.includes("notifySmsDeliveryHalt"), "staff notification")
assert.ok(scheduler.includes("if (schedulerPassInProgress) return"), "overlap guard")
assert.ok(scheduler.includes("and j.bot_paused is not true"), "exclude paused before limit 500")
assert.ok(scheduler.includes("getSmsFailureStreak("), "retry guard in scheduler")
assert.ok(scheduler.includes('job.stage === "lead" && job.crm_flow_key === "weather_evidence_report"'), "retain October 23 weather lead routing")
assert.ok(scheduler.includes("INITIAL_LEAD_GRACE_MS"), "retain minimum grace")
assert.ok(scheduler.includes("QUIET_START_HOUR = 19"), "retain quiet hours")
assert.ok(scheduler.includes("QUIET_END_HOUR = 7"), "retain quiet hours")
assert.ok(stats.includes("f.tenant_id = $1"), "tenant isolation")
assert.ok(stats.includes("f.meta->>'sms_retry_policy' = $5"), "historic failures excluded")
assert.ok(stats.includes("s.kind = 'ai_message_sent'"), "successful send resets streak")
assert.ok(SMS_RETRY_POLICY_VERSION)
console.log("PASS SMS policy and source-level protections (no network or database)")
