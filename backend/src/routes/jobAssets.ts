import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { getTenantIdBySlug } from "../services/followupEngine"
import fs from "fs"
import path from "path"
import { pipeline } from "stream/promises"
import { randomUUID } from "crypto"
import { sendSMS } from "../services/twilioService"
import { getCurrentUserFromToken } from "../services/authService"
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib"
import sharp from "sharp"

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

      const sequenceResult = await pool.query(
        `
        select meta
        from timeline_events
        where tenant_id = $1
          and job_id = $2
          and kind = 'photo_report_sequence_saved'
        order by created_at desc, id desc
        limit 1
        `,
        [tenantId, numericJobId]
      )

      const savedSequence =
        sequenceResult.rows[0]?.meta?.photo_ids

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
        photo_sequence: Array.isArray(savedSequence)
          ? savedSequence
          : [],
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
      const parts = req.parts()
      let uploadCategory = "Documents"
      let uploadNote: string | null = null

      for await (const part of parts) {
        if (part.type === "field") {
          const value = String(part.value ?? "").trim()

          if (part.fieldname === "asset_category" && value) {
            uploadCategory = value
          }

          if (part.fieldname === "note") {
            uploadNote = value || null
          }

          continue
        }

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
            uploadCategory,
            "local",
            originalName,
            storedName,
            storedPath,
            relativePath,
            mimetype,
            stat.size,
            uploadNote,
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
              asset_category: uploadCategory,
              note: uploadNote,
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

  app.post("/assets/:tenantSlug/job/:jobId/photo-sequence", async (req: any, reply) => {
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

      const rawPhotoIds = Array.isArray(req.body?.photo_ids)
        ? req.body.photo_ids
        : []

      const photoIds = rawPhotoIds.map((value: any) =>
        Number(value)
      )

      if (
        photoIds.length === 0 ||
        photoIds.some(
          (value: number) =>
            !Number.isInteger(value) || value <= 0
        )
      ) {
        reply.code(400)
        return {
          ok: false,
          error: "At least one valid photo is required",
        }
      }

      if (new Set(photoIds).size !== photoIds.length) {
        reply.code(400)
        return {
          ok: false,
          error: "Duplicate photos are not allowed",
        }
      }

      const photoResult = await pool.query(
        `
        select id
        from job_assets
        where tenant_id = $1
          and job_id = $2
          and id = any($3::bigint[])
          and (
            asset_type = 'photo'
            or mime_type like 'image/%'
          )
        `,
        [tenantId, numericJobId, photoIds]
      )

      if (photoResult.rows.length !== photoIds.length) {
        reply.code(400)
        return {
          ok: false,
          error:
            "One or more selected photos could not be found on this job",
        }
      }

      await pool.query(
        `
        insert into timeline_events
          (
            tenant_id,
            job_id,
            kind,
            message,
            meta,
            created_at
          )
        values
          (
            $1,
            $2,
            'photo_report_sequence_saved',
            $3,
            $4::jsonb,
            now()
          )
        `,
        [
          tenantId,
          numericJobId,
          `Photo report sequence saved with ${photoIds.length} photo${photoIds.length === 1 ? "" : "s"}`,
          JSON.stringify({
            photo_ids: photoIds,
            saved_by: String(
              user.full_name ||
                user.email ||
                "Team"
            ),
          }),
        ]
      )

      return {
        ok: true,
        photo_ids: photoIds,
      }
    } catch (err: any) {
      console.error("PHOTO SEQUENCE SAVE ERROR:", err)

      reply.code(400)

      return {
        ok: false,
        error:
          err?.message ||
          "Photo sequence save failed",
      }
    }
  })

  app.post("/assets/:tenantSlug/job/:jobId/photo-report", async (req: any, reply) => {
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

      const rawPhotoIds = Array.isArray(req.body?.photo_ids)
        ? req.body.photo_ids
        : []

      const photoIds = rawPhotoIds.map((value: any) =>
        Number(value)
      )

      const allowedLocations = new Set([
        "",
        "Upper left",
        "Upper right",
        "Center",
        "Lower left",
        "Lower right",
      ])

      const rawPhotoEdits = Array.isArray(req.body?.photo_edits)
        ? req.body.photo_edits
        : []

      const photoEdits = new Map<
        number,
        { rotation: number; location: string }
      >()

      for (const edit of rawPhotoEdits) {
        const photoId = Number(edit?.photo_id)
        const rotation = Number(edit?.rotation || 0)
        const location = String(edit?.location || "").trim()

        if (!Number.isInteger(photoId) || photoId <= 0) {
          reply.code(400)
          return {
            ok: false,
            error: "Invalid photo edit identifier",
          }
        }

        if (![0, 90, 180, 270].includes(rotation)) {
          reply.code(400)
          return {
            ok: false,
            error: "Photo rotation must be 0, 90, 180, or 270 degrees",
          }
        }

        if (!allowedLocations.has(location)) {
          reply.code(400)
          return {
            ok: false,
            error: "Invalid Location in Photo value",
          }
        }

        photoEdits.set(photoId, {
          rotation,
          location,
        })
      }

      if (
        photoIds.length === 0 ||
        photoIds.some(
          (value: number) =>
            !Number.isInteger(value) || value <= 0
        )
      ) {
        reply.code(400)
        return {
          ok: false,
          error: "At least one valid photo is required",
        }
      }

      if (new Set(photoIds).size !== photoIds.length) {
        reply.code(400)
        return {
          ok: false,
          error: "Duplicate photos are not allowed",
        }
      }

      const jobResult = await pool.query(
        `
        select
          j.id,
          j.address1,
          j.city,
          j.state,
          j.zip,
          j.carrier,
          j.claim_number,
          j.policy_holder,
          j.adjuster_name,
          j.adjuster_phone,
          j.adjuster_email,
          c.full_name as customer_name,
          coalesce(
            nullif(to_jsonb(t)->>'name', ''),
            nullif(to_jsonb(t)->>'display_name', ''),
            $3
          ) as company_name
        from jobs j
        left join customers c
          on c.id = j.customer_id
         and c.tenant_id = j.tenant_id
        join tenants t
          on t.id = j.tenant_id
        where j.tenant_id = $1
          and j.id = $2
        limit 1
        `,
        [tenantId, numericJobId, tenantSlug]
      )

      if (!jobResult.rowCount) {
        reply.code(404)
        return { ok: false, error: "Job not found" }
      }

      const photoResult = await pool.query(
        `
        select
          id,
          original_name,
          stored_path,
          mime_type,
          note
        from job_assets
        where tenant_id = $1
          and job_id = $2
          and id = any($3::bigint[])
        `,
        [tenantId, numericJobId, photoIds]
      )

      if (photoResult.rows.length !== photoIds.length) {
        reply.code(400)
        return {
          ok: false,
          error:
            "One or more selected photos could not be found on this job",
        }
      }

      const photosById = new Map(
        photoResult.rows.map((row: any) => [
          Number(row.id),
          row,
        ])
      )

      const orderedPhotos = photoIds.map((photoId: number) =>
        photosById.get(photoId)
      )

      for (const photo of orderedPhotos) {
        if (!photo) {
          reply.code(400)
          return {
            ok: false,
            error: "Selected photo could not be found",
          }
        }

        const mimeType = String(photo.mime_type || "")
          .toLowerCase()

        if (
          mimeType !== "image/jpeg" &&
          mimeType !== "image/jpg"
        ) {
          reply.code(400)
          return {
            ok: false,
            error:
              `Photo ${photo.original_name || photo.id} is not a JPEG`,
          }
        }

        if (
          !photo.stored_path ||
          !fs.existsSync(photo.stored_path)
        ) {
          reply.code(400)
          return {
            ok: false,
            error:
              `Photo file is missing: ${photo.original_name || photo.id}`,
          }
        }
      }

      const job = jobResult.rows[0]

      const pdfDoc = await PDFDocument.create()
      const regularFont = await pdfDoc.embedFont(
        StandardFonts.Helvetica
      )
      const boldFont = await pdfDoc.embedFont(
        StandardFonts.HelveticaBold
      )

      const PAGE_WIDTH = 612
      const PAGE_HEIGHT = 792
      const MARGIN_X = 36
      const MARGIN_TOP = 30
      const MARGIN_BOTTOM = 30
      const COLUMN_GAP = 18
      const ROW_GAP = 10
      const HEADER_HEIGHT = 104
      const CONTENT_TOP =
        PAGE_HEIGHT - MARGIN_TOP - HEADER_HEIGHT
      const CELL_WIDTH =
        (PAGE_WIDTH - MARGIN_X * 2 - COLUMN_GAP) / 2

      function safeText(value: any) {
        return String(value ?? "").trim()
      }

      function cleanFilePart(value: any) {
        const cleaned = safeText(value)
          .replace(/[^a-zA-Z0-9_-]+/g, "_")
          .replace(/^_+|_+$/g, "")

        return cleaned || "Job"
      }

      function wrapText(
        text: string,
        maxWidth: number,
        fontSize: number
      ) {
        const normalized = safeText(text) || "No description"
        const words = normalized.split(/\s+/)
        const lines: string[] = []
        let line = ""

        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word

          if (
            regularFont.widthOfTextAtSize(
              candidate,
              fontSize
            ) <= maxWidth
          ) {
            line = candidate
            continue
          }

          if (line) {
            lines.push(line)
          }

          line = word
        }

        if (line) {
          lines.push(line)
        }

        return lines
      }

      function drawHeader(page: any) {
        const companyName =
          safeText(job.company_name) || tenantSlug

        page.drawText(companyName, {
          x: MARGIN_X,
          y: PAGE_HEIGHT - 42,
          size: 15,
          font: boldFont,
          color: rgb(0.08, 0.11, 0.16),
        })

        page.drawText("PHOTO REPORT", {
          x: MARGIN_X,
          y: PAGE_HEIGHT - 61,
          size: 12,
          font: boldFont,
          color: rgb(0.08, 0.11, 0.16),
        })

        const address = [
          job.address1,
          job.city,
          job.state,
          job.zip,
        ]
          .filter(Boolean)
          .join(", ")

        const leftLines = [
          `Customer: ${safeText(job.customer_name) || "—"}`,
          `Property: ${address || "—"}`,
        ]

        const rightLines = [
          `Carrier: ${safeText(job.carrier) || "—"}`,
          `Claim #: ${safeText(job.claim_number) || "—"}`,
        ]

        leftLines.forEach((line, index) => {
          page.drawText(line, {
            x: MARGIN_X,
            y: PAGE_HEIGHT - 79 - index * 12,
            size: 8,
            font: regularFont,
            color: rgb(0.15, 0.18, 0.22),
          })
        })

        rightLines.forEach((line, index) => {
          page.drawText(line, {
            x: 322,
            y: PAGE_HEIGHT - 79 - index * 12,
            size: 8,
            font: regularFont,
            color: rgb(0.15, 0.18, 0.22),
          })
        })

        page.drawLine({
          start: {
            x: MARGIN_X,
            y: PAGE_HEIGHT - MARGIN_TOP - HEADER_HEIGHT + 12,
          },
          end: {
            x: PAGE_WIDTH - MARGIN_X,
            y: PAGE_HEIGHT - MARGIN_TOP - HEADER_HEIGHT + 12,
          },
          thickness: 0.8,
          color: rgb(0.72, 0.74, 0.77),
        })
      }

      const MAX_IMAGE_HEIGHT = 150
      const MIN_IMAGE_HEIGHT = 70
      const CAPTION_TITLE_HEIGHT = 18
      const CAPTION_LINE_HEIGHT = 9
      const ROW_PADDING = 12
      const AVAILABLE_PAGE_HEIGHT = CONTENT_TOP - MARGIN_BOTTOM

      let page: any = null
      let currentY = CONTENT_TOP

      function startPhotoPage() {
        page = pdfDoc.addPage([
          PAGE_WIDTH,
          PAGE_HEIGHT,
        ])

        drawHeader(page)
        currentY = CONTENT_TOP
      }

      startPhotoPage()

      for (
        let pairStart = 0;
        pairStart < orderedPhotos.length;
        pairStart += 2
      ) {
        const pair = orderedPhotos.slice(
          pairStart,
          pairStart + 2
        )

        const pairCaptions = pair.map((photo: any) =>
          wrapText(
            safeText(photo.note),
            CELL_WIDTH,
            7.4
          )
        )

        const pairLocations = pair.map((photo: any) =>
          photoEdits.get(Number(photo.id))?.location || ""
        )

        const maxCaptionLines = Math.max(
          1,
          ...pairCaptions.map(
            (lines: string[], index: number) =>
              lines.length + (pairLocations[index] ? 1 : 0)
          )
        )

        const captionHeight =
          CAPTION_TITLE_HEIGHT +
          maxCaptionLines * CAPTION_LINE_HEIGHT

        let imageHeight = MAX_IMAGE_HEIGHT

        let rowHeight =
          imageHeight +
          captionHeight +
          ROW_PADDING

        if (rowHeight > AVAILABLE_PAGE_HEIGHT) {
          imageHeight =
            AVAILABLE_PAGE_HEIGHT -
            captionHeight -
            ROW_PADDING

          if (imageHeight < MIN_IMAGE_HEIGHT) {
            reply.code(400)

            return {
              ok: false,
              error:
                "One of the selected photo descriptions is too long to fit safely in the photo report. Shorten that description and generate the report again.",
            }
          }

          rowHeight =
            imageHeight +
            captionHeight +
            ROW_PADDING
        }

        const remainingHeight =
          currentY - MARGIN_BOTTOM

        if (rowHeight > remainingHeight) {
          startPhotoPage()
        }

        for (
          let pairIndex = 0;
          pairIndex < pair.length;
          pairIndex += 1
        ) {
          const photo = pair[pairIndex]
          const reportIndex =
            pairStart + pairIndex
          const column = pairIndex

          const cellX =
            MARGIN_X +
            column *
              (CELL_WIDTH + COLUMN_GAP)

          const sourceBytes = fs.readFileSync(
            photo.stored_path
          )

          const orientedBytes = await sharp(sourceBytes)
            .autoOrient()
            .jpeg({ quality: 95 })
            .toBuffer()

          const image =
            await pdfDoc.embedJpg(orientedBytes)

          const edit =
            photoEdits.get(Number(photo.id)) || {
              rotation: 0,
              location: "",
            }

          const clockwiseRotation = edit.rotation
          const rotated =
            clockwiseRotation === 90 ||
            clockwiseRotation === 270

          const naturalBoxWidth = rotated
            ? image.height
            : image.width

          const naturalBoxHeight = rotated
            ? image.width
            : image.height

          const scale = Math.min(
            CELL_WIDTH / naturalBoxWidth,
            imageHeight / naturalBoxHeight
          )

          const rawWidth = image.width * scale
          const rawHeight = image.height * scale

          const boxWidth = rotated
            ? rawHeight
            : rawWidth

          const boxHeight = rotated
            ? rawWidth
            : rawHeight

          const boxX =
            cellX +
            (CELL_WIDTH - boxWidth) / 2

          const boxY =
            currentY - boxHeight

          const pdfRotation =
            (360 - clockwiseRotation) % 360

          let imageX = boxX
          let imageY = boxY

          if (pdfRotation === 90) {
            imageX = boxX + rawHeight
          } else if (pdfRotation === 180) {
            imageX = boxX + rawWidth
            imageY = boxY + rawHeight
          } else if (pdfRotation === 270) {
            imageY = boxY + rawWidth
          }

          page.drawImage(image, {
            x: imageX,
            y: imageY,
            width: rawWidth,
            height: rawHeight,
            rotate: degrees(pdfRotation),
          })

          const photoNumber =
            reportIndex + 1

          const captionY =
            currentY -
            imageHeight -
            13

          page.drawText(
            `Photo ${photoNumber}`,
            {
              x: cellX,
              y: captionY,
              size: 8.5,
              font: boldFont,
              color: rgb(
                0.08,
                0.11,
                0.16
              ),
            }
          )

          const captionLines =
            pairCaptions[pairIndex]

          captionLines.forEach(
            (
              line: string,
              lineIndex: number
            ) => {
              page.drawText(line, {
                x: cellX,
                y:
                  captionY -
                  11 -
                  lineIndex *
                    CAPTION_LINE_HEIGHT,
                size: 7.4,
                font: regularFont,
                color: rgb(
                  0.15,
                  0.18,
                  0.22
                ),
              })
            }
          )

          const location =
            photoEdits.get(Number(photo.id))?.location || ""

          if (location) {
            page.drawText(
              `Location in Photo: ${location}`,
              {
                x: cellX,
                y:
                  captionY -
                  11 -
                  captionLines.length *
                    CAPTION_LINE_HEIGHT,
                size: 7.4,
                font: boldFont,
                color: rgb(
                  0.15,
                  0.18,
                  0.22
                ),
              }
            )
          }
        }

        currentY -= rowHeight + ROW_GAP
      }

      pdfDoc.setTitle(
        `${safeText(job.customer_name) || "Job"} Photo Report`
      )
      pdfDoc.setSubject(
        `Navigator photo report for job ${numericJobId}`
      )
      pdfDoc.setCreator("Contractor Navigator")
      pdfDoc.setProducer("Contractor Navigator")

      const pdfBytes = await pdfDoc.save()
      const pdfBuffer = Buffer.from(pdfBytes)

      const reportDate = new Date()
        .toISOString()
        .slice(0, 10)

      const reportName =
        `${cleanFilePart(job.customer_name)}_` +
        `${cleanFilePart(job.claim_number || `Job_${numericJobId}`)}_` +
        `Photo_Report_${reportDate}.pdf`

      const relativeDir = path.join(
        "job-assets",
        tenantSlug,
        String(numericJobId)
      )

      const jobDir = path.join(
        getUploadRoot(),
        relativeDir
      )

      fs.mkdirSync(jobDir, { recursive: true })

      const storedName =
        `${Date.now()}-${randomUUID()}.pdf`

      const storedPath = path.join(
        jobDir,
        storedName
      )

      const relativePath = path.join(
        relativeDir,
        storedName
      )

      fs.writeFileSync(storedPath, pdfBuffer)

      const assetResult = await pool.query(
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
        (
          $1,$2,'file','Documents','local',
          $3,$4,$5,$6,'application/pdf',
          $7,$8,$9,now()
        )
        returning
          id,
          job_id,
          asset_type,
          asset_category,
          original_name,
          mime_type,
          file_size_bytes,
          note,
          uploaded_by,
          created_at
        `,
        [
          tenantId,
          numericJobId,
          reportName,
          storedName,
          storedPath,
          relativePath,
          pdfBuffer.length,
          `Photo Report - ${orderedPhotos.length} photo${orderedPhotos.length === 1 ? "" : "s"}`,
          String(
            user.full_name ||
              user.email ||
              "Team"
          ),
        ]
      )

      await pool.query(
        `
        insert into timeline_events
          (
            tenant_id,
            job_id,
            kind,
            message,
            meta,
            created_at
          )
        values
          (
            $1,
            $2,
            'photo_report_generated',
            $3,
            $4::jsonb,
            now()
          )
        `,
        [
          tenantId,
          numericJobId,
          `Photo report generated: ${reportName}`,
          JSON.stringify({
            asset_id: assetResult.rows[0].id,
            photo_count: orderedPhotos.length,
            photo_ids: photoIds,
            generated_by: String(
              user.full_name ||
                user.email ||
                "Team"
            ),
          }),
        ]
      )

      return {
        ok: true,
        report: {
          ...assetResult.rows[0],
          download_url:
            `/assets/${tenantSlug}/file/${assetResult.rows[0].id}`,
        },
      }
    } catch (err: any) {
      console.error("PHOTO REPORT ERROR:", err)

      reply.code(400)

      return {
        ok: false,
        error:
          err?.message ||
          "Photo report generation failed",
      }
    }
  })

  app.patch("/assets/:tenantSlug/job/:jobId/file/:assetId/metadata", async (req: any, reply) => {
    try {
      await ensureAssetCategoryColumn()

      const { tenantSlug, jobId, assetId } = req.params
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

      const body = req.body || {}
      const note = String(body.note || "").trim() || null
      const assetCategory =
        String(body.asset_category || "").trim() || "Documents"

      const result = await pool.query(
        `
        update job_assets
           set note = $1,
               asset_category = $2
         where tenant_id = $3
           and job_id = $4
           and id = $5
         returning
           id,
           note,
           asset_category
        `,
        [
          note,
          assetCategory,
          tenantId,
          numericJobId,
          Number(assetId),
        ]
      )

      if (!result.rowCount) {
        reply.code(404)
        return { ok: false, error: "File not found" }
      }

      await pool.query(
        `
        insert into timeline_events
          (tenant_id, job_id, kind, message, meta, created_at)
        values
          ($1, $2, 'job_asset_metadata_updated', $3, $4::jsonb, now())
        `,
        [
          tenantId,
          numericJobId,
          "File description or category updated",
          JSON.stringify({
            asset_id: Number(assetId),
            note,
            asset_category: assetCategory,
            updated_by: String(user.full_name || user.email || "Team"),
          }),
        ]
      )

      return {
        ok: true,
        asset: result.rows[0],
      }
    } catch (err: any) {
      reply.code(400)
      return {
        ok: false,
        error: err?.message || "Update file details failed",
      }
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
