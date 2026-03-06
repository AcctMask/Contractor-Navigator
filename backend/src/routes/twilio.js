import { FastifyInstance } from "fastify";
import { pool } from "../db/db";
import { addDnc, classifyInboundText, normPhone } from "../services/dnc";
async function getTenantIdBySlug(slug) {
    const t = await pool.query(`select id from tenants where slug=$1`, [slug]);
    if (!t.rowCount)
        throw new Error(`tenant not found: ${slug}`);
    return Number(t.rows[0].id);
}
async function timeline(tenantId, kind, message, meta = {}) {
    await pool.query(`insert into timeline_events (tenant_id, kind, message, meta)
     values ($1,$2,$3,$4::jsonb)`, [tenantId, kind, message, JSON.stringify(meta)]);
}
/**
 * Twilio will POST form-encoded by default for inbound SMS.
 * Fastify can parse it if you enable content-type parser (we’ll do that in index.ts next).
 */
export async function twilioRoutes(app) {
    app.post("/twilio/inbound/sms", async (req) => {
        const body = req.body || {};
        // Twilio standard fields
        const from = normPhone(String(body.From || body.from || ""));
        const to = normPhone(String(body.To || body.to || ""));
        const text = String(body.Body || body.body || "");
        // Tenant routing:
        // For now default to g2g-roofing. Later we can map "To" number -> tenant.
        const tenantSlug = String(req.headers["x-tenant-slug"] || "g2g-roofing");
        const tenantId = await getTenantIdBySlug(tenantSlug);
        await timeline(tenantId, "inbound_sms", `Inbound SMS from ${from}`, {
            from,
            to,
            text,
        });
        const classification = classifyInboundText(text);
        if (classification.optOut) {
            await addDnc({ tenantId, phone: from, reason: "opt_out", source: "sms" });
            await timeline(tenantId, "opt_out", `Opt-out detected for ${from}`, { from, to, text });
            // Twilio doesn't require a response body, but returning ok is fine.
            return { ok: true, action: "dnc_added" };
        }
        if (classification.foul) {
            await timeline(tenantId, "foul_language", `Foul language detected from ${from}`, { from, to, text });
            // Not auto-DNC, just flag. You can decide policy later.
            return { ok: true, action: "flagged" };
        }
        return { ok: true };
    });
}
//# sourceMappingURL=twilio.js.map