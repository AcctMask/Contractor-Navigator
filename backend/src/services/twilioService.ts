import twilio from "twilio"

const accountSid = process.env.TWILIO_ACCOUNT_SID || ""
const authToken = process.env.TWILIO_AUTH_TOKEN || ""
const fromNumber = process.env.TWILIO_FROM_NUMBER || ""
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || ""

let client: ReturnType<typeof twilio> | null = null

function getClient() {
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials missing")
  }

  if (!client) {
    client = twilio(accountSid, authToken)
  }

  return client
}

export async function sendSMS(to: string, body: string) {
  const twilioClient = getClient()

  if (messagingServiceSid) {
    const message = await twilioClient.messages.create({
      body,
      messagingServiceSid,
      to,
    })

    return {
      sid: message.sid,
      status: message.status,
      to,
      sender_type: "messaging_service",
      messaging_service_sid: messagingServiceSid,
    }
  }

  if (!fromNumber) {
    throw new Error("TWILIO_FROM_NUMBER missing")
  }

  const message = await twilioClient.messages.create({
    body,
    from: fromNumber,
    to,
  })

  return {
    sid: message.sid,
    status: message.status,
    to,
    sender_type: "direct_number",
    from: fromNumber,
  }
}
