import nodemailer from "nodemailer";
function required(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`${name} is required`);
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
export async function sendEscalationEmail(subject, text) {
    const to = required("ESCALATION_EMAIL_TO");
    const from = required("ESCALATION_EMAIL_FROM");
    await transporter.sendMail({
        to,
        from,
        subject,
        text,
    });
}
//# sourceMappingURL=escalationEmail.js.map