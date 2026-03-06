import { pool } from "../db/db";
import { sendEscalationEmail } from "./escalationEmail";
function toStr(x) {
    return typeof x === "string" ? x : "";
}
function normalizeStage(stageRaw) {
    const s = stageRaw.trim().toLowerCase();
    // JobProgress labels may vary; add to this mapping as we see your exact names
    if (s.includes("lead"))
        return "lead";
    if (s.includes("work auth"))
        return "work_auth_sent";
    if (s.includes("estimate"))
        return "estimate_sent";
    if (s.includes("contract"))
        return "contract_sent";
    if (s.includes("final") || s.includes("paid") || s.includes("complete"))
        return "final_paid";
    return "unknown";
}
function sequenceForStage(stage) {
    switch (stage) {
        case "lead":
            return "lead_followup";
        case "work_auth_sent":
            return "work_auth_followup";
        case "estimate_sent":
            return "estimate_followup";
        case "contract_sent":
            return "contract_followup";
        case "final_paid":
            return "referral_engine";
        default:
            return null;
    }
}
function containsAny(text, needles) {
    const t = text.toLowerCase();
    return needles.some((n) => t.includes(n));
}
async function timeline(tenantId, kind, message, meta = {}) {
    await pool.query(`insert into timeline_events (tenant_id, kind, message, meta)
     values ($1, $2, $3, $4::jsonb)`, [tenantId, kind, message, JSON.stringify(meta ?? {})]);
}
async function upsertJobFromStageChange(tenantId, payload, canonStage) {
    const jobId = toStr(payload?.job_id) || toStr(payload?.external_job_id) || "";
    if (!jobId) {
        await timeline(tenantId, "job_upsert_skipped", "missing job_id in payload", { payload });
        return null;
    }
    // Basic location fields (optional)
    const address1 = toStr(payload?.address1);
    const city = toStr(payload?.city);
    const state = toStr(payload?.state);
    const zip = toStr(payload?.zip);
    // Upsert by (tenant_id, external_job_id) pattern using a SELECT+UPDATE/INSERT for now
    // (We can add a unique index later.)
    const existing = await pool.query(`select id from jobs where tenant_id=$1 and external_job_id=$2 limit 1`, [tenantId, jobId]);
    if (existing.rowCount) {
        const id = existing.rows[0].id;
        await pool.query(`update jobs
       set stage=$1,
           external_crm='jobprogress',
           address1=coalesce(nullif($2,''), address1),
           city=coalesce(nullif($3,''), city),
           state=coalesce(nullif($4,''), state),
           zip=coalesce(nullif($5,''), zip),
           updated_at=now()
       where id=$6`, [canonStage, address1, city, state, zip, id]);
        await timeline(tenantId, "job_updated", `job ${jobId} stage=${canonStage}`, {
            job_id: jobId,
            stage: canonStage,
        });
        return { id: Number(id), external_job_id: jobId };
    }
    const inserted = await pool.query(`insert into jobs (tenant_id, external_crm, external_job_id, stage, address1, city, state, zip)
     values ($1, 'jobprogress', $2, $3, nullif($4,''), nullif($5,''), nullif($6,''), nullif($7,''))
     returning id`, [tenantId, jobId, canonStage, address1, city, state, zip]);
    const newId = inserted.rows[0].id;
    await timeline(tenantId, "job_created", `job ${jobId} stage=${canonStage}`, {
        job_id: jobId,
        stage: canonStage,
    });
    return { id: Number(newId), external_job_id: jobId };
}
async function startOrUpdateAutomation(tenantId, jobDbId, sequenceKey) {
    // If an active automation exists for this job+sequence, keep it; else create fresh active state.
    const existing = await pool.query(`select id, status, step_index from automation_state
     where tenant_id=$1 and job_id=$2 and sequence_key=$3
     order by id desc
     limit 1`, [tenantId, jobDbId, sequenceKey]);
    if (existing.rowCount) {
        const row = existing.rows[0];
        const id = row.id;
        await pool.query(`update automation_state
       set status='active', updated_at=now()
       where id=$1`, [id]);
        await timeline(tenantId, "automation_resumed", `${sequenceKey} (job_id=${jobDbId})`, {
            automation_id: Number(id),
            sequence_key: sequenceKey,
        });
        return;
    }
    await pool.query(`insert into automation_state (tenant_id, job_id, sequence_key, status, step_index, next_run_at)
     values ($1, $2, $3, 'active', 0, now())`, [tenantId, jobDbId, sequenceKey]);
    await timeline(tenantId, "automation_started", `${sequenceKey} (job_id=${jobDbId})`, {
        sequence_key: sequenceKey,
    });
}
export async function runDecisionMatrix(e) {
    // Always log receipt
    await timeline(e.tenantId, "event_received", `${e.source}:${e.eventType}`, {
        occurred_at: e.occurredAtISO,
        payload: e.payload,
    });
    // v2: Handle JobProgress stage change
    if (e.source === "jobprogress" && e.eventType === "stage_changed") {
        const toStageRaw = toStr(e.payload?.to) || toStr(e.payload?.stage) || "";
        const canonStage = normalizeStage(toStageRaw);
        await timeline(e.tenantId, "stage_mapped", `${toStageRaw} -> ${canonStage}`, {
            to: toStageRaw,
            canonical: canonStage,
        });
        const job = await upsertJobFromStageChange(e.tenantId, e.payload, canonStage);
        const seq = sequenceForStage(canonStage);
        if (job && seq) {
            await startOrUpdateAutomation(e.tenantId, job.id, seq);
        }
    }
    // Escalation (still simple keyword-based)
    const payloadStr = JSON.stringify(e.payload ?? {});
    const escalationNeedles = [
        "ready to move forward",
        "send contract",
        "i'll sign",
        "i will sign",
        "deposit",
        "down payment",
        "if you can do it for",
        "attorney",
        "lawyer",
        "sue",
        "refund",
        "stop",
        "do not contact",
    ];
    const shouldEscalate = containsAny(payloadStr, escalationNeedles);
    if (shouldEscalate) {
        const subject = `Autopilot Escalation: ${e.source} ${e.eventType}`;
        const text = `Escalation triggered.\n\n` +
            `Source: ${e.source}\n` +
            `Event: ${e.eventType}\n` +
            `Occurred: ${e.occurredAtISO}\n\n` +
            `Payload:\n${payloadStr}\n`;
        // If SMTP isn’t ready, this may error — so allow DISABLE_EMAIL dev mode
        if (process.env.DISABLE_EMAIL === "true") {
            await timeline(e.tenantId, "escalation_skipped", subject, { reason: "DISABLE_EMAIL=true" });
        }
        else {
            await sendEscalationEmail(subject, text);
            await timeline(e.tenantId, "escalation_sent", subject, {});
        }
    }
    return { ok: true, escalated: shouldEscalate };
}
//# sourceMappingURL=decisionMatrix.js.map