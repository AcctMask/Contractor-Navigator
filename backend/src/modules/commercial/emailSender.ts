function escapeHtml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

/**
 * Send commercial email with unsubscribe link
 */
export async function sendCommercialEmail(
  to: string,
  subject: string,
  text: string,
  targetId: string
) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM || "Good2Go Roofing <info@g2groofing.com>"

  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is required" }
  }

  if (!to) {
    return { ok: false, error: "Email recipient is required" }
  }

  const safeSubject = subject || "Good2Go Roofing"
  const safeText = text || ""

  // 🔗 IMPORTANT — LIVE unsubscribe link
  const unsubscribeLink = `https://contractor-navigator.vercel.app/commercial/unsubscribe/${targetId}`

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.55; color: #111827; font-size: 15px;">
      
      <div style="white-space: pre-wrap;">
        ${escapeHtml(safeText)}
      </div>

      <p style="margin-top: 18px;">
        Steve Pashoian<br />
        Good2Go Roofing & Construction<br />
        855-766-3246<br />
        info@g2groofing.com
      </p>

      <hr style="margin:20px 0; border:none; border-top:1px solid #e5e7eb;" />

      <p style="font-size:12px; color:#6b7280;">
        If you do not want to receive emails from Good2Go Roofing,
        <a href="${unsubscribeLink}" style="color:#2563eb;">
          click here to unsubscribe
        </a>.
      </p>

    </div>
  `

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: safeSubject,
      text: safeText,
      html,
      reply_to: "info@g2groofing.com",
    }),
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    return {
      ok: false,
      error: data?.message || data?.error || `Resend failed with status ${response.status}`,
    }
  }

  return { ok: true, result: data }
}
