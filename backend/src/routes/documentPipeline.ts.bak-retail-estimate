import type { FastifyInstance } from "fastify"
import {
  createDocumentPackageByTenantSlug,
  getDocumentPackageById,
  getEstimateDetailsByTenantSlug,
  getJobSummaryByTenantSlug,
  listDocumentPackagesByTenantSlug,
  sendDocumentPackage,
  signDocumentPackage,
  upsertEstimateDetailsByTenantSlug,
} from "../services/documentPipelineService"

export async function registerDocumentPipelineRoutes(app: FastifyInstance) {
  app.get("/pipeline/:tenantSlug/job/:jobId", async (request: any, reply) => {
    try {
      const { tenantSlug, jobId } = request.params
      const numericJobId = Number(jobId)

      const job = await getJobSummaryByTenantSlug(tenantSlug, numericJobId)
      const estimateDetails = await getEstimateDetailsByTenantSlug(tenantSlug, numericJobId)
      const documents = await listDocumentPackagesByTenantSlug(tenantSlug, numericJobId)

      return {
        ok: true,
        job,
        estimate_details: estimateDetails,
        documents,
      }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.post("/pipeline/:tenantSlug/job/:jobId/estimate-details", async (request: any, reply) => {
    try {
      const { tenantSlug, jobId } = request.params
      const numericJobId = Number(jobId)
      const body = request.body || {}

      const details = await upsertEstimateDetailsByTenantSlug(tenantSlug, numericJobId, {
        roof_type: body.roof_type,
        roof_squares:
          body.roof_squares === "" || body.roof_squares == null ? null : Number(body.roof_squares),
        low_amount:
          body.low_amount === "" || body.low_amount == null ? null : Number(body.low_amount),
        high_amount:
          body.high_amount === "" || body.high_amount == null ? null : Number(body.high_amount),
        agreed_amount:
          body.agreed_amount === "" || body.agreed_amount == null
            ? null
            : Number(body.agreed_amount),
        carrier_approved_amount:
          body.carrier_approved_amount === "" || body.carrier_approved_amount == null
            ? null
            : Number(body.carrier_approved_amount),
        claim_number: body.claim_number,
        deductible: body.deductible,
        emergency_tarp_needed: !!body.emergency_tarp_needed,
        emergency_tarp_sqft:
          body.emergency_tarp_sqft === "" || body.emergency_tarp_sqft == null
            ? null
            : Number(body.emergency_tarp_sqft),
        callback_notes: body.callback_notes,
        estimator_remarks: body.estimator_remarks,
      })

      return {
        ok: true,
        estimate_details: details,
      }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.post("/pipeline/:tenantSlug/job/:jobId/create-package", async (request: any, reply) => {
    try {
      const { tenantSlug, jobId } = request.params
      const numericJobId = Number(jobId)
      const { package_type } = request.body || {}

      const documentPackage = await createDocumentPackageByTenantSlug(
        tenantSlug,
        numericJobId,
        package_type
      )

      return {
        ok: true,
        document_package: documentPackage,
      }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.post("/pipeline/:tenantSlug/job/:jobId/send-package", async (request: any, reply) => {
    try {
      const { tenantSlug, jobId } = request.params
      const numericJobId = Number(jobId)
      const { package_id } = request.body || {}

      const result = await sendDocumentPackage(
        tenantSlug,
        numericJobId,
        Number(package_id)
      )

      return result
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.get("/sign/:id", async (request: any, reply) => {
    try {
      const { id } = request.params
      const document = await getDocumentPackageById(Number(id))

      if (!document) {
        reply.code(404)
        return { ok: false, error: "Document not found" }
      }

      return { ok: true, document }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.post("/sign/:id", async (request: any, reply) => {
    try {
      const { id } = request.params
      const { signer_name } = request.body || {}

      const result = await signDocumentPackage(Number(id), signer_name)

      return {
        ok: true,
        document: result,
      }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })
}
