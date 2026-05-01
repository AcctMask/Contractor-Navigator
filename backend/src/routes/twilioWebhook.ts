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

const VOICE_NAME = "Polly.Joanna"
const VOICE_LANGUAGE = "en-US"

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
  return String(body?.SpeechResult || body?.UnstableSpeechResult || "").trim()
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

function speechify(text: string) {
  return `<prosody rate="92%" pitch="-2%">${xmlEscape(text)}</prosody>`
}

function elevenLabsEnabled() {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID)
}

function elevenLabsPlayUrl(text: string) {
  const url = new URL(`${buildBaseUrl()}/twilio/voice/tts`)
  url.searchParams.set("text", text)
  return url.toString()
}

function sayBlock(text: string) {
  if (elevenLabsEnabled()) {
    return `<Play>${xmlEscape(elevenLabsPlayUrl(text))}</Play>`
  }

  return `<Say voice="${VOICE_NAME}" language="${VOICE_LANGUAGE}">${speechify(text)}</Say>`
}

function gatherSpeechXml(prompt: string, actionUrl: string) {
  return twimlResponse(`
  <Gather input="speech" method="POST" action="${xmlEscape(actionUrl)}" speechTimeout="auto" language="${VOICE_LANGUAGE}">
    ${sayBlock(prompt)}
  </Gather>
  ${sayBlock("I didn’t catch that. Someone from our team will follow up shortly. Goodbye.")}
  <Hangup/>`)
}

function gatherSpeechOrDigitsXml(prompt: string, actionUrl: string) {
  return twimlResponse(`
  <Gather input="speech dtmf" numDigits="1" method="POST" action="${xmlEscape(actionUrl)}" speechTimeout="auto" language="${VOICE_LANGUAGE}">
    ${sayBlock(prompt)}
  </Gather>
  ${sayBlock("I didn’t catch that. Someone from our team will follow up shortly. Goodbye.")}
  <Hangup/>`)
}

function firstPrompt() {
  return (
    "Thanks for calling Good2Go Roofing. " +
    "If this is an emergency tarp request, press 1 now. " +
    "Otherwise, in a few words, tell me whether you need an estimate, an inspection, or help with an existing project."
  )
}

function namePrompt() {
  return "Got it. Let me grab a few quick details so the right person can call you back. First, please say your full name."
}

function addressPrompt() {
  return "Thanks. Now please say the property address. If you’d rather not say the full address right now, just say the zip code."
}

function callbackNumberPrompt(from: string | null) {
  if (!from) {
    return "What’s the best callback number for our team to reach you?"
  }

  return (
    "I can use the number you’re calling from as your callback number. " +
    "If that works, just say yes. Otherwise, say the best callback number now."
  )
}

function callbackTimePrompt() {
  return "And what’s the best time for our team to call you back?"
}

function emergencyTarpSpokenResponse() {
  return (
    "Okay. I’ve marked this as an urgent emergency tarp request. " +
    "Please stay available for a callback from our team."
  )
}

function isAffirmative(value: string | null | undefined) {
  const v = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?]/g, "")

  return ["yes", "yeah", "yep", "correct", "that works", "use that", "use that number"].includes(v)
}

async function getTenantIdBySlug(slug: string) {
  const result = await pool.query(
    `select id from tenants where slug = $1 limit 1`,
    [slug]
  )

  if (!result.rowCount) {
    throw new Error(`Tenant not found for slug: ${slug}`)
  }

  return Number(result.rows[0].id)
}

async function getJobByCallSid(callSid: string | null | undefined) {
  if (!callSid) return null

  const result = await pool.query(
    `
    select
      tenant_id,
      job_id
    from timeline_events
    where kind = 'voice_call_received'
      and meta->>'call_sid' = $1
    order by id desc
    limit 1
    `,
    [callSid]
  )

  if (!result.rowCount) return null
  return {
    tenant_id: Number(result.rows[0].tenant_id),
    job_id: Number(result.rows[0].job_id),
  }
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

async function addVoiceCallReceivedOnce(
  tenantId: number,
  jobId: number,
  callSid: string | null,
  from: string | null
) {
  if (!callSid) return

  const existing = await pool.query(
    `
    select id
    from timeline_events
    where kind = 'voice_call_received'
      and tenant_id = $1
      and job_id = $2
      and meta->>'call_sid' = $3
    limit 1
    `,
    [tenantId, jobId, callSid]
  )

  if (existing.rowCount) return

  await addTimelineEvent(
    tenantId,
    jobId,
    "voice_call_received",
    "Inbound call received on Twilio number",
    {
      call_sid: callSid,
      from,
      channel: "voice",
    }
  )
}

async function hasFollowupSmsForCall(callSid: string | null | undefined) {
  if (!callSid) return false

  const result = await pool.query(
    `
    select id
    from timeline_events
    where kind = 'voice_followup_sms_sent'
      and meta->>'call_sid' = $1
    limit 1
    `,
    [callSid]
  )

  return Boolean(result.rowCount)
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

async function getOrCreateVoiceJob(tenantSlug: string, from: string | null, callSid: string | null) {
  const existing = await getJobByCallSid(callSid)
  if (existing) {
    return {
      tenant_id: existing.tenant_id,
      job_id: existing.job_id,
      reused: true,
    }
  }

  const created = await startVoiceIntakeLead(tenantSlug, from)
  const tenantId = await getTenantIdBySlug(tenantSlug)

  await addVoiceCallReceivedOnce(tenantId, Number(created.job_id), callSid, from)

  return {
    tenant_id: tenantId,
    job_id: Number(created.job_id),
    reused: false,
  }
}

async function sendPostCallFollowupText(
  tenantId: number,
  jobId: number,
  callSid: string | null,
  callbackNumber: string | null,
  finalMessage: string
) {
  if (!callbackNumber) return
  if (await hasFollowupSmsForCall(callSid)) return

  const dnc = await isPhoneDnc(tenantId, callbackNumber)
  if (dnc) return

  const smsText = `${finalMessage} You can reply here with any updates or questions.`

  await sendSMS(callbackNumber, smsText)

  await addTimelineEvent(
    tenantId,
    jobId,
    "voice_followup_sms_sent",
    smsText,
    {
      channel: "sms",
      call_sid: callSid,
      to: callbackNumber,
    }
  )
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

  app.get("/twilio/voice/tts", async (req, reply) => {
    try {
      const q: any = (req as any).query || {}
      const text = String(q.text || "").trim()

      if (!text) {
        return reply.status(400).send("Missing text")
      }

      const apiKey = process.env.ELEVENLABS_API_KEY
      const voiceId = process.env.ELEVENLABS_VOICE_ID

      if (!apiKey || !voiceId) {
        return reply.status(500).send("ElevenLabs is not configured")
      }

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.55,
            similarity_boost: 0.75,
            style: 0.15,
            use_speaker_boost: true
          }
        })
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => "")
        return reply.status(502).send(`ElevenLabs TTS failed: ${response.status} ${errText}`)
      }

      const audio = Buffer.from(await response.arrayBuffer())

      reply
        .header("Content-Type", "audio/mpeg")
        .header("Cache-Control", "public, max-age=86400")
        .send(audio)
    } catch (err: any) {
      return reply.status(500).send(err?.message || String(err))
    }
  })

  app.post("/twilio/inbound-call", async (req, reply) => {
    const body = (req as any).body || {}
    const from = normalizePhone(body.From ? String(body.From) : null)
    const callSid = String(body.CallSid || "").trim() || null
    const tenantSlug = "g2g-roofing"

    const voiceJob = await getOrCreateVoiceJob(tenantSlug, from, callSid)

    const actionUrl = buildActionUrl("/twilio/voice/reason", {
      tenantSlug,
      jobId: voiceJob.job_id,
      callSid: callSid || "",
    })

    return replyXml(reply, gatherSpeechOrDigitsXml(firstPrompt(), actionUrl))
  })

  app.post("/twilio/voice/reason", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId, callSid } = (req as any).query || {}
    const from = normalizePhone(body.From ? String(body.From) : null)
    const reason = getSpeech(body)
    const digits = getDigits(body)

    if (!tenantSlug || !jobId) {
      return replyXml(
        reply,
        twimlResponse(`
  ${sayBlock("We couldn’t capture your request. Please try again later.")}
  <Hangup/>`)
      )
    }

    if (digits === "1") {
      await saveVoiceReason(String(tenantSlug), Number(jobId), from, "Emergency tarp request")
      const actionUrl = buildActionUrl("/twilio/voice/name", { tenantSlug, jobId, callSid: String(callSid || "") })
      return replyXml(
        reply,
        gatherSpeechXml(`${emergencyTarpSpokenResponse()} Please say your full name.`, actionUrl)
      )
    }

    if (!reason) {
      return replyXml(
        reply,
        twimlResponse(`
  ${sayBlock("I didn’t catch what you need help with. Please call back and try again.")}
  <Hangup/>`)
      )
    }

    await saveVoiceReason(String(tenantSlug), Number(jobId), from, reason)

    const actionUrl = buildActionUrl("/twilio/voice/name", { tenantSlug, jobId, callSid: String(callSid || "") })
    return replyXml(reply, gatherSpeechXml(namePrompt(), actionUrl))
  })

  app.post("/twilio/voice/name", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId, callSid } = (req as any).query || {}
    const name = getSpeech(body)

    if (!tenantSlug || !jobId || !name) {
      return replyXml(
        reply,
        twimlResponse(`
  ${sayBlock("I couldn’t catch your name. Please call back and try again.")}
  <Hangup/>`)
      )
    }

    await saveVoiceName(String(tenantSlug), Number(jobId), name)

    const actionUrl = buildActionUrl("/twilio/voice/address", { tenantSlug, jobId, callSid: String(callSid || "") })
    return replyXml(reply, gatherSpeechXml(addressPrompt(), actionUrl))
  })

  app.post("/twilio/voice/address", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId, callSid } = (req as any).query || {}
    const address = getSpeech(body)
    const from = normalizePhone(body.From ? String(body.From) : null)

    if (!tenantSlug || !jobId || !address) {
      return replyXml(
        reply,
        twimlResponse(`
  ${sayBlock("I couldn’t catch the property address. Please call back and try again.")}
  <Hangup/>`)
      )
    }

    await saveVoiceAddress(String(tenantSlug), Number(jobId), address)

    const actionUrl = buildActionUrl("/twilio/voice/callback-number", { tenantSlug, jobId, callSid: String(callSid || "") })
    return replyXml(reply, gatherSpeechXml(callbackNumberPrompt(from), actionUrl))
  })

  app.post("/twilio/voice/callback-number", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId, callSid } = (req as any).query || {}
    const spokenValue = getSpeech(body)
    const from = normalizePhone(body.From ? String(body.From) : null)

    if (!tenantSlug || !jobId) {
      return replyXml(
        reply,
        twimlResponse(`
  ${sayBlock("I couldn’t capture the callback number. Please call back and try again.")}
  <Hangup/>`)
      )
    }

    let callbackValue = spokenValue || ""

    if (isAffirmative(spokenValue) && from) {
      callbackValue = from
    } else if (!callbackValue && from) {
      callbackValue = from
    }

    await saveVoiceCallbackNumber(String(tenantSlug), Number(jobId), from, callbackValue)

    const actionUrl = buildActionUrl("/twilio/voice/callback-time", { tenantSlug, jobId, callSid: String(callSid || "") })
    return replyXml(reply, gatherSpeechXml(callbackTimePrompt(), actionUrl))
  })

  app.post("/twilio/voice/callback-time", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId, callSid } = (req as any).query || {}
    const callbackTime = getSpeech(body)
    const from = normalizePhone(body.From ? String(body.From) : null)

    if (!tenantSlug || !jobId || !callbackTime) {
      return replyXml(
        reply,
        twimlResponse(`
  ${sayBlock("I couldn’t catch the best callback time. Please call back and try again.")}
  <Hangup/>`)
      )
    }

    await saveVoiceCallbackTime(String(tenantSlug), Number(jobId), callbackTime)
    await sendVoiceIntakeAlert(String(tenantSlug), Number(jobId))

    const finalMessage = await getVoiceFinalConfirmation(String(tenantSlug), Number(jobId))
    const tenantId = await getTenantIdBySlug(String(tenantSlug))

    await addTimelineEvent(
      tenantId,
      Number(jobId),
      "voice_ai_response_spoken",
      finalMessage,
      {
        sender: "Good2Go Roofing Team",
        channel: "voice",
        call_sid: String(callSid || ""),
      }
    )

    await sendPostCallFollowupText(
      tenantId,
      Number(jobId),
      String(callSid || ""),
      from,
      finalMessage
    )

    return replyXml(
      reply,
      twimlResponse(`
  ${sayBlock(finalMessage)}
  <Pause length="1"/>
  ${sayBlock("If you need anything else before we call, you can text this number.")}
  <Hangup/>`)
    )
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
