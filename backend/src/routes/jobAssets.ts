import type { FastifyInstance } from "fastify"
import fs from "node:fs/promises"
import path from "node:path"
import {
  listJobAssetsByTenantSlug,
  saveJobAssetByTenantSlug,
} from "../services/jobAssetsService"

function getUploadRoot() {
  return (
    process.env.UPLOAD_ROOT ||
    "/Users/stephenpashoian/Desktop/contractor-autopilot-storage"
  )
}

function getMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()

  switch (ext) {
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".pdf":
      return "application/pdf"
    case ".gif":
      return "image/gif"
    case ".webp":
      return "image/webp"
    case ".txt":
      return "text/plain; charset=utf-8"
    case ".zip":
      return "application/zip"
    case ".doc":
      return "application/msword"
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    case ".xls":
      return "application/vnd.ms-excel"
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    default:
      return "application/octet-stream"
  }
}

export async function registerJobAssetsRoutes(app: FastifyInstance) {
  app.get("/assets/:tenantSlug/job/:jobId", async (request: any, reply) => {
    try {
      const { tenantSlug, jobId } = request.params
      const assets = await listJobAssetsByTenantSlug(tenantSlug, Number(jobId))
      return { ok: true, assets }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.post("/assets/:tenantSlug/job/:jobId/upload", async (request: any, reply) => {
    try {
      const { tenantSlug, jobId } = request.params

      let assetType = "other"
      let note = ""
      let uploadedBy = ""

      let originalName = ""
      let mimeType: string | null = null
      let fileBuffer: Buffer | null = null

      const parts = request.parts()

      for await (const part of parts) {
        if (part.type === "field") {
          if (part.fieldname === "asset_type") {
            assetType = String(part.value || "other")
          }
          if (part.fieldname === "kind") {
            assetType = String(part.value || "other")
          }
          if (part.fieldname === "note") {
            note = String(part.value || "")
          }
          if (part.fieldname === "uploaded_by") {
            uploadedBy = String(part.value || "")
          }
          continue
        }

        if (part.type === "file") {
          originalName = part.filename || "upload.bin"
          mimeType = part.mimetype || null

          const chunks: Buffer[] = []
          for await (const chunk of part.file) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          }

          fileBuffer = Buffer.concat(chunks)
        }
      }

      if (!fileBuffer) {
        reply.code(400)
        return { ok: false, error: "No file uploaded" }
      }

      const asset = await saveJobAssetByTenantSlug({
        tenantSlug,
        jobId: Number(jobId),
        assetType,
        originalName,
        mimeType,
        note,
        uploadedBy,
        fileBuffer,
      })

      return { ok: true, asset }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.get("/files/*", async (request: any, reply) => {
    try {
      const wildcard = String(request.params["*"] || "")
      const uploadRoot = getUploadRoot()

      if (!wildcard) {
        reply.code(400)
        return { ok: false, error: "Missing file path" }
      }

      const normalizedRelative = wildcard.replace(/^\/+/, "")
      const absolutePath = path.resolve(uploadRoot, normalizedRelative)
      const resolvedRoot = path.resolve(uploadRoot)

      if (!absolutePath.startsWith(resolvedRoot)) {
        reply.code(403)
        return { ok: false, error: "Forbidden path" }
      }

      await fs.access(absolutePath)

      const fileBuffer = await fs.readFile(absolutePath)
      const mimeType = getMimeType(absolutePath)

      reply.header("Content-Type", mimeType)
      reply.header("Cache-Control", "no-store")
      return reply.send(fileBuffer)
    } catch (err: any) {
      reply.code(404)
      return { ok: false, error: err?.message || "File not found" }
    }
  })
}
