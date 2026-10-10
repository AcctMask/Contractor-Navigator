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

export async function sendOfficeTarpTest() {
  const [rows, roster] = await Promise.all([
    collectOutstandingTarps(),
    listTarpSubcontractors()
  ])

  const result = await sendAlertEmail(
    TEST_RECIPIENT,
    "[TEST] Good2Go Outstanding Tarp Work — Master Report",
    formatOfficeTarpReport(rows, roster)
  )

  return {
    ...result,
    recipient: TEST_RECIPIENT,
    subcontractors: roster.length,
    total: rows.length,
    not_complete: rows.filter(
      r => r.section === "not_complete"
    ).length,
    pending_photos: rows.filter(
      r => r.section === "pending_photos"
    ).length
  }
}
