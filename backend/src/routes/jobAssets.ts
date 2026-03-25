import type { FastifyInstance } from "fastify"
import {
  listJobAssetsByTenantSlug,
  saveJobAssetByTenantSlug,
} from "../services/jobAssetsService"

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
          if (part.fieldname === "asset_type") assetType = String(part.value || "other")
          if (part.fieldname === "note") note = String(part.value || "")
          if (part.fieldname === "uploaded_by") uploadedBy = String(part.value || "")
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
}
