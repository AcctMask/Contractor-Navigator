import type { FastifyInstance } from "fastify"
import {
  createDocumentPackageByTenantSlug,
  getEstimateDetailsByTenantSlug,
  getJobSummaryByTenantSlug,
  listDocumentPackagesByTenantSlug,
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
}
