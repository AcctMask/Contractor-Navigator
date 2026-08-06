import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { getTenantIdBySlug } from "../services/followupEngine"
import fs from "fs"
import path from "path"
import { pipeline } from "stream/promises"
import { randomUUID } from "crypto"
import { sendSMS } from "../services/twilioService"
import { getCurrentUserFromToken } from "../services/authService"

function getBearerToken(request: any) {
  const auth = String(request.headers.authorization || "")
  return auth.startsWith("Bearer ") ? auth.slice(7) : ""
}

async function ensureCrewAssignmentUserColumn() {
  await pool.query(`
    alter table crew_assignments
    add column if not exists app_user_id bigint null
  `)

  await pool.query(`
    create index if not exists idx_crew_assignments_tenant_user
    on crew_assignments (tenant_id, app_user_id)
  `)
}

async function requireAssignedJobAccess(
  request: any,
  reply: any,
  tenantId: number,
  jobId: number
) {
  const token = getBearerToken(request)

  if (!token) {
    reply.code(401)
    return null
  }

  try {
    const user = await getCurrentUserFromToken(token)

    if (!user?.is_active) {
      reply.code(401)
      return null
    }

    if (
      String(user.role) !== "platform_owner" &&
      Number(user.tenant_id) !== tenantId
    ) {
      reply.code(403)
      return null
    }

    if (String(user.role) !== "subcontractor") {
      return user
    }

    await ensureCrewAssignmentUserColumn()

    const assignment = await pool.query(
      `
      select id
      from crew_assignments
      where tenant_id = $1
        and job_id = $2
        and app_user_id = $3
      limit 1
      `,
      [tenantId, jobId, Number(user.id)]
    )

    if (!assignment.rowCount) {
      reply.code(403)
      return null
    }

    return user
  } catch {
    reply.code(401)
    return null
  }
}

async function ensureJobExists(tenantId: number, jobId: number) {
  const result = await pool.query(
    `select id from jobs where tenant_id = $1 and id = $2 limit 1`,
    [tenantId, jobId]
  )

  if (!result.rowCount) {
    throw new Error("Job not found")
  }
}

function getUploadRoot() {
  return process.env.UPLOAD_ROOT || path.join(process.cwd(), "uploads")
}

async function ensureAssetCategoryColumn() {
  await pool.query(`
    alter table job_assets
    add column if not exists asset_category text
  `)
}

export async function registerJobAssetsRoutes(app: FastifyInstance) {
  app.get("/assets/:tenantSlug/job/:jobId", async (req: any, reply) => {
    try {
      await ensureAssetCategoryColumn()

      const { tenantSlug, jobId } = req.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const numericJobId = Number(jobId)
      const user = await requireAssignedJobAccess(
        req,
        reply,
        tenantId,
        numericJobId
      )

      if (!user) {
        return { ok: false, error: "Not authorized" }
      }

      const assetsResult = await pool.query(
        `
        select
          id,
          job_id,
          asset_type,
          asset_category,
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
        [tenantId, numericJobId]
      )

      const notesResult = await pool.query(
        `
        select
          id,
          message,
          meta,
          created_at
        from timeline_events
        where tenant_id = $1
          and job_id = $2
          and kind in (
            'staff_note',
            'manual_sms_sent',
            'job_asset_uploaded',
            'estimate_details',
            'lead_created',
            'ai_message_generated',
            'ai_message_sent',
            'ai_message_send_failed',
            'customer_reply',
            'voice_intake_started',
            'voice_intake_alert_routed',
            'voice_intake_alert_sent',
            'document_package_sent',
            'document_package_signed'
          )
        order by created_at desc, id desc
        `,
        [tenantId, numericJobId]
      )

      return {
        ok: true,
        assets: assetsResult.rows.map((asset) => ({
          ...asset,
          original_name: asset.original_name || asset.stored_name || "file",
          mime_type: asset.mime_type || "",
          size_bytes: asset.file_size_bytes || null,
          download_url: `/assets/${tenantSlug}/file/${asset.id}`,
        })),
        notes: notesResult.rows,
      }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Load files failed" }
    }
  })

  app.get("/assets/:tenantSlug/file/:assetId", async (req: any, reply) => {
    try {
      const { tenantSlug, assetId } = req.params
      const tenantId = await getTenantIdBySlug(tenantSlug)

      const result = await pool.query(
        `
        select
          job_id,
          original_name,
          stored_path,
          mime_type
        from job_assets
        where tenant_id = $1
          and id = $2
        limit 1
        `,
        [tenantId, Number(assetId)]
      )

      if (!result.rowCount) {
        reply.code(404)
        return { ok: false, error: "File not found" }
      }

      const asset = result.rows[0]
      const user = await requireAssignedJobAccess(
        req,
        reply,
        tenantId,
        Number(asset.job_id)
      )

      if (!user) {
        return { ok: false, error: "Not authorized" }
      }

      const resolvedPath = asset.stored_path

      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        reply.code(404)
        return { ok: false, error: "File missing from disk" }
      }

      reply.header("Content-Type", asset.mime_type || "application/octet-stream")
      reply.header("Content-Disposition", `inline; filename="${asset.original_name || "file"}"`)

      return reply.send(fs.createReadStream(resolvedPath))
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Open file failed" }
    }
  })

  app.post("/assets/:tenantSlug/job/:jobId/upload", async (req: any, reply) => {
    try {
      await ensureAssetCategoryColumn()

      const { tenantSlug, jobId } = req.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const numericJobId = Number(jobId)
      const user = await requireAssignedJobAccess(
        req,
        reply,
        tenantId,
        numericJobId
      )

      if (!user) {
        return { ok: false, error: "Not authorized" }
      }

      await ensureJobExists(tenantId, numericJobId)

      const relativeDir = path.join("job-assets", tenantSlug, String(numericJobId))
      const jobDir = path.join(getUploadRoot(), relativeDir)

      fs.mkdirSync(jobDir, { recursive: true })

      const uploaded: any[] = []
      const parts = req.files()

      for await (const part of parts) {
        const originalName = part.filename || "file"
        const ext = path.extname(originalName)
        const storedName = `${Date.now()}-${randomUUID()}${ext}`
        const storedPath = path.join(jobDir, storedName)
        const relativePath = path.join(relativeDir, storedName)
        const mimetype = part.mimetype || null

        await pipeline(part.file, fs.createWriteStream(storedPath))

        const stat = fs.statSync(storedPath)
        const assetType = mimetype?.startsWith("image/") ? "photo" : "file"

        const result = await pool.query(
          `
          insert into job_assets
          (
            tenant_id,
            job_id,
            asset_type,
            asset_category,
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
          values
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
          returning
            id,
            job_id,
            asset_type,
            asset_category,
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
            numericJobId,
            assetType,
            String(req.body?.asset_category || "Documents"),
            "local",
            originalName,
            storedName,
            storedPath,
            relativePath,
            mimetype,
            stat.size,
            String(req.body?.note || "").trim() || null,
            String(user.full_name || user.email || "Team"),
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
            numericJobId,
            `File uploaded: ${originalName}`,
            JSON.stringify({
              asset_id: result.rows[0].id,
              original_name: originalName,
              stored_name: storedName,
              relative_path: relativePath,
              mime_type: mimetype,
              file_size_bytes: stat.size,
              uploaded_by: String(user.full_name || user.email || "Team"),
              asset_category: String(req.body?.asset_category || "Documents"),
              note: String(req.body?.note || "").trim() || null,
            }),
          ]
        )

        uploaded.push({
          ...result.rows[0],
          original_name: result.rows[0].original_name || result.rows[0].stored_name || "file",
          size_bytes: result.rows[0].file_size_bytes || null,
          download_url: `/assets/${tenantSlug}/file/${result.rows[0].id}`,
        })
      }

      return { ok: true, uploaded }
    } catch (err: any) {
      console.error("UPLOAD ERROR:", err)
      reply.code(400)
      return { ok: false, error: err?.message || "Upload failed" }
    }
  })

  app.delete("/assets/:tenantSlug/job/:jobId/file/:assetId", async (req: any, reply) => {
    try {
      const { tenantSlug, jobId, assetId } = req.params
      const tenantId = await getTenantIdBySlug(tenantSlug)

      const result = await pool.query(
        `
        delete from job_assets
        where tenant_id = $1
          and job_id = $2
          and id = $3
        returning stored_path
        `,
        [tenantId, Number(jobId), Number(assetId)]
      )

      if (!result.rowCount) {
        throw new Error("File not found")
      }

      const file = result.rows[0]
      const resolvedPath = file.stored_path

      if (resolvedPath && fs.existsSync(resolvedPath)) {
        fs.unlinkSync(resolvedPath)
      }

      return { ok: true }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Delete file failed" }
    }
  })

  app.post("/assets/:tenantSlug/job/:jobId/send-sms", async (req: any, reply) => {
    try {
      const { tenantSlug, jobId } = req.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const { message, author } = req.body || {}
      const smsAuthor = String(author || "Team").trim() || "Team"
      const smsMessage = String(message || "").trim()

      if (!smsMessage) {
        throw new Error("SMS message is required")
      }

      const jobResult = await pool.query(
        `
        select
          j.id,
          c.phone as customer_phone
        from jobs j
        left join customers c on c.id = j.customer_id
        where j.tenant_id = $1
          and j.id = $2
        limit 1
        `,
        [tenantId, Number(jobId)]
      )

      if (!jobResult.rowCount) {
        throw new Error("Job not found")
      }

      const customerPhone = jobResult.rows[0].customer_phone

      if (!customerPhone) {
        throw new Error("Customer phone is missing")
      }

      const smsResult = await sendSMS(String(customerPhone), smsMessage)

      const result = await pool.query(
        `
        insert into timeline_events
          (tenant_id, job_id, kind, message, meta, created_at)
        values
          ($1,$2,'staff_note',$3,$4::jsonb,now())
        returning
          id,
          message,
          meta,
          created_at
        `,
        [
          tenantId,
          Number(jobId),
          smsMessage,
          JSON.stringify({
            author: smsAuthor,
            note_type: "manual_sms_sent",
            channel: "sms",
            to: customerPhone,
            sms_result: smsResult,
          }),
        ]
      )

      return { ok: true, sms: smsResult, note: result.rows[0] }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Send SMS failed" }
    }
  })

  app.post("/assets/:tenantSlug/job/:jobId/notes", async (req: any, reply) => {
    try {
      const { tenantSlug, jobId } = req.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const numericJobId = Number(jobId)
      const user = await requireAssignedJobAccess(
        req,
        reply,
        tenantId,
        numericJobId
      )

      if (!user) {
        return { ok: false, error: "Not authorized" }
      }

      const { message } = req.body || {}
      const noteAuthor = String(
        user.full_name || user.email || "Team"
      ).trim() || "Team"

      if (!String(message || "").trim()) {
        throw new Error("Note is required")
      }

      const result = await pool.query(
        `
        insert into timeline_events
          (tenant_id, job_id, kind, message, meta, created_at)
        values
          ($1,$2,'staff_note',$3,$4::jsonb,now())
        returning
          id,
          message,
          meta,
          created_at
        `,
        [
          tenantId,
          numericJobId,
          String(message).trim(),
          JSON.stringify({ author: noteAuthor }),
        ]
      )

      return { ok: true, note: result.rows[0] }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Add note failed" }
    }
  })

  app.delete("/assets/:tenantSlug/job/:jobId/notes/:noteId", async (req: any, reply) => {
    try {
      const { tenantSlug, jobId, noteId } = req.params
      const tenantId = await getTenantIdBySlug(tenantSlug)

      const result = await pool.query(
        `
        delete from timeline_events
        where tenant_id = $1
          and job_id = $2
          and id = $3
          and kind = 'staff_note'
        returning id
        `,
        [tenantId, Number(jobId), Number(noteId)]
      )

      if (!result.rowCount) {
        throw new Error("Note not found")
      }

      return { ok: true }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Delete note failed" }
    }
  })
}
