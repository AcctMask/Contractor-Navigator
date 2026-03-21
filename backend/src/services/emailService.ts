import nodemailer from "nodemailer"

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // TLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export async function sendAlertEmail(
  to: string,
  subject: string,
  text: string
) {
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
    })

    return {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    }
  } catch (err: any) {
    console.error("Email send error:", err)

    return {
      error: err?.message || String(err),
    }
  }
}
