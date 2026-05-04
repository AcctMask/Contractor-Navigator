import { commercialPool as pool } from "./db";
import { classify } from "./classifier";
import { sendCommercialEmail } from "./emailSender";

function renderTemplate(value: string, target: any) {
  return String(value || "")
    .replaceAll("{{name}}", target.business_name || "there")
    .replaceAll("{{city}}", target.city || "")
    .replaceAll("{{state}}", target.state || "FL");
}

// -------- STATE → MESSAGE ENGINE --------

function getMessageByState(target: any) {
  const state = target.pipeline_status;

  if (state === "on_hook") {
    return {
      subject: "Re: Project",
      body: `Hi {{name}},

Got your message — happy to take a look.

If you have plans/specs, feel free to send them over and I’ll review right away. If easier, I can jump on a quick call to go through scope and timing.

– Steve
Good2Go Roofing`,
    };
  }

  if (state === "active") {
    return {
      subject: "Quick check-in",
      body: `Hi {{name}},

Just checking in — if anything comes up where you need roofing support in {{city}}, we’re available and can turn things around quickly.

Happy to take a look at anything you’re working on.

– Steve`,
    };
  }

  // default = working
  return {
    subject: "Roofing support if needed",
    body: `Hi {{name}},

Reaching out in case you ever need roofing support on a project in {{city}}, FL.

We work with GCs locally and handle repairs, replacements, and storm-related work.

If it’s not relevant now, no problem — just wanted to introduce ourselves.

– Steve
Good2Go Roofing`,
  };
}

// -------- PRIORITY ENGINE --------

function calculatePriority(target: any) {
  if (target.pipeline_status === "on_hook") return "high";
  if (target.pipeline_status === "active") return "medium";
  return "low";
}

// -------- IMPORT --------

export async function importCommercialTargets(rows: any[]) {
  let inserted = 0;
  let skipped = 0;
  let queued = 0;

  for (const r of rows) {
    if (!r.business_name) {
      skipped++;
      continue;
    }

    const existing = await pool.query(
      `
      select id from commercial_targets
      where lower(business_name) = lower($1)
        and coalesce(lower(city),'') = coalesce(lower($2),'')
      limit 1
      `,
      [r.business_name, r.city || ""]
    );

    if (existing.rowCount) {
      skipped++;
      continue;
    }

    const c = classify(r);

    const result = await pool.query(
      `
      insert into commercial_targets (
        business_name, city, state, email,
        target_type, campaign_priority, fit_score,
        pipeline_status, priority_level
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      returning *
      `,
      [
        r.business_name,
        r.city,
        "FL",
        r.email,
        c.type,
        c.priority,
        c.score,
        "working",
        "low",
      ]
    );

    inserted++;

    if (r.email) {
      await pool.query(
        `
        insert into commercial_email_queue (
          target_id, status, scheduled_at
        )
        values ($1,'pending',now())
        `,
        [result.rows[0].id]
      );
      queued++;
    }
  }

  return { inserted, skipped, queued };
}

// -------- SEND --------

export async function sendQueuedCommercialEmail(queueId: string) {
  const result = await pool.query(
    `
    select q.id, t.*
    from commercial_email_queue q
    join commercial_targets t on t.id = q.target_id
    where q.id = $1
    `,
    [queueId]
  );

  if (!result.rowCount) {
    return { ok: false, error: "Not found" };
  }

  const target = result.rows[0];

  if (!target.email) {
    return { ok: false, error: "No email" };
  }

  const msg = getMessageByState(target);

  const subject = renderTemplate(msg.subject, target);
  const body = renderTemplate(msg.body, target);

  const sendResult = await sendCommercialEmail(target.email, subject, body);

  if (!sendResult.ok) {
    await pool.query(
      `update commercial_email_queue set status='failed', error=$2 where id=$1`,
      [queueId, sendResult.error]
    );
    return sendResult;
  }

  // update lifecycle
  await pool.query(
    `
    update commercial_targets
    set
      touch_count = coalesce(touch_count,0)+1,
      priority_level = $2,
      last_touch_at = now(),
      updated_at = now()
    where id = $1
    `,
    [target.id, calculatePriority(target)]
  );

  await pool.query(
    `update commercial_email_queue set status='sent', sent_at=now() where id=$1`,
    [queueId]
  );

  return { ok: true, sent: true };
}

// -------- GROUPED VIEW (for UI) --------

export async function getPipelineView() {
  const rows = await pool.query(`
    select
      pipeline_status,
      count(*) as count
    from commercial_targets
    group by pipeline_status
  `);

  return rows.rows;
}
