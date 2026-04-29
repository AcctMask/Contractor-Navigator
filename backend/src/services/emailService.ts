export async function sendAlertEmail(
  to: string,
  subject: string,
  text: string
) {
  try {
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.EMAIL_FROM || "Contractor Autopilot <info@g2groofing.com>"

    if (!apiKey) {
      throw new Error("RESEND_API_KEY is required")
    }

    if (!to) {
      throw new Error("Email recipient is required")
    }

    console.log("📧 RESEND EMAIL ATTEMPT")
    console.log("TO:", to)
    console.log("FROM:", from)
    console.log("SUBJECT:", subject)

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        text,
      }),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(
        data?.message || data?.error || `Resend failed with status ${response.status}`
      )
    }

    console.log("✅ RESEND EMAIL SENT")
    console.log(data)

    return { ok: true, result: data }
  } catch (err: any) {
    console.error("❌ RESEND EMAIL FAILED")
    console.error(err)

    return { ok: false, error: err?.message || String(err) }
  }
}
