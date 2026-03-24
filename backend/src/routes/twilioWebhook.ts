import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { sendSMS } from "../services/twilioService"
import {
  clearPhoneDnc,
  detectDncOptIn,
  detectDncOptOut,
  isPhoneDnc,
  markPhoneAsDnc,
} from "../services/dncService"
import {
  getVoiceFinalConfirmation,
  getVoiceStatusResponse,
  saveVoiceAddress,
  saveVoiceCallbackNumber,
  saveVoiceCallbackTime,
  saveVoiceName,
  saveVoiceReason,
  sendVoiceIntakeAlert,
  startVoiceIntakeLead,
} from "../services/voiceIntakeService"

function normalizePhone(phone: string | null | undefined) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (phone.startsWith("+")) return phone
  return digits ? `+${digits}` : null
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function twimlResponse(inner: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
${inner}
</Response>`
}

function getSpeech(body: any) {
  return String(body?.SpeechResult || "").trim()
}

function getDigits(body: any) {
  return String(body?.Digits || "").trim()
}

function buildBaseUrl() {
  const raw =
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    "http://localhost:8787"

  return raw.replace(/\/+$/, "")
}

function buildActionUrl(path: string, params: Record<string, string | number>) {
  const url = new URL(`${buildBaseUrl()}${path}`)
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value))
  })
  return url.toString()
}

function replyXml(reply: any, xml: string) {
  reply.header("Content-Type", "text/xml")
  return reply.send(xml)
}

function gatherSpeechXml(prompt: string, actionUrl: string) {
  return twimlResponse(`
  <Gather input="speech" method="POST" action="${xmlEscape(actionUrl)}" speechTimeout="auto" language="en-US">
    <Say voice="alice">${xmlEscape(prompt)}</Say>
  </Gather>
  <Say voice="alice">We did not receive a response. A member of our team will follow up shortly. Goodbye.</Say>
  <Hangup/>`)
}

function gatherSpeechOrDigitsXml(prompt: string, actionUrl: string) {
  return twimlResponse(`
  <Gather input="speech dtmf" numDigits="1" method="POST" action="${xmlEscape(actionUrl)}" speechTimeout="auto" language="en-US">
    <Say voice="alice">${xmlEscape(prompt)}</Say>
  </Gather>
  <Say voice="alice">We did not receive a response. A member of our team will follow up shortly. Goodbye.</Say>
  <Hangup/>`)
}

function firstPrompt() {
  return (
    "Thanks for calling Good2Go Roofing. " +
    "If you need emergency tarping right now, press 1 at any time. " +
    "Otherwise, please briefly tell me if you need an estimate, an inspection, or help with an existing project."
  )
}

function namePrompt() {
  return "Thanks. Let’s get a few quick details so the right person can call you back. Please say your full name."
}

function addressPrompt() {
  return "Please say the property address. If you do not want to say the full address right now, you can just say the zip code."
}

function callbackNumberPrompt(from: string | null) {
  if (!from) {
    return "Please say the best callback number for our team to reach you."
  }

  const spoken = normalizePhone(from)?.replace(/\D/g, "").split("").join(" ") || "your caller ID number"

  return (
    `I have your caller ID as ${spoken}. ` +
    "If that is the best callback number, say yes. Otherwise, say the best callback number now."
  )
}

function callbackTimePrompt() {
  return "What is the best time for our team to call you back?"
}

function emergencyTarpSpokenResponse() {
  return (
    "Thanks. We’ve marked this as an urgent emergency tarp request. " +
    "Please stay available for a callback from our team."
  )
}

async function addTimelineEvent(
  tenantId: number,
  jobId: number,
  kind: string,
  message: string,
  meta: Record<string, unknown> = {}
) {
  await pool.query(
    `
    insert into timeline_events
      (tenant_id, job_id, kind, message, meta, created_at)
    values
      ($1, $2, $3, $4, $5::jsonb, now())
    `,
    [tenantId, jobId, kind, message, JSON.stringify(meta)]
  )
}

async function getLatestJobByPhone(phone: string | null) {
  if (!phone) return null

  const result = await pool.query(
    `
    select
      j.id as job_id,
      j.tenant_id,
      j.customer_id,
      t.slug as tenant_slug
    from customers c
    join jobs j
      on j.customer_id = c.id
     and j.tenant_id = c.tenant_id
    join tenants t
      on t.id = j.tenant_id
    where c.phone = $1
    order by j.created_at desc, j.id desc
    limit 1
    `,
    [phone]
  )

  if (!result.rowCount) return null
  return result.rows[0]
}

async function registerTwilioWebhook(app: FastifyInstance) {
  app.post("/twilio/inbound-sms", async (req, reply) => {
    const body = (req as any).body || {}

    const from = normalizePhone(body.From ? String(body.From) : null)
    const message = String(body.Body || "").trim()

    if (!from || !message) {
      return reply.send({ ok: true, skipped: true })
    }

    const latest = await getLatestJobByPhone(from)

    if (detectDncOptOut(message)) {
      if (latest) {
        await markPhoneAsDnc(Number(latest.tenant_id), from, {
          customerId: latest.customer_id ? Number(latest.customer_id) : null,
          source: "sms_stop_keyword",
          note: message,
        })

        await pool.query(
          `
          update jobs
          set
            crm_substatus = 'dnc',
            crm_flow_key = 'manual_or_auto_dnc',
            bot_paused = true,
            updated_at = now()
          where tenant_id = $1
            and id = $2
          `,
          [Number(latest.tenant_id), Number(latest.job_id)]
        )

        await addTimelineEvent(
          Number(latest.tenant_id),
          Number(latest.job_id),
          "dnc_marked",
          "Customer opted out by SMS keyword",
          {
            from,
            message,
            source: "sms_stop_keyword",
          }
        )
      }

      try {
        await sendSMS(
          from,
          "You have been opted out of automated text messages from Good2Go Roofing. Reply START if you want to opt back in."
        )
      } catch {}

      return reply.send({ ok: true, dnc: true, action: "opt_out" })
    }

    if (detectDncOptIn(message)) {
      if (latest) {
        await clearPhoneDnc(Number(latest.tenant_id), from, {
          customerId: latest.customer_id ? Number(latest.customer_id) : null,
          source: "sms_start_keyword",
          note: message,
        })

        await addTimelineEvent(
          Number(latest.tenant_id),
          Number(latest.job_id),
          "dnc_cleared",
          "Customer opted back in by SMS keyword",
          {
            from,
            message,
            source: "sms_start_keyword",
          }
        )
      }

      try {
        await sendSMS(
          from,
          "You have been opted back in for automated text messages from Good2Go Roofing."
        )
      } catch {}

      return reply.send({ ok: true, dnc: false, action: "opt_in" })
    }

    if (!latest) {
      return reply.send({ ok: true, skipped: true, reason: "job_not_found_for_phone" })
    }

    const dnc = await isPhoneDnc(Number(latest.tenant_id), from)
    if (dnc) {
      await addTimelineEvent(
        Number(latest.tenant_id),
        Number(latest.job_id),
        "customer_reply",
        message,
        {
          from,
          channel: "sms",
          note: "Received while marked DNC",
        }
      )

      return reply.send({ ok: true, skipped: true, reason: "phone_marked_dnc" })
    }

    const { handleInboundMessageByTenantSlug } = await import("../services/followupEngine")

    const response = await handleInboundMessageByTenantSlug(
      String(latest.tenant_slug),
      Number(latest.job_id),
      message,
      from
    )

    return reply.send(response)
  })

  app.post("/twilio/inbound-call", async (req, reply) => {
    const body = (req as any).body || {}
    const from = normalizePhone(body.From ? String(body.From) : null)
    const tenantSlug = "g2g-roofing"

    const created = await startVoiceIntakeLead(tenantSlug, from)

    const actionUrl = buildActionUrl("/twilio/voice/reason", {
      tenantSlug,
      jobId: created.job_id,
    })

    return replyXml(reply, gatherSpeechOrDigitsXml(firstPrompt(), actionUrl))
  })

  app.post("/twilio/voice/reason", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId } = (req as any).query || {}
    const from = normalizePhone(body.From ? String(body.From) : null)
    const reason = getSpeech(body)
    const digits = getDigits(body)

    if (!tenantSlug || !jobId) {
      return replyXml(reply, twimlResponse(`
  <Say voice="alice">We could not capture your request. Please try again later.</Say>
  <Hangup/>`))
    }

    if (digits === "1") {
      await saveVoiceReason(String(tenantSlug), Number(jobId), from, "Emergency tarp request")
      const actionUrl = buildActionUrl("/twilio/voice/name", { tenantSlug, jobId })
      return replyXml(reply, gatherSpeechXml(`${emergencyTarpSpokenResponse()} Please say your full name.`, actionUrl))
    }

    if (!reason) {
      return replyXml(reply, twimlResponse(`
  <Say voice="alice">We could not capture the reason for your call. Please try again later.</Say>
  <Hangup/>`))
    }

    await saveVoiceReason(String(tenantSlug), Number(jobId), from, reason)

    const actionUrl = buildActionUrl("/twilio/voice/name", { tenantSlug, jobId })
    return replyXml(reply, gatherSpeechXml(namePrompt(), actionUrl))
  })

  app.post("/twilio/voice/name", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId } = (req as any).query || {}
    const name = getSpeech(body)

    if (!tenantSlug || !jobId || !name) {
      return replyXml(reply, twimlResponse(`
  <Say voice="alice">We could not capture your name. Please try again later.</Say>
  <Hangup/>`))
    }

    await saveVoiceName(String(tenantSlug), Number(jobId), name)

    const actionUrl = buildActionUrl("/twilio/voice/address", { tenantSlug, jobId })
    return replyXml(reply, gatherSpeechXml(addressPrompt(), actionUrl))
  })

  app.post("/twilio/voice/address", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId } = (req as any).query || {}
    const address = getSpeech(body)
    const from = normalizePhone(body.From ? String(body.From) : null)

    if (!tenantSlug || !jobId || !address) {
      return replyXml(reply, twimlResponse(`
  <Say voice="alice">We could not capture the property address. Please try again later.</Say>
  <Hangup/>`))
    }

    await saveVoiceAddress(String(tenantSlug), Number(jobId), address)

    const actionUrl = buildActionUrl("/twilio/voice/callback-number", { tenantSlug, jobId })
    return replyXml(reply, gatherSpeechXml(callbackNumberPrompt(from), actionUrl))
  })

  app.post("/twilio/voice/callback-number", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId } = (req as any).query || {}
    const spokenValue = getSpeech(body)
    const from = normalizePhone(body.From ? String(body.From) : null)

    if (!tenantSlug || !jobId) {
      return replyXml(reply, twimlResponse(`
  <Say voice="alice">We could not capture the callback number. Please try again later.</Say>
  <Hangup/>`))
    }

    await saveVoiceCallbackNumber(String(tenantSlug), Number(jobId), from, spokenValue || "yes")

    const actionUrl = buildActionUrl("/twilio/voice/callback-time", { tenantSlug, jobId })
    return replyXml(reply, gatherSpeechXml(callbackTimePrompt(), actionUrl))
  })

  app.post("/twilio/voice/callback-time", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId } = (req as any).query || {}
    const callbackTime = getSpeech(body)

    if (!tenantSlug || !jobId || !callbackTime) {
      return replyXml(reply, twimlResponse(`
  <Say voice="alice">We could not capture the callback time. Please try again later.</Say>
  <Hangup/>`))
    }

    await saveVoiceCallbackTime(String(tenantSlug), Number(jobId), callbackTime)
    await sendVoiceIntakeAlert(String(tenantSlug), Number(jobId))

    const finalMessage = await getVoiceFinalConfirmation(String(tenantSlug), Number(jobId))

    await addTimelineEvent(
      Number((await getLatestJobByPhone(normalizePhone(body.From ? String(body.From) : null)))?.tenant_id || 1),
      Number(jobId),
      "voice_ai_response_spoken",
      finalMessage,
      {
        sender: "Good2Go Roofing Team",
        channel: "voice",
      }
    )

    return replyXml(reply, twimlResponse(`
  <Say voice="alice">${xmlEscape(finalMessage)}</Say>
  <Pause length="1"/>
  <Say voice="alice">If you need anything else before we call, feel free to text this number.</Say>
  <Hangup/>`))
  })

  app.post("/twilio/voice/status", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId } = (req as any).query || {}

    if (!tenantSlug || !jobId) {
      return reply.send({ ok: true, skipped: true })
    }

    const result = await getVoiceStatusResponse(String(tenantSlug), Number(jobId), body)
    return reply.send(result)
  })

  app.get("/twilio/inbound-call", async (_req, reply) => {
    return reply.send({
      ok: true,
      message: "Twilio inbound voice route is live. Twilio should call this endpoint with POST.",
    })
  })
}

export default registerTwilioWebhook
export { registerTwilioWebhook }
