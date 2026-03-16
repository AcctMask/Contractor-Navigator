import twilio from "twilio"

const accountSid = process.env.TWILIO_ACCOUNT_SID || ""
const authToken = process.env.TWILIO_AUTH_TOKEN || ""
const fromNumber = process.env.TWILIO_FROM_NUMBER || ""

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

export function getTwilioFromNumber() {
  if (!fromNumber) {
    throw new Error("TWILIO_FROM_NUMBER missing")
  }
  return fromNumber
}

export async function sendSMS(to: string, body: string) {
  const twilioClient = getClient()
  const from = getTwilioFromNumber()

  const message = await twilioClient.messages.create({
    body,
    from,
    to,
  })

  return {
    sid: message.sid,
    status: message.status,
    from,
    to,
  }
}
