import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { sendSMS } from "../services/twilioService"


async function ensureConversationMemoryTable() {
  await pool.query(`
    create table if not exists conversation_memory (
      tenant_id bigint not null,
      phone_digits text not null,
      active_job_id bigint not null,
      last_activity_at timestamptz not null default now(),
      primary key (tenant_id, phone_digits)
    )
  `)
}

async function setActiveConversation(
  tenantId: number,
  phone: string | null,
  jobId: number
) {
  if (!phone) return

  const digits = String(phone).replace(/\D/g, "")
  if (!digits) return

  await ensureConversationMemoryTable()

  await pool.query(
    `
    insert into conversation_memory (
      tenant_id,
      phone_digits,
      active_job_id,
      last_activity_at
    )
    values ($1,$2,$3,now())
    on conflict (tenant_id, phone_digits)
    do update set
      active_job_id = excluded.active_job_id,
      last_activity_at = now()
    `,
    [tenantId, digits, jobId]
  )
}

async function getActiveConversationJob(
  tenantId: number,
  phone: string | null
) {
  if (!phone) return null

  const digits = String(phone).replace(/\D/g, "")
  if (!digits) return null

  await ensureConversationMemoryTable()

  const result = await pool.query(
    `
    select active_job_id
    from conversation_memory
    where tenant_id = $1
      and phone_digits = $2
    limit 1
    `,
    [tenantId, digits]
  )

  if (!result.rowCount) return null

  return Number(result.rows[0].active_job_id)
}
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
  getVoiceSummary,
  saveVoiceAddress,
  saveVoiceCallbackNumber,
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
  const recordingCallback = `${buildBaseUrl()}/twilio/voice/recording-status`

  return twimlResponse(`
  <Start>
    <Recording
      recordingStatusCallback="${xmlEscape(recordingCallback)}"
      recordingStatusCallbackMethod="POST"
    />
  </Start>

  ${sayBlock("This call may be recorded for customer service and training purposes.")}

  <Gather input="speech dtmf" numDigits="1" method="POST" action="${xmlEscape(actionUrl)}" speechTimeout="auto" language="${VOICE_LANGUAGE}">
    ${sayBlock(prompt)}
  </Gather>

  ${sayBlock("I didn’t catch that. Someone from our team will follow up shortly. Goodbye.")}
  <Hangup/>`)
}

function firstPrompt() {
  return [
    "Thank you for calling Good to Go Roofing.",
    "For emergency tarp or emergency service, press 1.",
    "For roofing service, an estimate, repair, production, or an existing project, press 2.",
    "For contractor, vendor, or business partnership inquiries, press 3.",
  ].join(" ")
}

function namePrompt() {
  return "May I have your full name?"
}

function addressPrompt() {
  return "What is the street address for the property you're calling about?"
}

function callbackNumberPrompt(from: string | null) {
  const digits = String(from || "").replace(/\D/g, "")
  const lastFour = digits.slice(-4)

  if (lastFour.length === 4) {
    return `We'll call you back at the number you're calling from, ending in ${lastFour}. Is that okay?`
  }

  return "We'll call you back at the number you're calling from. Is that okay?"
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

  const tenantId = 1

  const activeJobId = await getActiveConversationJob(tenantId, phone)

  if (activeJobId) {
    const activeJob = await pool.query(
      `
      select
        j.id as job_id,
        j.tenant_id,
        j.customer_id,
        t.slug as tenant_slug
      from jobs j
      join tenants t
        on t.id = j.tenant_id
      where j.id = $1
      limit 1
      `,
      [activeJobId]
    )

    if (activeJob.rowCount) {
      return activeJob.rows[0]
    }
  }

  const result = await pool.query(
    `
    with normalized_input as (
      select regexp_replace($1, '\\D', '', 'g') as phone_digits
    ),
    latest_outbound as (
      select
        te.tenant_id,
        te.job_id,
        max(te.created_at) as last_outbound_at
      from timeline_events te, normalized_input ni
      where te.kind in ('ai_message_sent', 'ai_inbound_response_sent')
        and regexp_replace(coalesce(te.meta->>'to', ''), '\\D', '', 'g') = ni.phone_digits
      group by te.tenant_id, te.job_id
    )
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
    left join latest_outbound lo
      on lo.tenant_id = j.tenant_id
     and lo.job_id = j.id
    where regexp_replace(c.phone, '\\D', '', 'g')
      = regexp_replace($1, '\\D', '', 'g')
    order by
      case when lo.last_outbound_at is not null then 0 else 1 end,
      lo.last_outbound_at desc nulls last,
      case when nullif(trim(j.address1), '') is not null then 0 else 1 end,
      case
        when j.stage in ('estimate_sent','contract_sent','contract_requested','lead','roof_repair','tarp') then 0
        when j.job_type = 'VOICE_INTAKE' then 2
        else 1
      end,
      j.updated_at desc,
      j.created_at desc,
      j.id desc
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


type VoiceExistingProjectResolution = {
  mode:
    | "no_match"
    | "unique_match"
    | "ambiguous"
  job_id: number | null
  address1: string | null
  match_count: number
}

async function resolveVoiceExistingProjectByAddress(
  tenantId: number,
  temporaryVoiceJobId: number,
  spokenAddress: string
): Promise<VoiceExistingProjectResolution> {
  /*
   * Reuses the normalized address semantics already proven
   * in Business Development Intake.
   *
   * The temporary Voice job is excluded.
   * Closed jobs are excluded.
   * Two results are enough to prove ambiguity.
   */
  const result = await pool.query(
    `
    select
      j.id,
      j.customer_id,
      j.address1,
      j.stage
    from jobs j
    where j.tenant_id = $1
      and j.id <> $3
      and regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        regexp_replace(
                          regexp_replace(
                            regexp_replace(
                              regexp_replace(
                                regexp_replace(
                                  lower(coalesce(j.address1, '')),
                                  '\\mstreet\\M',
                                  'st',
                                  'g'
                                ),
                                '\\mavenue\\M',
                                'ave',
                                'g'
                              ),
                              '\\mboulevard\\M',
                              'blvd',
                              'g'
                            ),
                            '\\mroad\\M',
                            'rd',
                            'g'
                          ),
                          '\\mdrive\\M',
                          'dr',
                          'g'
                        ),
                        '\\mlane\\M',
                        'ln',
                        'g'
                      ),
                      '\\mcourt\\M',
                      'ct',
                      'g'
                    ),
                    '\\mcircle\\M',
                    'cir',
                    'g'
                  ),
                  '\\mterrace\\M',
                  'ter',
                  'g'
                ),
                '\\mparkway\\M',
                'pkwy',
                'g'
              ),
              '\\mplace\\M',
              'pl',
              'g'
            ),
            '[^a-z0-9]+',
            '',
            'g'
          ) = regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        regexp_replace(
                          regexp_replace(
                            regexp_replace(
                              regexp_replace(
                                regexp_replace(
                                  lower($2),
                                  '\\mstreet\\M',
                                  'st',
                                  'g'
                                ),
                                '\\mavenue\\M',
                                'ave',
                                'g'
                              ),
                              '\\mboulevard\\M',
                              'blvd',
                              'g'
                            ),
                            '\\mroad\\M',
                            'rd',
                            'g'
                          ),
                          '\\mdrive\\M',
                          'dr',
                          'g'
                        ),
                        '\\mlane\\M',
                        'ln',
                        'g'
                      ),
                      '\\mcourt\\M',
                      'ct',
                      'g'
                    ),
                    '\\mcircle\\M',
                    'cir',
                    'g'
                  ),
                  '\\mterrace\\M',
                  'ter',
                  'g'
                ),
                '\\mparkway\\M',
                'pkwy',
                'g'
              ),
              '\\mplace\\M',
              'pl',
              'g'
            ),
            '[^a-z0-9]+',
            '',
            'g'
          )
      and coalesce(j.stage, '') not in (
        'archived',
        'disqualified',
        'paid'
      )
    order by
      j.updated_at desc nulls last,
      j.id desc
    limit 2
    `,
    [
      tenantId,
      spokenAddress,
      temporaryVoiceJobId,
    ]
  )

  if (!result.rowCount) {
    return {
      mode: "no_match",
      job_id: null,
      address1: null,
      match_count: 0,
    }
  }

  if (result.rowCount !== 1) {
    return {
      mode: "ambiguous",
      job_id: null,
      address1: null,
      match_count: Number(result.rowCount),
    }
  }

  return {
    mode: "unique_match",
    job_id: Number(result.rows[0].id),
    address1: result.rows[0].address1 || null,
    match_count: 1,
  }
}

async function rebindVoiceCallToExistingProject(params: {
  tenantId: number
  temporaryVoiceJobId: number
  existingJobId: number
  callSid: string | null
  from: string | null
  spokenAddress: string
  existingAddress: string | null
}) {
  const client = await pool.connect()

  try {
    await client.query("begin")

    /*
     * The temporary VOICE_INTAKE job belongs only to this call.
     * Move its Voice timeline history—including voice_call_received
     * containing call_sid—to the proven existing project.
     */
    await client.query(
      `
      update timeline_events
      set job_id = $3
      where tenant_id = $1
        and job_id = $2
        and kind like 'voice_%'
      `,
      [
        params.tenantId,
        params.temporaryVoiceJobId,
        params.existingJobId,
      ]
    )

    await client.query(
      `
      insert into timeline_events
        (
          tenant_id,
          job_id,
          kind,
          message,
          meta,
          created_at
        )
      values
        (
          $1,
          $2,
          'voice_address_captured',
          $3,
          $4::jsonb,
          now()
        )
      `,
      [
        params.tenantId,
        params.existingJobId,
        params.spokenAddress,
        JSON.stringify({
          channel: "voice",
          matched_existing_project: true,
          existing_property_address:
            params.existingAddress,
          temporary_voice_job_id:
            params.temporaryVoiceJobId,
          call_sid:
            params.callSid,
        }),
      ]
    )

    await client.query(
      `
      insert into timeline_events
        (
          tenant_id,
          job_id,
          kind,
          message,
          meta,
          created_at
        )
      values
        (
          $1,
          $2,
          'voice_existing_project_matched',
          'Inbound Voice call matched to existing Navigator project by normalized property address',
          $3::jsonb,
          now()
        )
      `,
      [
        params.tenantId,
        params.existingJobId,
        JSON.stringify({
          channel: "voice",
          match_basis:
            "normalized_property_address",
          temporary_voice_job_id:
            params.temporaryVoiceJobId,
          spoken_address:
            params.spokenAddress,
          existing_property_address:
            params.existingAddress,
          call_sid:
            params.callSid,
          from:
            params.from,
        }),
      ]
    )

    /*
     * Do not delete the temporary job.
     * Archive it for auditability only after a unique match.
     */
    await client.query(
      `
      update jobs
      set
        stage = 'archived',
        crm_substatus =
          'voice_rebound_existing_project',
        updated_at = now()
      where tenant_id = $1
        and id = $2
        and job_type = 'VOICE_INTAKE'
      `,
      [
        params.tenantId,
        params.temporaryVoiceJobId,
      ]
    )

    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }

  /*
   * Conversation memory now points phone communication
   * to the project that was proven by address.
   */
  await setActiveConversation(
    params.tenantId,
    params.from,
    params.existingJobId
  )
}

async function reportAaCustomerActivity(payload: {
  tenant_slug: string;
  module_id: string;
  module_name: string;
  activity_type: string;
  title: string;
  description?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}) {
  const gatewayUrl =
    process.env.AA_ACTIVITY_GATEWAY_URL ||
    "https://actual-assistant-owner-controls.vercel.app/api/record-activity";

  const gatewaySecret = process.env.AA_ACTIVITY_GATEWAY_SECRET;

  if (!gatewaySecret) {
    console.warn("Skipping AA activity report: missing AA_ACTIVITY_GATEWAY_SECRET");
    return;
  }

  try {
    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-aa-activity-secret": gatewaySecret,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const details = await response.text();
      console.warn("AA activity report failed:", response.status, details);
    }
  } catch (err) {
    console.warn("AA activity report error:", err);
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
    const from = normalizePhone(body.From)
    const digits = String(body.Digits || "").trim()
    const speech = getSpeech(body).toLowerCase()

    if (!tenantSlug || !jobId) {
      return replyXml(
        reply,
        twimlResponse(`
  ${sayBlock("We couldn't complete the call intake. A representative will follow up shortly.")}
  <Hangup/>`)
      )
    }

    let routingReason = ""

    if (
      digits === "1" ||
      /emergency|tarp|leak|water coming|water is coming/.test(speech)
    ) {
      routingReason =
        "Emergency tarp or emergency service"
    } else if (
      digits === "2" ||
      /roof|estimate|repair|production|project|inspection|customer/.test(speech)
    ) {
      routingReason =
        "Roofing service, estimate, repair, production, or existing project"
    } else if (
      digits === "3" ||
      /contractor|vendor|builder|business|partner|partnership/.test(speech)
    ) {
      routingReason =
        "Contractor, vendor, or business partnership inquiry"
    } else {
      routingReason =
        speech
          ? `General roofing inquiry: ${speech}`
          : "General roofing inquiry"
    }

    await saveVoiceReason(
      String(tenantSlug),
      Number(jobId),
      from,
      routingReason
    )

    const actionUrl =
      buildActionUrl(
        "/twilio/voice/name",
        {
          tenantSlug,
          jobId,
          callSid:
            String(callSid || ""),
        }
      )

    return replyXml(
      reply,
      gatherSpeechXml(
        namePrompt(),
        actionUrl
      )
    )
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

    const tenantId =
      await getTenantIdBySlug(
        String(tenantSlug)
      )

    const temporaryVoiceJobId =
      Number(jobId)

    const resolution =
      await resolveVoiceExistingProjectByAddress(
        tenantId,
        temporaryVoiceJobId,
        address
      )

    let resolvedJobId =
      temporaryVoiceJobId

    if (
      resolution.mode === "unique_match" &&
      resolution.job_id
    ) {
      resolvedJobId =
        resolution.job_id

      await rebindVoiceCallToExistingProject({
        tenantId,
        temporaryVoiceJobId,
        existingJobId:
          resolvedJobId,
        callSid:
          String(callSid || "").trim() ||
          null,
        from,
        spokenAddress:
          address,
        existingAddress:
          resolution.address1,
      })

      console.log(
        "[VOICE_DIAG] existing Navigator project matched by property address",
        {
          tenantSlug,
          temporaryVoiceJobId,
          resolvedJobId,
          spokenAddress:
            address,
          existingAddress:
            resolution.address1,
        }
      )
    } else {
      /*
       * NO MATCH:
       * preserve the existing Voice-created prospect/job
       * exactly as it already works.
       *
       * AMBIGUOUS:
       * do not guess.
       */
      await saveVoiceAddress(
        String(tenantSlug),
        temporaryVoiceJobId,
        address
      )

      if (
        resolution.mode === "ambiguous"
      ) {
        await addTimelineEvent(
          tenantId,
          temporaryVoiceJobId,
          "voice_address_match_ambiguous",
          address,
          {
            channel: "voice",
            match_count:
              resolution.match_count,
            call_sid:
              String(callSid || ""),
          }
        )

        console.warn(
          "[VOICE_DIAG] multiple active projects matched property address; temporary Voice job retained",
          {
            tenantSlug,
            temporaryVoiceJobId,
            address,
            matchCount:
              resolution.match_count,
          }
        )
      }
    }

    const actionUrl =
      buildActionUrl(
        "/twilio/voice/callback-number",
        {
          tenantSlug,
          jobId:
            resolvedJobId,
          callSid:
            String(callSid || ""),
        }
      )

    return replyXml(
      reply,
      gatherSpeechXml(
        callbackNumberPrompt(from),
        actionUrl
      )
    )
  })

  app.post("/twilio/voice/callback-number", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId, callSid } = (req as any).query || {}
    const from = normalizePhone(body.From)
    const spokenValue = getSpeech(body)
    const normalizedAnswer =
      spokenValue.toLowerCase().trim()

    if (!tenantSlug || !jobId) {
      return replyXml(
        reply,
        twimlResponse(`
  ${sayBlock("We couldn't complete the call intake. A representative will follow up shortly.")}
  <Hangup/>`)
      )
    }

    const callerConfirmed =
      /^(yes|yeah|yep|correct|right|okay|ok|sure|that is fine|that's fine)$/i.test(
        normalizedAnswer
      )

    const callerDeclined =
      /^(no|nope|different|another number|not that number)$/i.test(
        normalizedAnswer
      )

    if (callerDeclined) {
      const actionUrl =
        buildActionUrl(
          "/twilio/voice/preferred-callback-number",
          {
            tenantSlug,
            jobId,
            callSid:
              String(callSid || ""),
          }
        )

      return replyXml(
        reply,
        gatherSpeechXml(
          "Please provide the best phone number to reach you.",
          actionUrl
        )
      )
    }

    const callbackValue =
      callerConfirmed || !spokenValue
        ? from
        : spokenValue

    await saveVoiceCallbackNumber(
      String(tenantSlug),
      Number(jobId),
      from,
      callbackValue
    )

    const actionUrl =
      buildActionUrl(
        "/twilio/voice/final-reason",
        {
          tenantSlug,
          jobId,
          callSid:
            String(callSid || ""),
        }
      )

    return replyXml(
      reply,
      gatherSpeechXml(
        "Lastly, please give me a brief reason for your call so I can route it to the proper recipient.",
        actionUrl
      )
    )
  })

  app.post("/twilio/voice/preferred-callback-number", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId, callSid } = (req as any).query || {}
    const from = normalizePhone(body.From)
    const preferredNumber =
      getSpeech(body)

    if (
      !tenantSlug ||
      !jobId ||
      !preferredNumber
    ) {
      await saveVoiceCallbackNumber(
        String(tenantSlug),
        Number(jobId),
        from,
        from
      )

      const actionUrl =
        buildActionUrl(
          "/twilio/voice/final-reason",
          {
            tenantSlug,
            jobId,
            callSid:
              String(callSid || ""),
          }
        )

      return replyXml(
        reply,
        gatherSpeechXml(
          "Lastly, please give me a brief reason for your call so I can route it to the proper recipient.",
          actionUrl
        )
      )
    }

    await saveVoiceCallbackNumber(
      String(tenantSlug),
      Number(jobId),
      from,
      preferredNumber
    )

    const actionUrl =
      buildActionUrl(
        "/twilio/voice/final-reason",
        {
          tenantSlug,
          jobId,
          callSid:
            String(callSid || ""),
        }
      )

    return replyXml(
      reply,
      gatherSpeechXml(
        "Lastly, please give me a brief reason for your call so I can route it to the proper recipient.",
        actionUrl
      )
    )
  })

  app.post("/twilio/voice/final-reason", async (req, reply) => {
    const body = (req as any).body || {}
    const { tenantSlug, jobId, callSid } = (req as any).query || {}
    const from = normalizePhone(body.From)
    const reason = getSpeech(body)

    if (!tenantSlug || !jobId || !reason) {
      return replyXml(
        reply,
        twimlResponse(`
  ${sayBlock("I didn't catch the reason for your call. A representative will reach out shortly.")}
  <Hangup/>`)
      )
    }

    await saveVoiceReason(
      String(tenantSlug),
      Number(jobId),
      from,
      reason
    )

    await sendVoiceIntakeAlert(String(tenantSlug), Number(jobId))

    const summary = await getVoiceSummary(String(tenantSlug), Number(jobId))
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

    await reportAaCustomerActivity({
      tenant_slug: String(tenantSlug),
      module_id: "ai_followup",
      module_name: "AI Follow-Up & After-Hours Assistant",
      activity_type: "voice_ai_response_spoken",
      title: "AI completed voice intake",
      description: "AI captured caller details and delivered the final voice response.",
      source: "twilio_voice_intake",
      metadata: {
        tenant_id: tenantId,
        job_id: Number(jobId),
        call_sid: String(callSid || ""),
        caller: from,
        customer_name: summary.customerName,
        property_address: summary.propertyAddress,
        callback_number: summary.callbackNumber,
        reason: summary.reason,
        emergency_tarp_requested: summary.emergencyTarpRequested,
      },
    });

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

    return replyXml(
      reply,
      twimlResponse(`
  ${sayBlock("Thank you. A representative will reach out shortly.")}
  <Hangup/>`)
    )
  })

  app.post("/twilio/voice/recording-status", async (req, reply) => {
    const body = (req as any).body || {}

    console.log("Twilio recording callback:", {
      callSid: body.CallSid,
      recordingSid: body.RecordingSid,
      recordingUrl: body.RecordingUrl,
      recordingStatus: body.RecordingStatus,
      recordingDuration: body.RecordingDuration,
    })

    return reply.send({ ok: true })
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
