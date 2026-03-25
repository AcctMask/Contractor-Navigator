import fs from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { pool } from "../db/db"

type AssetType =
  | "photo_before"
  | "photo_during"
  | "photo_after"
  | "eagleview"
  | "noc"
  | "invoice"
  | "order_form"
  | "insurance_doc"
  | "contract"
  | "ems_doc"
  | "other"

function getUploadRoot() {
  return (
    process.env.UPLOAD_ROOT ||
    "/Users/stephenpashoian/Desktop/contractor-autopilot-storage"
  )
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
}

function todayFolder() {
  return new Date().toISOString().slice(0, 10)
}

function assetBucket(assetType: string) {
  if (assetType.startsWith("photo_")) return "photos"
  return "docs"
}

async function ensureAssetTable() {
  await pool.query(`
    create table if not exists job_assets (
      id bigserial primary key,
      tenant_id bigint not null references tenants(id) on delete cascade,
      job_id bigint not null references jobs(id) on delete cascade,
      asset_type text not null,
      bucket text not null,
      original_name text not null,
      stored_name text not null,
      stored_path text not null,
      relative_path text not null,
      mime_type text null,
      file_size_bytes bigint null,
      note text null,
      uploaded_by text null,
      created_at timestamptz not null default now()
    )
  `)
}

async function getTenantIdBySlug(slug: string): Promise<number> {
  const result = await pool.query(
    `select id from tenants where slug = $1 limit 1`,
    [slug]
  )

  if (!result.rowCount) {
    throw new Error(`Tenant not found: ${slug}`)
  }

  return Number(result.rows[0].id)
}

async function ensureJobExists(tenantId: number, jobId: number) {
  const result = await pool.query(
    `select id from jobs where tenant_id = $1 and id = $2 limit 1`,
    [tenantId, jobId]
  )

  if (!result.rowCount) {
    throw new Error(`Job not found: ${jobId}`)
  }
}

export async function listJobAssetsByTenantSlug(tenantSlug: string, jobId: number) {
  await ensureAssetTable()
  const tenantId = await getTenantIdBySlug(tenantSlug)
  await ensureJobExists(tenantId, jobId)

  const result = await pool.query(
    `
    select
      id,
      asset_type,
      bucket,
      original_name,
      stored_name,
      stored_path,
      relative_path,
      mime_type,
      file_size_bytes,
      note,
      uploaded_by,
      created_at
    from job_assets
    where tenant_id = $1
      and job_id = $2
    order by created_at desc, id desc
    `,
    [tenantId, jobId]
  )

  return result.rows
}

export async function saveJobAssetByTenantSlug(params: {
  tenantSlug: string
  jobId: number
  assetType: AssetType | string
  originalName: string
  mimeType?: string | null
  note?: string | null
  uploadedBy?: string | null
  fileBuffer: Buffer
}) {
  await ensureAssetTable()

  const tenantId = await getTenantIdBySlug(params.tenantSlug)
  await ensureJobExists(tenantId, params.jobId)

  const bucket = assetBucket(params.assetType)
  const root = getUploadRoot()
  const datePart = todayFolder()

  const safeTenant = sanitizeSegment(params.tenantSlug)
  const safeAssetType = sanitizeSegment(params.assetType || "other")
  const ext = path.extname(params.originalName || "")
  const base = path.basename(params.originalName || "upload", ext)
  const safeBase = sanitizeSegment(base || "upload")
  const timestamp = Date.now()
  const storedName = `${timestamp}-${safeBase}${ext}`

  const relativePath = path.join(
    safeTenant,
    "jobs",
    `job-${params.jobId}`,
    bucket,
    safeAssetType,
    datePart,
    storedName
  )

  const absolutePath = path.join(root, relativePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, params.fileBuffer)

  const result = await pool.query(
    `
    insert into job_assets (
      tenant_id,
      job_id,
      asset_type,
      bucket,
      original_name,
      stored_name,
      stored_path,
      relative_path,
      mime_type,
      file_size_bytes,
      note,
      uploaded_by,
      created_at
    )
    values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now()
    )
    returning
      id,
      asset_type,
      bucket,
      original_name,
      stored_name,
      stored_path,
      relative_path,
      mime_type,
      file_size_bytes,
      note,
      uploaded_by,
      created_at
    `,
    [
      tenantId,
      params.jobId,
      params.assetType || "other",
      bucket,
      params.originalName,
      storedName,
      absolutePath,
      relativePath,
      params.mimeType || null,
      params.fileBuffer.length,
      params.note || null,
      params.uploadedBy || null,
    ]
  )

  await pool.query(
    `
    insert into timeline_events
      (tenant_id, job_id, kind, message, meta, created_at)
    values
      ($1, $2, 'job_asset_uploaded', $3, $4::jsonb, now())
    `,
    [
      tenantId,
      params.jobId,
      `Asset uploaded: ${params.originalName}`,
      JSON.stringify({
        asset_type: params.assetType || "other",
        original_name: params.originalName,
        relative_path: relativePath,
        uploaded_by: params.uploadedBy || null,
      }),
    ]
  )

  return result.rows[0]
}
