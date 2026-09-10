import { timingSafeEqual } from "crypto"
import fs from "node:fs"
import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { resolveJobAssetsForOutbound } from "../services/jobAssetsService"

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function suppliedServiceSecret(request: any): string {
  return String(
    request.headers["x-aa-activity-secret"] ||
      request.headers.authorization?.replace(/^Bearer\s+/i, "") ||
      ""
  ).trim()
}

function requireFinancialOperationsService(request: any): boolean {
  const expected = String(
    process.env.AA_ACTIVITY_GATEWAY_SECRET || ""
  ).trim()

  const supplied = suppliedServiceSecret(request)

  return Boolean(
    expected &&
      supplied &&
      safeEqual(expected, supplied)
  )
}

async function getTenantBySlug(
  tenantSlug: string
): Promise<{ id: number; slug: string } | null> {
  const result = await pool.query(
    `
      select id, slug
      from tenants
      where slug = $1
      limit 1
    `,
    [tenantSlug]
  )

  if (!result.rowCount) return null

  return {
    id: Number(result.rows[0].id),
    slug: String(result.rows[0].slug),
  }
}

export async function registerFinancialOperationsBridgeRoutes(
  app: FastifyInstance
) {
  app.get(
    "/integrations/financial-operations/:tenantSlug/financial-census",
    async (request: any, reply) => {
      if (!requireFinancialOperationsService(request)) {
        return reply.code(401).send({
          ok: false,
          error: "Authentication required",
        })
      }

      const tenantSlug = String(
        request.params?.tenantSlug || ""
      ).trim()

      if (!tenantSlug) {
        return reply.code(400).send({
          ok: false,
          error: "tenantSlug is required",
        })
      }

      const tenant = await getTenantBySlug(tenantSlug)

      if (!tenant) {
        return reply.code(404).send({
          ok: false,
          error: "Tenant not found",
        })
      }

      const jobsResult = await pool.query(
        `
          select
            j.id as job_id,
            j.customer_id,
            j.external_job_id,
            j.stage,
            j.job_type,
            j.address1,
            j.city,
            j.state,
            j.zip,
            j.created_at,
            j.updated_at,
            c.full_name as customer_name,
            c.phone as customer_phone,
            c.email as customer_email,
            jed.contract_amount
          from jobs j
          left join customers c
            on c.id = j.customer_id
           and c.tenant_id = j.tenant_id
          left join job_estimate_details jed
            on jed.job_id = j.id
           and jed.tenant_id = j.tenant_id
          where j.tenant_id = $1
          order by j.id asc
        `,
        [tenant.id]
      )

      const timelineResult = await pool.query(
        `
          select
            id,
            job_id,
            kind,
            message,
            meta,
            created_at
          from timeline_events
          where tenant_id = $1
          order by job_id asc, created_at asc, id asc
        `,
        [tenant.id]
      )

      const packagesResult = await pool.query(
        `
          select
            id,
            job_id,
            package_type,
            document_title,
            status,
            payload,
            sent_at,
            signed_at,
            signed_file_path,
            created_at,
            updated_at
          from job_document_packages
          where tenant_id = $1
          order by job_id asc, created_at asc, id asc
        `,
        [tenant.id]
      )

      const assetsResult = await pool.query(
        `
          select
            id,
            job_id,
            asset_type,
            original_name,
            mime_type,
            note,
            uploaded_by,
            created_at
          from job_assets
          where tenant_id = $1
          order by job_id asc, created_at asc, id asc
        `,
        [tenant.id]
      )

      const timelineByJob = new Map<number, any[]>()
      for (const row of timelineResult.rows) {
        const jobId = Number(row.job_id)
        const items = timelineByJob.get(jobId) || []
        items.push({
          id: Number(row.id),
          kind: row.kind || null,
          message: row.message || null,
          meta: row.meta || {},
          created_at: row.created_at || null,
        })
        timelineByJob.set(jobId, items)
      }

      const packagesByJob = new Map<number, any[]>()
      for (const row of packagesResult.rows) {
        const jobId = Number(row.job_id)
        const items = packagesByJob.get(jobId) || []
        items.push({
          id: Number(row.id),
          package_type: row.package_type || null,
          document_title: row.document_title || null,
          status: row.status || null,
          payload: row.payload || {},
          sent_at: row.sent_at || null,
          signed_at: row.signed_at || null,
          signed_file_path: row.signed_file_path || null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
        })
        packagesByJob.set(jobId, items)
      }

      const assetsByJob = new Map<number, any[]>()
      for (const row of assetsResult.rows) {
        const jobId = Number(row.job_id)
        const items = assetsByJob.get(jobId) || []
        items.push({
          id: Number(row.id),
          asset_type: row.asset_type || null,
          original_name: row.original_name || null,
          mime_type: row.mime_type || null,
          note: row.note || null,
          uploaded_by: row.uploaded_by || null,
          created_at: row.created_at || null,
        })
        assetsByJob.set(jobId, items)
      }

      const jobs = jobsResult.rows.map((row) => {
        const jobId = Number(row.job_id)
        const timeline = timelineByJob.get(jobId) || []
        const documentPackages = packagesByJob.get(jobId) || []
        const assets = assetsByJob.get(jobId) || []

        const hasStructuredContractValue =
          row.contract_amount !== null &&
          row.contract_amount !== undefined

        const hasSignedDocument = documentPackages.some(
          (item) =>
            item.status === "signed" ||
            item.signed_at !== null
        )

        const hasInvoiceAsset = assets.some(
          (item) => item.asset_type === "invoice"
        )

        const hasSupportingEvidence =
          timeline.length > 0 ||
          documentPackages.length > 0 ||
          assets.length > 0

        const flags: string[] = []

        if (hasStructuredContractValue) {
          flags.push("STRUCTURED_CONTRACT_VALUE")
        }

        if (hasSignedDocument) {
          flags.push("SIGNED_FINANCIAL_DOCUMENT")
        }

        if (hasInvoiceAsset) {
          flags.push("INVOICE_ASSET_EVIDENCE")
        }

        if (
          hasStructuredContractValue &&
          hasSupportingEvidence
        ) {
          flags.push(
            "STRUCTURED_VALUE_PLUS_SUPPORTING_EVIDENCE"
          )
        }

        if (
          !hasStructuredContractValue &&
          !hasSupportingEvidence
        ) {
          flags.push("NO_FINANCIAL_EVIDENCE")
        }

        if (
          !hasStructuredContractValue &&
          hasSupportingEvidence
        ) {
          flags.push("REVIEW_REQUIRED")
        }

        return {
          job_id: jobId,
          external_job_id: row.external_job_id || null,
          customer: {
            id:
              row.customer_id === null
                ? null
                : Number(row.customer_id),
            name: row.customer_name || null,
            phone: row.customer_phone || null,
            email: row.customer_email || null,
          },
          job_type: row.job_type || null,
          stage: row.stage || null,
          archived: row.stage === "archived",
          address1: row.address1 || null,
          city: row.city || null,
          state: row.state || null,
          zip: row.zip || null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
          structured_financial: {
            contract_amount:
              row.contract_amount ?? null,
            authority:
              "job_estimate_details.contract_amount",
          },
          evidence: {
            timeline,
            document_packages: documentPackages,
            assets,
          },
          flags,
        }
      })

      return reply.send({
        ok: true,
        source: "contractor-navigator",
        mode: "read-only-financial-census",
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
        },
        population: {
          total_jobs: jobsResult.rowCount || 0,
          returned_jobs: jobs.length,
          complete:
            (jobsResult.rowCount || 0) === jobs.length,
        },
        jobs,
      })
    }
  )

  app.get(
    "/integrations/financial-operations/:tenantSlug/jobs/:jobId",
    async (request: any, reply) => {
      if (!requireFinancialOperationsService(request)) {
        return reply.code(401).send({
          ok: false,
          error: "Authentication required",
        })
      }

      const tenantSlug = String(
        request.params?.tenantSlug || ""
      ).trim()

      const jobId = Number(request.params?.jobId)

      if (!tenantSlug) {
        return reply.code(400).send({
          ok: false,
          error: "tenantSlug is required",
        })
      }

      if (!Number.isInteger(jobId) || jobId <= 0) {
        return reply.code(400).send({
          ok: false,
          error: "Valid jobId is required",
        })
      }

      const tenant = await getTenantBySlug(tenantSlug)

      if (!tenant) {
        return reply.code(404).send({
          ok: false,
          error: "Tenant not found",
        })
      }

      const result = await pool.query(
        `
          select
            j.id as job_id,
            j.customer_id,
            j.external_job_id,
            j.stage,
            j.job_type,
            j.address1,
            j.city,
            j.state,
            j.zip,
            j.created_at,
            j.updated_at,
            j.carrier,
            j.claim_number,
            c.full_name as customer_name,
            c.phone as customer_phone,
            c.email as customer_email,
            jed.contract_amount
          from jobs j
          left join customers c
            on c.id = j.customer_id
           and c.tenant_id = j.tenant_id
          left join job_estimate_details jed
            on jed.job_id = j.id
           and jed.tenant_id = j.tenant_id
          where j.tenant_id = $1
            and j.id = $2
          limit 1
        `,
        [tenant.id, jobId]
      )

      if (!result.rowCount) {
        return reply.code(404).send({
          ok: false,
          error: "Job not found",
        })
      }

      const row = result.rows[0]

      const timelineResult = await pool.query(
        `
          select
            id,
            kind,
            message,
            meta,
            created_at
          from timeline_events
          where tenant_id = $1
            and job_id = $2
          order by created_at asc, id asc
        `,
        [tenant.id, jobId]
      )

      const packagesResult = await pool.query(
        `
          select
            id,
            package_type,
            document_title,
            status,
            payload,
            sent_at,
            signed_at,
            signed_file_path,
            created_at,
            updated_at
          from job_document_packages
          where tenant_id = $1
            and job_id = $2
          order by created_at asc, id asc
        `,
        [tenant.id, jobId]
      )

      const assetsResult = await pool.query(
        `
          select
            id,
            asset_type,
            original_name,
            mime_type,
            note,
            uploaded_by,
            created_at
          from job_assets
          where tenant_id = $1
            and job_id = $2
          order by created_at asc, id asc
        `,
        [tenant.id, jobId]
      )

      const timeline = timelineResult.rows.map((item) => ({
        id: Number(item.id),
        kind: item.kind || null,
        message: item.message || null,
        meta: item.meta || {},
        created_at: item.created_at || null,
      }))

      const documentPackages = packagesResult.rows.map((item) => ({
        id: Number(item.id),
        package_type: item.package_type || null,
        document_title: item.document_title || null,
        status: item.status || null,
        payload: item.payload || {},
        sent_at: item.sent_at || null,
        signed_at: item.signed_at || null,
        signed_file_path: item.signed_file_path || null,
        created_at: item.created_at || null,
        updated_at: item.updated_at || null,
      }))

      const assets = assetsResult.rows.map((item) => ({
        id: Number(item.id),
        asset_type: item.asset_type || null,
        original_name: item.original_name || null,
        mime_type: item.mime_type || null,
        note: item.note || null,
        uploaded_by: item.uploaded_by || null,
        created_at: item.created_at || null,
      }))

      return reply.send({
        ok: true,
        source: "contractor-navigator",
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
        },
        customer: {
          id:
            row.customer_id === null
              ? null
              : Number(row.customer_id),
          name: row.customer_name || null,
          phone: row.customer_phone || null,
          email: row.customer_email || null,
        },
        job: {
          id: Number(row.job_id),
          external_job_id: row.external_job_id || null,
          stage: row.stage || null,
          job_type: row.job_type || null,
          carrier: row.carrier || null,
          claim_number: row.claim_number || null,
          address1: row.address1 || null,
          city: row.city || null,
          state: row.state || null,
          zip: row.zip || null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
          contract_amount: row.contract_amount ?? null,
        },
        evidence: {
          timeline,
          document_packages: documentPackages,
          assets,
        },
      })
    }
  )

  app.get(
    "/integrations/financial-operations/:tenantSlug/jobs",
    async (request: any, reply) => {
      if (!requireFinancialOperationsService(request)) {
        return reply.code(401).send({
          ok: false,
          error: "Authentication required",
        })
      }

      const tenantSlug = String(
        request.params?.tenantSlug || ""
      ).trim()

      const view =
        String(request.query?.view || "active")
          .trim()
          .toLowerCase() === "archived"
          ? "archived"
          : "active"

      if (!tenantSlug) {
        return reply.code(400).send({
          ok: false,
          error: "tenantSlug is required",
        })
      }

      const tenant = await getTenantBySlug(tenantSlug)

      if (!tenant) {
        return reply.code(404).send({
          ok: false,
          error: "Tenant not found",
        })
      }

      const result = await pool.query(
        `
          select
            j.id,
            j.external_job_id,
            j.stage,
            j.job_type,
            j.address1,
            j.city,
            j.state,
            j.zip,
            j.created_at,
            j.updated_at,
            c.id as customer_id,
            c.full_name as customer_name
          from jobs j
          left join customers c
            on c.id = j.customer_id
           and c.tenant_id = j.tenant_id
          where j.tenant_id = $1
            and (
              ($2 = 'archived' and j.stage = 'archived')
              or
              (
                $2 = 'active'
                and coalesce(j.stage, '') <> 'archived'
              )
            )
          order by j.id desc
          limit 500
        `,
        [tenant.id, view]
      )

      return reply.send({
        ok: true,
        source: "contractor-navigator",
        view,
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
        },
        jobs: result.rows.map((row) => ({
          id: Number(row.id),
          external_job_id: row.external_job_id || null,
          stage: row.stage || null,
          job_type: row.job_type || null,
          address1: row.address1 || null,
          city: row.city || null,
          state: row.state || null,
          zip: row.zip || null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
          customer: {
            id:
              row.customer_id == null
                ? null
                : Number(row.customer_id),
            name: row.customer_name || null,
          },
        })),
      })
    }
  )

  app.get(
    "/integrations/financial-operations/:tenantSlug/customers",
    async (request: any, reply) => {
      if (!requireFinancialOperationsService(request)) {
        return reply.code(401).send({
          ok: false,
          error: "Authentication required",
        })
      }

      const tenantSlug = String(
        request.params?.tenantSlug || ""
      ).trim()

      const view =
        String(request.query?.view || "active")
          .trim()
          .toLowerCase() === "archived"
          ? "archived"
          : "active"

      if (!tenantSlug) {
        return reply.code(400).send({
          ok: false,
          error: "tenantSlug is required",
        })
      }

      const tenant = await getTenantBySlug(tenantSlug)

      if (!tenant) {
        return reply.code(404).send({
          ok: false,
          error: "Tenant not found",
        })
      }

      const result = await pool.query(
        `
          select
            c.id,
            c.full_name,
            c.created_at,
            c.updated_at,
            count(j.id)::int as jobs_count
          from customers c
          join jobs j
            on j.customer_id = c.id
           and j.tenant_id = c.tenant_id
          where c.tenant_id = $1
            and (
              ($2 = 'archived' and j.stage = 'archived')
              or
              (
                $2 = 'active'
                and coalesce(j.stage, '') <> 'archived'
              )
            )
          group by
            c.id,
            c.full_name,
            c.created_at,
            c.updated_at
          having count(j.id) > 0
          order by
            c.full_name asc nulls last,
            c.id desc
          limit 500
        `,
        [tenant.id, view]
      )

      return reply.send({
        ok: true,
        source: "contractor-navigator",
        view,
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
        },
        customers: result.rows.map((row) => ({
          id: Number(row.id),
          name: row.full_name || null,
          jobs_count: Number(row.jobs_count || 0),
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
        })),
      })
    }
  )

  app.get(
    "/integrations/financial-operations/:tenantSlug/customers/:customerId",
    async (request: any, reply) => {
      if (!requireFinancialOperationsService(request)) {
        return reply.code(401).send({
          ok: false,
          error: "Authentication required",
        })
      }

      const tenantSlug = String(
        request.params?.tenantSlug || ""
      ).trim()

      const customerId = Number(
        request.params?.customerId
      )

      const view =
        String(request.query?.view || "active")
          .trim()
          .toLowerCase() === "archived"
          ? "archived"
          : "active"

      if (
        !Number.isInteger(customerId) ||
        customerId <= 0
      ) {
        return reply.code(400).send({
          ok: false,
          error: "Valid customerId is required",
        })
      }

      const tenant = await getTenantBySlug(tenantSlug)

      if (!tenant) {
        return reply.code(404).send({
          ok: false,
          error: "Tenant not found",
        })
      }

      const customerResult = await pool.query(
        `
          select
            id,
            full_name,
            created_at,
            updated_at
          from customers
          where tenant_id = $1
            and id = $2
          limit 1
        `,
        [tenant.id, customerId]
      )

      if (!customerResult.rowCount) {
        return reply.code(404).send({
          ok: false,
          error: "Customer not found",
        })
      }

      const jobsResult = await pool.query(
        `
          select
            id,
            external_job_id,
            stage,
            job_type,
            address1,
            city,
            state,
            zip,
            created_at,
            updated_at
          from jobs
          where tenant_id = $1
            and customer_id = $2
            and (
              ($3 = 'archived' and stage = 'archived')
              or
              (
                $3 = 'active'
                and coalesce(stage, '') <> 'archived'
              )
            )
          order by id desc
          limit 200
        `,
        [tenant.id, customerId, view]
      )

      const customer = customerResult.rows[0]

      return reply.send({
        ok: true,
        source: "contractor-navigator",
        view,
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
        },
        customer: {
          id: Number(customer.id),
          name: customer.full_name || null,
          created_at: customer.created_at || null,
          updated_at: customer.updated_at || null,
        },
        jobs: jobsResult.rows.map((job) => ({
          id: Number(job.id),
          external_job_id: job.external_job_id || null,
          stage: job.stage || null,
          job_type: job.job_type || null,
          address1: job.address1 || null,
          city: job.city || null,
          state: job.state || null,
          zip: job.zip || null,
          created_at: job.created_at || null,
          updated_at: job.updated_at || null,
        })),
      })
    }
  )


  app.get(
    "/integrations/financial-operations/:tenantSlug/jobs/:jobId/assets/:assetId/file",
    async (request: any, reply) => {
      if (!requireFinancialOperationsService(request)) {
        return reply.code(401).send({
          ok: false,
          error: "Authentication required",
        })
      }

      const tenantSlug = String(
        request.params?.tenantSlug || ""
      ).trim()

      const jobId = Number(request.params?.jobId)
      const assetId = Number(request.params?.assetId)

      if (!tenantSlug) {
        return reply.code(400).send({
          ok: false,
          error: "tenantSlug is required",
        })
      }

      if (!Number.isInteger(jobId) || jobId <= 0) {
        return reply.code(400).send({
          ok: false,
          error: "Valid jobId is required",
        })
      }

      if (!Number.isInteger(assetId) || assetId <= 0) {
        return reply.code(400).send({
          ok: false,
          error: "Valid assetId is required",
        })
      }

      try {
        const assets = await resolveJobAssetsForOutbound(
          tenantSlug,
          jobId,
          [assetId]
        )

        if (assets.length !== 1) {
          return reply.code(404).send({
            ok: false,
            error: "Asset not found",
          })
        }

        const asset = assets[0] as {
          id: number
          original_name: string | null
          stored_path: string
          mime_type: string | null
          file_size_bytes: number | null
        }

        reply.header(
          "Content-Type",
          asset.mime_type || "application/octet-stream"
        )

        reply.header(
          "Content-Disposition",
          `inline; filename="${String(
            asset.original_name || `asset-${assetId}`
          ).replace(/["\r\n]/g, "")}"`
        )

        return reply.send(
          fs.createReadStream(asset.stored_path)
        )
      } catch (error: any) {
        request.log.error(
          {
            err: error,
            tenantSlug,
            jobId,
            assetId,
          },
          "Financial Operations asset bridge failed"
        )

        return reply.code(404).send({
          ok: false,
          error: "Asset not found",
        })
      }
    }
  )


}
