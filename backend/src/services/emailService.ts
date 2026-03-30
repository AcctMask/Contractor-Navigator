import nodemailer from "nodemailer";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ MISSING ENV: ${name}`);
    throw new Error(`${name} is required`);
  }
  return v;
}

const transporter = nodemailer.createTransport({
  host: required("SMTP_HOST"),
  port: Number(required("SMTP_PORT")),
  secure: false,
  auth: {
    user: required("SMTP_USER"),
    pass: required("SMTP_PASS"),
  },
});

export async function sendAlertEmail(
  to: string,
  subject: string,
  text: string
) {
  try {
    console.log("📧 EMAIL ATTEMPT");
    console.log("TO:", to);
    console.log("SUBJECT:", subject);

    const from = required("SMTP_FROM") || required("SMTP_USER");

    const result = await transporter.sendMail({
      to,
      from,
      subject,
      text,
    });

    console.log("✅ EMAIL SENT SUCCESS");
    console.log(result);

    return { ok: true, result };
  } catch (err: any) {
    console.error("❌ EMAIL FAILED");
    console.error(err);

    return { ok: false, error: err?.message || err };
  }
}
