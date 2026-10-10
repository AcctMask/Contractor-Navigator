import { pool } from "../db/db"
import { getTenantIdBySlug } from "./followupEngine"
import { sendAlertEmail } from "./emailService"

const OFFICE = "info@g2groofing.com"
const JOB_URL = "https://contractor-navigator.vercel.app/job/"

function ageDays(value: unknown): number | null {
  if (!value) return null
  const date = new Date(String(value))
  if (!Number.isFinite(date.getTime())) return null
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000))
}

type Row = {
  job_id: number
  location: string
  subcontractor_id: number | null
  subcontractor: string
  crew: string | null
  section: "not_complete" | "pending_photos"
  days: number | null
}

export async function collectOutstandingTarps(): Promise<Row[]> {
  const tenantId = await getTenantIdBySlug("g2g-roofing")

  const result = await pool.query(`
    select
      j.id,
      j.stage,
      j.address1,
      j.city,
      j.state,
      j.zip,
      j.current_stage_entered_at,
      ca.app_user_id,
      ca.assigned_at,
      sub.full_name as subcontractor,
      completed.completed_at,
      coalesce(photos.photo_count, 0) as photo_count,
      crew.names as crew_names
    from jobs j
    left join lateral (
      select app_user_id, assigned_at
      from crew_assignments
      where tenant_id = j.tenant_id
        and job_id = j.id
        and status in ('PENDING', 'active')
      order by assigned_at desc nulls last, id desc
      limit 1
    ) ca on true
    left join app_users sub
      on sub.id = ca.app_user_id
     and sub.tenant_id = j.tenant_id
     and sub.role = 'subcontractor'
     and sub.is_active = true
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
      from job_assets
      where tenant_id = j.tenant_id
        and job_id = j.id
        and asset_type = 'photo'
        and (
          lower(coalesce(asset_category, '')) = 'tarp'
          or created_at >= completed.completed_at
        )
    ) photos on true
    left join lateral (
      select string_agg(distinct m.full_name, ', ') as names
      from workforce_crew_job_assignments a
      join workforce_crew_members m
        on m.id = a.crew_member_id
       and m.tenant_id = a.tenant_id
       and m.subcontractor_company_id =
           a.subcontractor_company_id
       and m.is_active = true
      join subcontractor_company_users scu
        on scu.subcontractor_company_id =
           a.subcontractor_company_id
       and scu.app_user_id = ca.app_user_id
      where a.tenant_id = j.tenant_id
        and a.job_id = j.id
        and a.status = 'active'
    ) crew on true
    where j.tenant_id = $1
      and j.stage in ('tarp', 'tarp_complete')
  `, [tenantId])

  const rows: Row[] = []

  for (const job of result.rows) {
    if (job.stage === "tarp_complete" &&
        Number(job.photo_count) > 0) continue

    rows.push({
      job_id: Number(job.id),
      location: [
        job.address1, job.city, job.state, job.zip
      ].filter(Boolean).join(", "),
      subcontractor_id: job.app_user_id
        ? Number(job.app_user_id) : null,
      subcontractor: job.subcontractor || "UNASSIGNED",
      crew: job.crew_names || null,
      section: job.stage === "tarp"
        ? "not_complete" : "pending_photos",
      days: ageDays(
        job.stage === "tarp"
          ? job.assigned_at || job.current_stage_entered_at
          : job.completed_at
      ),
    })
  }

  return rows
}

function section(
  title: string,
  rows: Row[]
): string[] {
  const lines = [title + " (" + rows.length + ")", ""]

  if (!rows.length) return [...lines, "None", ""]

  for (const job of [...rows].sort(
    (a, b) => (b.days ?? -1) - (a.days ?? -1)
  )) {
    lines.push(
      "Job #" + job.job_id,
      "Location: " + (job.location || "Not recorded"),
      "Crew: " + (job.crew || "Not recorded"),
      "Age: " + (job.days ?? "Unknown") + " days",
      "Navigator: " + JOB_URL + job.job_id,
      ""
    )
  }

  return lines
}

export function formatOfficeTarpReport(rows: Row[]): string {
  const lines = [
    "GOOD2GO ROOFING & CONSTRUCTION",
    "OUTSTANDING TARP WORK — MASTER REPORT",
    "ONE-TIME TEST",
    "",
    "TOTAL OUTSTANDING: " + rows.length,
    "NOT COMPLETE: " +
      rows.filter(r => r.section === "not_complete").length,
    "PENDING PHOTOS: " +
      rows.filter(r => r.section === "pending_photos").length,
    "",
  ]

  const groups = new Map<string, Row[]>()

  for (const row of rows) {
    const key = row.subcontractor_id
      ? String(row.subcontractor_id) : "unassigned"

    groups.set(key, [...(groups.get(key) || []), row])
  }

  const ordered = [...groups.values()].sort((a, b) => {
    if (a[0].subcontractor === "UNASSIGNED") return 1
    if (b[0].subcontractor === "UNASSIGNED") return -1
    return a[0].subcontractor.localeCompare(b[0].subcontractor)
  })

  for (const group of ordered) {
    lines.push(
      "================================",
      group[0].subcontractor.toUpperCase(),
      "TOTAL OUTSTANDING: " + group.length,
      ""
    )

    lines.push(...section(
      "1. TARP ASSIGNED / NOT COMPLETE",
      group.filter(r => r.section === "not_complete")
    ))

    lines.push(...section(
      "2. TARP COMPLETE / PENDING PHOTOS",
      group.filter(r => r.section === "pending_photos")
    ))
  }

  if (!rows.length) {
    lines.push("No outstanding tarp work.")
  }

  lines.push(
    "",
    "Photo status is based on Navigator tarp-category " +
    "photos or photos recorded after tarp completion.",
    "This report does not indicate carrier submission " +
    "or office approval."
  )

  return lines.join("\n")
}

export async function sendOfficeTarpTest() {
  const rows = await collectOutstandingTarps()

  const result = await sendAlertEmail(
    OFFICE,
    "[TEST] Good2Go Outstanding Tarp Work",
    formatOfficeTarpReport(rows)
  )

  return {
    ...result,
    recipient: OFFICE,
    total: rows.length,
    not_complete: rows.filter(
      r => r.section === "not_complete"
    ).length,
    pending_photos: rows.filter(
      r => r.section === "pending_photos"
    ).length,
  }
}
