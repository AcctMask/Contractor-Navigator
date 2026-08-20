function escapeHtml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

export async function sendActualAssistantNavigatorEmail(
  params: {
    to: string
    subject: string
    heading: string
    lines: string[]
    buttonLabel?: string
    buttonUrl?: string
  }
) {
  try {
    const apiKey =
      process.env.RESEND_API_KEY

    const from =
      process.env.ACTUAL_ASSISTANT_EMAIL_FROM ||
      "Actual Assistant <support@actualassistance.com>"

    const replyTo =
      "support@actualassistance.com"

    if (!apiKey) {
      throw new Error(
        "RESEND_API_KEY is required"
      )
    }

    const to =
      String(params.to || "").trim()

    if (!to) {
      throw new Error(
        "Email recipient is required"
      )
    }

    const subject =
      String(params.subject || "").trim()

    const heading =
      String(params.heading || "").trim()

    const lines =
      Array.isArray(params.lines)
        ? params.lines
        : []

    const buttonLabel =
      String(
        params.buttonLabel || ""
      ).trim()

    const buttonUrl =
      String(
        params.buttonUrl || ""
      ).trim()

    const plainText = [
      heading,
      "",
      ...lines,
      buttonUrl ? "" : null,
      buttonUrl
        ? `${buttonLabel || "Open"}: ${buttonUrl}`
        : null,
      "",
      "Actual Assistant",
      "support@actualassistance.com",
    ]
      .filter(
        (value) =>
          value !== null &&
          value !== undefined
      )
      .join("\n")

    const htmlLines =
      lines
        .map(
          (line) =>
            `<p style="margin:0 0 12px;">${escapeHtml(
              line
            )}</p>`
        )
        .join("")

    const buttonHtml =
      buttonUrl
        ? `
          <p style="margin:26px 0;">
            <a
              href="${escapeHtml(buttonUrl)}"
              style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:10px;"
            >
              ${escapeHtml(
                buttonLabel ||
                "Open"
              )}
            </a>
          </p>
        `
        : ""

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:680px;margin:0 auto;">
        <div style="font-size:14px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;margin-bottom:14px;">
          Actual Assistant
        </div>

        <h2 style="margin:0 0 18px;">
          ${escapeHtml(heading)}
        </h2>

        ${htmlLines}
        ${buttonHtml}

        <p style="margin-top:28px;color:#6b7280;font-size:13px;">
          Actual Assistant<br />
          support@actualassistance.com
        </p>
      </div>
    `

    const response =
      await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${apiKey}`,
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            from,
            to,
            subject,
            text: plainText,
            html,
            reply_to: replyTo,
          }),
        }
      )

    const data =
      await response
        .json()
        .catch(() => ({}))

    if (!response.ok) {
      throw new Error(
        data?.message ||
        data?.error ||
        `Resend failed with status ${response.status}`
      )
    }

    console.log(
      "✅ ACTUAL ASSISTANT NAVIGATOR EMAIL SENT",
      {
        to,
        subject,
        result: data,
      }
    )

    return {
      ok: true,
      result: data,
    }
  } catch (error: any) {
    console.error(
      "❌ ACTUAL ASSISTANT NAVIGATOR EMAIL FAILED",
      error
    )

    return {
      ok: false,
      error:
        error?.message ||
        String(error),
    }
  }
}


export async function sendAlertEmail(
  to: string,
  subject: string,
  text: string,
  options?: {
    cc?: string | string[]
    bcc?: string | string[]
  }
) {
  try {
    const apiKey = process.env.RESEND_API_KEY
    const from =
      process.env.EMAIL_FROM || "Contractor Autopilot <info@g2groofing.com>"

    if (!apiKey) {
      throw new Error("RESEND_API_KEY is required")
    }

    if (!to) {
      throw new Error("Email recipient is required")
    }

    const safeSubject = subject || "Contractor Autopilot Alert"
    const safeText =
      text && text.trim().length > 0
        ? text
        : "New customer activity was detected. Please review the Contractor Autopilot dashboard."

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
        <h2 style="margin-bottom: 12px;">Contractor Autopilot Alert</h2>
        <p><strong>Subject:</strong> ${escapeHtml(safeSubject)}</p>
        <div style="white-space: pre-wrap; background: #f3f4f6; padding: 16px; border-radius: 8px;">
          ${escapeHtml(safeText)}
        </div>
        <p style="margin-top: 18px; color: #6b7280; font-size: 13px;">
          This alert was generated by Contractor Autopilot.
        </p>
      </div>
    `

    console.log("📧 RESEND EMAIL ATTEMPT")
    console.log("TO:", to)
    console.log("CC:", options?.cc || "")
    console.log("BCC:", options?.bcc || "")
    console.log("FROM:", from)
    console.log("SUBJECT:", safeSubject)
    console.log("TEXT LENGTH:", safeText.length)

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        ...(options?.cc ? { cc: options.cc } : {}),
        ...(options?.bcc ? { bcc: options.bcc } : {}),
        subject: safeSubject,
        text: safeText,
        html,
        reply_to: "info@g2groofing.com",
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


export async function sendCustomerAcknowledgmentEmail(
  to: string,
  customerName: string,
  details?: {
    propertyAddress?: string | null
    sourceDetail?: string | null
  }
) {
  try {
    const apiKey = process.env.RESEND_API_KEY
    const from =
      process.env.EMAIL_FROM ||
      "Good2Go Roofing <info@g2groofing.com>"

    if (!apiKey) {
      throw new Error("RESEND_API_KEY is required")
    }

    if (!to) {
      throw new Error("Customer email recipient is required")
    }

    const safeCustomerName =
      String(customerName || "").trim() || "there"

    const propertyAddress =
      String(details?.propertyAddress || "").trim()

    const text = [
      `Hi ${safeCustomerName},`,
      "",
      "Thank you for contacting Good2Go Roofing & Construction.",
      "We received your request and a member of our team will review it and follow up with you.",
      propertyAddress
        ? `Property: ${propertyAddress}`
        : null,
      "",
      "You may reply directly to this email with any questions, photographs, documents, or additional information.",
      "",
      "Good2Go Roofing & Construction",
      "www.g2groofing.com",
    ]
      .filter(Boolean)
      .join("\n")

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 680px;">
        <h2 style="margin-bottom: 14px;">
          We received your request
        </h2>

        <p>Hi ${escapeHtml(safeCustomerName)},</p>

        <p>
          Thank you for contacting Good2Go Roofing &amp; Construction.
          We received your request and a member of our team will review it
          and follow up with you.
        </p>

        ${
          propertyAddress
            ? `<p><strong>Property:</strong> ${escapeHtml(propertyAddress)}</p>`
            : ""
        }

        <p>
          You may reply directly to this email with any questions,
          photographs, documents, or additional information.
        </p>

        <p style="margin-top: 24px;">
          <strong>Good2Go Roofing &amp; Construction</strong><br />
          www.g2groofing.com
        </p>
      </div>
    `

    const response = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to,
          subject:
            "Good2Go Roofing received your request",
          text,
          html,
          reply_to: "info@g2groofing.com",
        }),
      }
    )

    const data =
      await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(
        data?.message ||
          data?.error ||
          `Resend failed with status ${response.status}`
      )
    }

    console.log(
      "✅ CUSTOMER ACKNOWLEDGMENT EMAIL SENT",
      {
        to,
        result: data,
      }
    )

    return {
      ok: true,
      result: data,
    }
  } catch (error: any) {
    console.error(
      "❌ CUSTOMER ACKNOWLEDGMENT EMAIL FAILED",
      error
    )

    return {
      ok: false,
      error: error?.message || String(error),
    }
  }
}
