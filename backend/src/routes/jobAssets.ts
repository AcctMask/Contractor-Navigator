import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { getTenantIdBySlug } from "../services/followupEngine"
import fs from "fs"
import path from "path"
import { pipeline } from "stream/promises"
import { randomUUID } from "crypto"

async function ensureJobExists(tenantId: number, jobId: number) {
  const result = await pool.query(
    `select id from jobs where tenant_id = $1 and id = $2 limit 1`,
    [tenantId, jobId]
  )

  if (!result.rowCount) {
    throw new Error("Job not found")
  }
}

export async function registerJobAssetsRoutes(app: FastifyInstance) {
  app.get("/assets/:tenantSlug/job/:jobId", async (req: any, reply) => {
    try {
      const { tenantSlug, jobId } = req.params
      const tenantId = await getTenantIdBySlug(tenantSlug)

      const assetsResult = await pool.query(
        `
        select
          id,
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
        from job_assets
        where tenant_id = $1
          and job_id = $2
        order by created_at desc, id desc
        `,
        [tenantId, Number(jobId)]
      )

      const notesResult = await pool.query(
        `
        select
          id,
          message,
          created_at
        from timeline_events
        where tenant_id = $1
          and job_id = $2
          and kind = 'staff_note'
        order by created_at desc, id desc
        `,
        [tenantId, Number(jobId)]
      )

      return {
        ok: true,
        assets: assetsResult.rows.map((asset) => ({
          ...asset,
          original_name: asset.original_name || asset.stored_name || "file",
          mime_type: asset.mime_type || "": asset.file_size_bytes || null,
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
      const { tenantSlug, jobId } = req.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const numericJobId = Number(jobId)

      await ensureJobExists(tenantId, numericJobId)

      const relativeDir = path.join("job-assets", tenantSlug, String(numericJobId))
      const jobDir = path.join(process.cwd(), "uploads", relativeDir)
      fs.mkdirSync(jobDir, { recursive: true })

      const uploaded: any[] = []
      const parts = req.files()

      for await (const part of parts) {
        const originalName = part.filename || "file"
        const ext = path.extname(originalName)
        const storedName = `${Date.now()}-${randomUUID()}${ext}`
        const storedPath = path.join(jobDir, storedName)
        const relativePath = path.join(relativeDir, storedName)

        await pipeline(part.file, fs.createWriteStream(storedPath))

        const stat = fs.statSync(storedPath)
        const assetType = part.mimetype?.startsWith("image/") ? "photo" : "file"

        const result = await pool.query(
          `
          insert into job_assets
          (
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
          values
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
          returning
            id,
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
          `,
          [
            tenantId,
            numericJobId,
            assetType,
            "local",
            originalName,
            storedName,
            storedPath,
            relativePath,
            part.mimetype || null,
            stat.size,
            null,
            "Steve",
          ]
        )

        uploaded.push({
          ...result.rows[0],
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

  app.post("/assets/:tenantSlug/job/:jobId/notes", async (req: any, reply) => {
    try {
      const { tenantSlug, jobId } = req.params
      const tenantId = await getTenantIdBySlug(tenantSlug)
      const { message } = req.body || {}

      if (!String(message || "").trim()) {
        throw new Error("Note is required")
      }

      const result = await pool.query(
        `
        insert into timeline_events
          (tenant_id, job_id, kind, message, created_at)
        values
          ($1,$2,'staff_note',$3,now())
        returning
          id,
          message,
          created_at
        `,
        [tenantId, Number(jobId), String(message).trim()]
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
