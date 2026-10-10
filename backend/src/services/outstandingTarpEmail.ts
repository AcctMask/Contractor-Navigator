import { pool } from "../db/db"
import { getTenantIdBySlug } from "./followupEngine"
import { sendAlertEmail } from "./emailService"

const TEST_RECIPIENT = "good2goroofingandconstruction@gmail.com"
const JOB_URL = "https://contractor-navigator.vercel.app/job/"

type Row = {
  job_id: number
  location: string
  customer_name: string
  subcontractor_id: number | null
  subcontractor: string
  crew: string | null
  section: "not_complete" | "pending_photos"
  days: number | null
}

type Subcontractor = { id: number; name: string }

function isHarry(name: string): boolean {
  return ["harry pashoian", "harry"].includes(
    name.trim().toLowerCase().replace(/\s+/g, " ")
  )
}

function ageDays(value: unknown): number | null {
  if (!value) return null
  const ms = new Date(String(value)).getTime()
  if (!Number.isFinite(ms)) return null
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000))
}

export async function listTarpSubcontractors(): Promise<Subcontractor[]> {
  const tenantId = await getTenantIdBySlug("g2g-roofing")

  const result = await pool.query(
    `select name, user_id
     from (
       select
         sc.company_name as name,
         null::bigint as user_id
       from subcontractor_companies sc
       where sc.tenant_id = $1

       union all

       select
         coalesce(u.full_name, u.email) as name,
         u.id as user_id
       from app_users u
       where u.tenant_id = $1
         and u.role = 'subcontractor'
         and u.is_active = true
         and not exists (
           select 1
           from subcontractor_company_users scu
           where scu.app_user_id = u.id
         )
     ) directory
     where nullif(trim(name), '') is not null
     order by lower(name)`,
    [tenantId]
  )

  const seen = new Set<string>()

  return result.rows
    .filter(r => !isHarry(String(r.name)))
    .filter(r => {
      const key = String(r.name).trim().toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(r => ({
      id: r.user_id ? Number(r.user_id) : 0,
      name: String(r.name)
    }))
}
export async function collectOutstandingTarps(): Promise<Row[]> {
  const tenantId = await getTenantIdBySlug("g2g-roofing")

  // Historical production databases may lack this optional
  // assignment column. Inspection only; no schema changes.
  const columnResult = await pool.query(
    `select column_name
     from information_schema.columns
     where table_schema = current_schema()
       and table_name = 'crew_assignments'`
  )
  const hasUserId = columnResult.rows.some(
    r => r.column_name === "app_user_id"
  )

  const assignmentUser = hasUserId
    ? "app_user_id"
    : "NULL::bigint AS app_user_id"

  const subcontractorJoin = hasUserId
    ? `left join app_users sub
         on sub.id = ca.app_user_id
        and sub.tenant_id = j.tenant_id
        and sub.role = 'subcontractor'
       left join subcontractor_company_users scu_owner
         on scu_owner.app_user_id = sub.id
       left join subcontractor_companies sc_owner
         on sc_owner.id = scu_owner.subcontractor_company_id
        and sc_owner.tenant_id = j.tenant_id`
    : ""

  const subcontractorName = hasUserId
    ? "coalesce(sc_owner.company_name, sub.full_name, ca.crew_name, 'UNASSIGNED')"
    : "coalesce(ca.crew_name, 'UNASSIGNED')"

  const crewJoin = hasUserId
    ? `left join lateral (
         select string_agg(distinct m.full_name, ', ') as names
         from workforce_crew_job_assignments a
         join workforce_crew_members m
           on m.id = a.crew_member_id
          and m.tenant_id = a.tenant_id
          and m.subcontractor_company_id = a.subcontractor_company_id
          and m.is_active = true
         join subcontractor_company_users scu
           on scu.subcontractor_company_id = a.subcontractor_company_id
          and scu.app_user_id = ca.app_user_id
         where a.tenant_id = j.tenant_id
           and a.job_id = j.id
           and a.status = 'active'
       ) crew on true`
    : "left join lateral (select null::text as names) crew on true"

  const result = await pool.query(`
    select
      j.id,
      c.full_name as customer_name,
      j.stage,
      j.address1,
      j.city,
      j.state,
      j.zip,
      j.current_stage_entered_at,
      ca.app_user_id,
      ca.assigned_at,
      ${subcontractorName} as subcontractor,
      completed.completed_at,
      coalesce(photos.photo_count, 0) as photo_count,
      crew.names as crew_names
    from jobs j
    left join customers c on c.id = j.customer_id and c.tenant_id = j.tenant_id
    left join lateral (
      select ${assignmentUser}, assigned_at, crew_name
      from crew_assignments
      where tenant_id = j.tenant_id
        and job_id = j.id
        and status in ('PENDING', 'active')
      order by assigned_at desc nulls last, id desc
      limit 1
    ) ca on true
    ${subcontractorJoin}
    left join lateral (
      select max(created_at) as completed_at
      from timeline_events
      where tenant_id = j.tenant_id
        and job_id = j.id
        and kind = 'manual_stage_updated'
        and meta->>'action' in (
          'tarp_completed', 'tarp_administratively_closed'
        )
    ) completed on true
    left join lateral (
      select count(*)::int as photo_count
      from job_assets ja
      where ja.tenant_id = j.tenant_id
        and ja.job_id = j.id
        and ja.asset_type = 'photo'
        and (
          lower(coalesce(ja.asset_category, '')) = 'tarp'
          or ja.created_at >= completed.completed_at
        )
    ) photos on true
    ${crewJoin}
    where j.tenant_id = $1
      and j.stage in ('tarp', 'tarp_complete')
      and j.id <> 515
    order by j.id
  `, [tenantId])

  return result.rows
    .filter(job =>
      job.stage === "tarp" ||
      (job.stage === "tarp_complete" &&
       Number(job.photo_count) === 0)
    )
    .filter(job => !isHarry(String(job.subcontractor || "")))
    .map(job => ({
      job_id: Number(job.id),
      customer_name: String(job.customer_name || "Not recorded"),
      location: [
        job.address1, job.city, job.state, job.zip
      ].filter(Boolean).join(", "),
      subcontractor_id: job.app_user_id
        ? Number(job.app_user_id) : null,
      subcontractor: String(job.subcontractor || "UNASSIGNED"),
      crew: job.crew_names || null,
      section: job.stage === "tarp"
        ? "not_complete" as const
        : "pending_photos" as const,
      days: ageDays(
        job.stage === "tarp"
          ? job.assigned_at || job.current_stage_entered_at
          : job.completed_at
      )
    }))
}

function detail(title: string, rows: Row[]): string[] {
  const lines = [title + " (" + rows.length + ")", ""]
  if (!rows.length) return [...lines, "  None", ""]

  for (const job of [...rows].sort(
    (a, b) => (b.days ?? -1) - (a.days ?? -1) || a.job_id - b.job_id
  )) {
    lines.push(
      "  Job #" + job.job_id + " | " +
        (job.days === null ? "Age unknown" : job.days + " days"),
      "  Customer: " + job.customer_name,
      "  Address: " + (job.location || "Not recorded"),
      "  Open job: " + JOB_URL + job.job_id,
      ""
    )
  }
  return lines
}

export function formatOfficeTarpReport(
  rows: Row[],
  roster: Subcontractor[]
): string {
  const groups = new Map<string, { name: string; jobs: Row[] }>()
  const normalize = (name: string) => name.trim().toLowerCase()

  for (const sub of roster) {
    const key = normalize(sub.name)
    if (!groups.has(key)) groups.set(key, { name: sub.name, jobs: [] })
  }

  for (const row of rows) {
    const name = row.subcontractor || "UNASSIGNED"
    const key = normalize(name)
    if (!groups.has(key)) groups.set(key, { name, jobs: [] })
    groups.get(key)!.jobs.push(row)
  }

  const sorted = [...groups.values()].sort((a, b) =>
    a.name === "UNASSIGNED" ? 1 :
    b.name === "UNASSIGNED" ? -1 :
    a.name.localeCompare(b.name)
  )

  const openTotal = rows.filter(r => r.section === "not_complete").length
  const photoTotal = rows.filter(r => r.section === "pending_photos").length

  const lines = [
    "GOOD2GO ROOFING & CONSTRUCTION",
    "OUTSTANDING TARP WORK - MASTER REPORT",
    "Generated: " + new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      dateStyle: "medium",
      timeStyle: "short"
    }) + " Eastern",
    "",
    "SUBCONTRACTOR SUMMARY",
    "--------------------------------------------------"
  ]

  for (const group of sorted) {
    const open = group.jobs.filter(r => r.section === "not_complete").length
    const photos = group.jobs.filter(r => r.section === "pending_photos").length
    lines.push(
      group.name,
      "  Not Complete: " + open +
      " | Photos Needed: " + photos +
      " | Total: " + group.jobs.length
    )
  }

  lines.push("", "========================================", "JOB DETAILS")

  for (const group of sorted) {
    const open = group.jobs.filter(r => r.section === "not_complete")
    const photos = group.jobs.filter(r => r.section === "pending_photos")

    lines.push(
      "",
      "----------------------------------------",
      group.name.toUpperCase(),
      "TOTAL OUTSTANDING: " + group.jobs.length,
      "----------------------------------------",
      ...detail("TARP ASSIGNED / NOT COMPLETE", open),
      ...detail("TARP COMPLETE / PHOTOS NEEDED", photos)
    )
  }

  lines.push(
    "",
    "========================================",
    "GOOD2GO GRAND TOTAL",
    "Not Complete: " + openTotal,
    "Photos Needed: " + photoTotal,
    "TOTAL OUTSTANDING: " + rows.length,
    "========================================",
    "",
    "Photo classification is based on available Navigator records.",
    "This report does not signify office approval or carrier submission."
  )

  return lines.join("\n")
}


function escapeReportHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

export function formatOfficeTarpHtml(
  rows: Row[],
  roster: Subcontractor[]
): string {
  const groups = new Map<string, { name: string; jobs: Row[] }>()
  const normalize = (name: string) => name.trim().toLowerCase()

  for (const sub of roster) {
    const key = normalize(sub.name)
    if (!groups.has(key)) groups.set(key, { name: sub.name, jobs: [] })
  }

  for (const job of rows) {
    const name = job.subcontractor || "UNASSIGNED"
    const key = normalize(name)
    if (!groups.has(key)) groups.set(key, { name, jobs: [] })
    groups.get(key)!.jobs.push(job)
  }

  const sorted = [...groups.values()].sort((a, b) =>
    a.name === "UNASSIGNED" ? 1 :
    b.name === "UNASSIGNED" ? -1 :
    a.name.localeCompare(b.name)
  )

  const e = escapeReportHtml
  const cell = 'padding:9px 7px;border-bottom:1px solid #e5e7eb;vertical-align:top;'
  const num = cell + 'text-align:right;white-space:nowrap;'
  const numeric = (n: number) => `<td style="${num}">${n}</td>`
  const empty = () => numeric(0)
  const tr: string[] = []

  const details = (jobs: Row[], title: string) => {
    if (!jobs.length) return

    tr.push(
      `<tr><td colspan="5" style="padding:9px 7px;background:#f3f4f6;` +
      `font-size:11px;font-weight:700;">${e(title)}</td></tr>`
    )

    for (const job of [...jobs].sort(
      (a, b) => (b.days ?? -1) - (a.days ?? -1) || a.job_id - b.job_id
    )) {
      const url = JOB_URL + job.job_id
      tr.push(
        `<tr>` +
        `<td style="${cell}">` +
        `<strong>${e(job.customer_name)}</strong> — ` +
        `<a href="${e(url)}">#${job.job_id}</a>` +
        `<div style="font-size:11px;color:#6b7280;">${e(job.location || "Address not recorded")}</div>` +
        (job.crew ? `<div style="font-size:11px;">Crew: ${e(job.crew)}</div>` : "") +
        `</td>` +
        empty() + empty() + empty() +
        numeric(job.days ?? 0) +
        `</tr>`
      )
    }
  }

  for (const group of sorted) {
    const open = group.jobs.filter(j => j.section === "not_complete")
    const photos = group.jobs.filter(j => j.section === "pending_photos")

    tr.push(
      `<tr style="background:#e8eef8;font-weight:700;">` +
      `<td style="${cell}">${e(group.name)}</td>` +
      numeric(open.length) +
      numeric(photos.length) +
      numeric(group.jobs.length) +
      empty() +
      `</tr>`
    )

    details(open, "TARP ASSIGNED / NOT COMPLETE")
    details(photos, "TARP COMPLETE / PHOTOS NEEDED")

    if (!group.jobs.length) {
      tr.push(
        `<tr><td style="${cell}color:#6b7280;">No outstanding tarp jobs</td>` +
        empty() + empty() + empty() + empty() + `</tr>`
      )
    }
  }

  const openTotal = rows.filter(j => j.section === "not_complete").length
  const photoTotal = rows.filter(j => j.section === "pending_photos").length

  tr.push(
    `<tr style="background:#dbeafe;font-weight:800;">` +
    `<td style="${cell}">GRAND TOTAL</td>` +
    numeric(openTotal) +
    numeric(photoTotal) +
    numeric(rows.length) +
    empty() +
    `</tr>`
  )

  const generated = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short"
  })

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:18px;background:#ffffff;
font-family:Arial,sans-serif;color:#111827;">
<div style="max-width:850px;margin:auto;">
<h2 style="margin:0 0 5px;">GOOD2GO ROOFING &amp; CONSTRUCTION</h2>
<h3 style="margin:0 0 8px;">Outstanding Tarp Report</h3>
<p style="font-size:12px;color:#6b7280;">
Generated: ${e(generated)} Eastern
</p>
<table cellpadding="0" cellspacing="0" width="100%"
style="border-collapse:collapse;font-size:12px;table-layout:auto;">
<thead><tr style="background:#14294b;color:#ffffff;">
<th style="padding:10px 7px;text-align:left;">Subcontractor / Customer</th>
<th style="padding:10px 7px;text-align:right;">Not Complete</th>
<th style="padding:10px 7px;text-align:right;">Photos Needed</th>
<th style="padding:10px 7px;text-align:right;">Total</th>
<th style="padding:10px 7px;text-align:right;">Days</th>
</tr></thead>
<tbody>${tr.join("\n")}</tbody>
</table>
<p style="font-size:11px;color:#6b7280;margin-top:16px;">
Operational notification. Photo classification is based on available
Navigator records. This report does not signify office approval
or carrier submission.
</p>
</div></body></html>`
}

export async function sendOfficeTarpTest() {
  const [rows, roster] = await Promise.all([
    collectOutstandingTarps(),
    listTarpSubcontractors()
  ])

  const subject = "[TEST] Good2Go Outstanding Tarp Work — Master Report"
  const html = formatOfficeTarpHtml(rows, roster)
  const text = formatOfficeTarpReport(rows, roster)

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error("RESEND_API_KEY is required")

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ||
        "Contractor Autopilot <info@g2groofing.com>",
      to: TEST_RECIPIENT,
      subject,
      text,
      html,
      reply_to: "info@g2groofing.com"
    })
  })

  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      (result as any)?.message ||
      `Resend failed with status ${response.status}`
    )
  }

  return {
    ok: true,
    error: null as string | null,
    result,
    recipient: TEST_RECIPIENT,
    subcontractors: roster.length,
    total: rows.length,
    not_complete: rows.filter(
      r => r.section === "not_complete"
    ).length,
    pending_photos: rows.filter(
      r => r.section === "pending_photos"
    ).length,
    subcontractor_emails_sent: 0,
    daily_sending_enabled: false
  }
}


/**
 * Daily tarp delivery recipient plan.
 * Read-only: no emails, database mutations, or scheduling.
 * All recipients use the existing universal report renderers.
 */
export async function previewDailyTarpRecipients() {
  const tenantId = await getTenantIdBySlug("g2g-roofing")
  const [rows, roster] = await Promise.all([
    collectOutstandingTarps(),
    listTarpSubcontractors()
  ])

  const users = await pool.query(
    `select id, email, full_name
       from app_users
      where tenant_id = $1
        and role = 'subcontractor'
        and is_active = true
        and nullif(trim(email), '') is not null`,
    [tenantId]
  )

  const seenEmails = new Set<string>()
  for (const user of users.rows) {
    const email = String(user.email).trim().toLowerCase()
    if (seenEmails.has(email)) {
      throw new Error(
        "Duplicate subcontractor recipient email; delivery blocked"
      )
    }
    seenEmails.add(email)
  }

  const recipients = users.rows.flatMap(user => {
    const userId = Number(user.id)
    const assigned = rows.filter(
      row => row.subcontractor_id === userId
    )

    if (!assigned.length) return []

    const name = String(user.full_name || user.email)
    if (isHarry(name)) return []

    // Same universal layout; permissions restrict input rows.
    // Use the assigned job's existing display name so company
    // names remain consistent with the office report.
    const recipientRoster = [...new Map(
      assigned.map(row => [
        row.subcontractor.trim().toLowerCase(),
        { id: userId, name: row.subcontractor }
      ])
    ).values()]

    return [{
      user_id: userId,
      email: String(user.email).trim(),
      job_ids: assigned.map(row => row.job_id),
      total: assigned.length,
      html: formatOfficeTarpHtml(assigned, recipientRoster),
      text: formatOfficeTarpReport(assigned, recipientRoster)
    }]
  })

  return {
    office: {
      email: TEST_RECIPIENT,
      total: rows.length,
      html: formatOfficeTarpHtml(rows, roster),
      text: formatOfficeTarpReport(rows, roster)
    },
    subcontractors: recipients,
    unassigned_job_ids: rows
      .filter(row => row.subcontractor_id === null)
      .map(row => row.job_id),
    preview_only: true,
    emails_sent: 0
  }
}


/**
 * Controlled daily delivery.
 * Requires explicit enablement and a database delivery ledger.
 * Never runs on weekends or outside 7 AM America/New_York.
 */
export async function sendDailyOutstandingTarps() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date())

  const part = (type: string) =>
    parts.find(p => p.type === type)?.value || ""

  if (["Sat", "Sun"].includes(part("weekday")) ||
      part("hour") !== "07") {
    return { ok: false, skipped: "Outside weekday 7 AM Eastern" }
  }

  if (process.env.TARP_DAILY_EMAIL_ENABLED !== "true") {
    return { ok: false, skipped: "Daily tarp email disabled" }
  }

  const reportDate =
    `${part("year")}-${part("month")}-${part("day")}`

  const client = await pool.connect()

  try {
    await client.query(
      "select pg_advisory_lock(hashtext($1))",
      ["g2g-outstanding-tarps-daily-email"]
    )

    const table = await client.query(
      "select to_regclass('public.outstanding_tarp_email_deliveries') as name"
    )

    if (!table.rows[0]?.name) {
      throw new Error(
        "Daily tarp delivery ledger missing; no emails sent"
      )
    }

    const plan = await previewDailyTarpRecipients()

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) throw new Error("RESEND_API_KEY is required")

    const recipients = [
      {
        key: "office",
        email: plan.office.email,
        html: plan.office.html,
        text: plan.office.text
      },
      ...plan.subcontractors.map(sub => ({
        key: `subcontractor:${sub.user_id}`,
        email: sub.email,
        html: sub.html,
        text: sub.text
      }))
    ]

    const sent: string[] = []
    const skipped: string[] = []

    for (const recipient of recipients) {
      const claim = await client.query(
        `insert into outstanding_tarp_email_deliveries
           (report_date, recipient_key, email, status)
         values ($1, $2, $3, 'claimed')
         on conflict (report_date, recipient_key) do nothing
         returning recipient_key`,
        [reportDate, recipient.key, recipient.email]
      )

      if (!claim.rowCount) {
        skipped.push(recipient.key)
        continue
      }

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM ||
            "Contractor Autopilot <info@g2groofing.com>",
          to: recipient.email,
          subject: "Good2Go Outstanding Tarp Work — Daily Report",
          html: recipient.html,
          text: recipient.text,
          reply_to: "info@g2groofing.com"
        })
      })

      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        await client.query(
          `update outstanding_tarp_email_deliveries
              set status = 'failed', provider_response = $3
            where report_date = $1 and recipient_key = $2`,
          [
            reportDate,
            recipient.key,
            JSON.stringify(result).slice(0, 1000)
          ]
        )
        throw new Error(
          `Tarp email failed for ${recipient.key}: ${response.status}`
        )
      }

      await client.query(
        `update outstanding_tarp_email_deliveries
            set status = 'sent', provider_response = $3
          where report_date = $1 and recipient_key = $2`,
        [
          reportDate,
          recipient.key,
          JSON.stringify(result).slice(0, 1000)
        ]
      )

      sent.push(recipient.key)
    }

    return { ok: true, report_date: reportDate, sent, skipped }
  } finally {
    try {
      await client.query(
        "select pg_advisory_unlock(hashtext($1))",
        ["g2g-outstanding-tarps-daily-email"]
      )
    } finally {
      client.release()
    }
  }
}
