import { pool } from "../db/db"
import { sendAlertEmail } from "./emailService"
import { sendSMS } from "./twilioService"
import { saveJobAssetByTenantSlug } from "./jobAssetsService"
import { buildDocumentSnapshotHtml } from "./documentTemplates/proposalContractHtml"

export type PackageType =
  | "retail_estimate"
  | "insurance_contract"
  | "ems_tarp"

async function saveDocumentSnapshotAsset(params: {
  tenantSlug: string
  jobId: number
  doc: any
  payload: any
  statusLabel: string
}) {
  const safeTitle = String(params.doc.document_title || "document")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  const html = buildDocumentSnapshotHtml(params.doc, params.payload, params.statusLabel)

  await saveJobAssetByTenantSlug({
    tenantSlug: params.tenantSlug,
    jobId: params.jobId,
    assetType: "contract",
    originalName: `${safeTitle}-${params.statusLabel.replace(/\s+/g, "-").toLowerCase()}.html`,
    mimeType: "text/html",
    note: `${params.statusLabel}: ${params.doc.document_title}`,
    uploadedBy: "Document Pipeline",
    fileBuffer: Buffer.from(html, "utf8"),
  })
}

async function ensureDocumentTables() {
  await pool.query(`
    create table if not exists job_estimate_details (
      id bigserial primary key,
      tenant_id bigint not null references tenants(id) on delete cascade,
      job_id bigint not null references jobs(id) on delete cascade,
      roof_type text null,
      roof_squares numeric(10,2) null,
      low_amount numeric(12,2) null,
      high_amount numeric(12,2) null,
      agreed_amount numeric(12,2) null,
      carrier_approved_amount numeric(12,2) null,
      claim_number text null,
      deductible text null,
      emergency_tarp_needed boolean not null default false,
      emergency_tarp_sqft numeric(10,2) null,
      callback_notes text null,
      estimator_remarks text null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, job_id)
    )
  `)

  await pool.query(`
    alter table job_estimate_details
      add column if not exists estimate_line_items jsonb,
      add column if not exists terms_and_conditions text,
      add column if not exists proposal_type text,
      add column if not exists proposal_amount numeric(12,2),
      add column if not exists contract_amount numeric(12,2),
      add column if not exists discount_amount numeric(12,2),
      add column if not exists discount_reason text;

    create table if not exists job_document_packages (
      id bigserial primary key,
      tenant_id bigint not null references tenants(id) on delete cascade,
      job_id bigint not null references jobs(id) on delete cascade,
      package_type text not null,
      document_title text not null,
      template_source text null,
      status text not null default 'draft_ready',
      payload jsonb not null default '{}'::jsonb,
      sent_at timestamptz null,
      signed_at timestamptz null,
      signed_file_path text null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
}

export async function getTenantIdBySlug(slug: string): Promise<number> {
  const result = await pool.query(
    `select id from tenants where slug = $1 limit 1`,
    [slug]
  )

  if (!result.rowCount) {
    throw new Error(`Tenant not found: ${slug}`)
  }

  return Number(result.rows[0].id)
}

function cleanAddress(job: any) {
  return [job.address1, job.city, job.state, job.zip].filter(Boolean).join(", ")
}

export async function getJobSummaryByTenantSlug(tenantSlug: string, jobId: number) {
  await ensureDocumentTables()
  const tenantId = await getTenantIdBySlug(tenantSlug)

  const result = await pool.query(
    `
    select
      j.id,
      j.tenant_id,
      j.customer_id,
      j.stage,
      j.crm_substatus,
      j.address1,
      j.city,
      j.state,
      j.zip,
      c.full_name as customer_name,
      c.email as customer_email,
      c.phone as customer_phone
    from jobs j
    left join customers c
      on c.id = j.customer_id
     and c.tenant_id = j.tenant_id
    where j.tenant_id = $1
      and j.id = $2
    limit 1
    `,
    [tenantId, jobId]
  )

  if (!result.rowCount) {
    throw new Error(`Job not found: ${jobId}`)
  }

  return result.rows[0]
}

export async function getEstimateDetailsByTenantSlug(tenantSlug: string, jobId: number) {
  await ensureDocumentTables()
  const tenantId = await getTenantIdBySlug(tenantSlug)

  const result = await pool.query(
    `
    select
      id,
      roof_type,
      roof_squares,
      low_amount,
      high_amount,
      agreed_amount,
      carrier_approved_amount,
      claim_number,
      deductible,
      emergency_tarp_needed,
      emergency_tarp_sqft,
      callback_notes,
      estimator_remarks,
      estimate_line_items,
      terms_and_conditions,
      proposal_type,
      proposal_amount,
      contract_amount,
      discount_amount,
      discount_reason,
      created_at,
      updated_at
    from job_estimate_details
    where tenant_id = $1
      and job_id = $2
    limit 1
    `,
    [tenantId, jobId]
  )

  return result.rowCount ? result.rows[0] : null
}

export async function upsertEstimateDetailsByTenantSlug(
  tenantSlug: string,
  jobId: number,
  input: {
    roof_type?: string | null
    roof_squares?: number | null
    low_amount?: number | null
    high_amount?: number | null
    agreed_amount?: number | null
    carrier_approved_amount?: number | null
    claim_number?: string | null
    deductible?: string | null
    emergency_tarp_needed?: boolean | null
    emergency_tarp_sqft?: number | null
    callback_notes?: string | null
    estimator_remarks?: string | null
    estimate_line_items?: Array<{ description: string; amount: number | null }>
    terms_and_conditions?: string | null
    proposal_type?: string | null
    proposal_amount?: number | null
    contract_amount?: number | null
    discount_amount?: number | null
    discount_reason?: string | null
  }
) {
  await ensureDocumentTables()
  const tenantId = await getTenantIdBySlug(tenantSlug)

  await pool.query(
    `
    insert into job_estimate_details (
      tenant_id,
      job_id,
      roof_type,
      roof_squares,
      low_amount,
      high_amount,
      agreed_amount,
      carrier_approved_amount,
      claim_number,
      deductible,
      emergency_tarp_needed,
      emergency_tarp_sqft,
      callback_notes,
      estimator_remarks,
      estimate_line_items,
      terms_and_conditions,
      proposal_type,
      proposal_amount,
      contract_amount,
      discount_amount,
      discount_reason,
      created_at,
      updated_at
    )
    values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, false), $12, $13, $14, $15::jsonb, $16, $17, $18, $19, $20, $21, now(), now()
    )
    on conflict (tenant_id, job_id)
    do update set
      roof_type = excluded.roof_type,
      roof_squares = excluded.roof_squares,
      low_amount = excluded.low_amount,
      high_amount = excluded.high_amount,
      agreed_amount = excluded.agreed_amount,
      carrier_approved_amount = excluded.carrier_approved_amount,
      claim_number = excluded.claim_number,
      deductible = excluded.deductible,
      emergency_tarp_needed = excluded.emergency_tarp_needed,
      emergency_tarp_sqft = excluded.emergency_tarp_sqft,
      callback_notes = excluded.callback_notes,
      estimator_remarks = excluded.estimator_remarks,
      estimate_line_items = excluded.estimate_line_items,
      terms_and_conditions = excluded.terms_and_conditions,
      proposal_type = excluded.proposal_type,
      proposal_amount = excluded.proposal_amount,
      contract_amount = excluded.contract_amount,
      discount_amount = excluded.discount_amount,
      discount_reason = excluded.discount_reason,
      updated_at = now()
    `,
    [
      tenantId,
      jobId,
      input.roof_type || null,
      input.roof_squares ?? null,
      input.low_amount ?? null,
      input.high_amount ?? null,
      input.agreed_amount ?? null,
      input.carrier_approved_amount ?? null,
      input.claim_number || null,
      input.deductible || null,
      input.emergency_tarp_needed ?? false,
      input.emergency_tarp_sqft ?? null,
      input.callback_notes || null,
      input.estimator_remarks || null,
      JSON.stringify(Array.isArray(input.estimate_line_items) ? input.estimate_line_items : []),
      input.terms_and_conditions || null,
      input.proposal_type || null,
      input.proposal_amount ?? null,
      input.contract_amount ?? input.proposal_amount ?? null,
      input.discount_amount ?? (
        input.proposal_amount != null && input.contract_amount != null
          ? Number(input.proposal_amount) - Number(input.contract_amount)
          : null
      ),
      input.discount_reason || null,
    ]
  )

  return getEstimateDetailsByTenantSlug(tenantSlug, jobId)
}

export async function listDocumentPackagesByTenantSlug(tenantSlug: string, jobId: number) {
  await ensureDocumentTables()
  const tenantId = await getTenantIdBySlug(tenantSlug)

  const result = await pool.query(
    `
    select
      id,
      package_type,
      document_title,
      template_source,
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
    order by created_at desc, id desc
    `,
    [tenantId, jobId]
  )

  return result.rows
}

export async function getDocumentPackageById(packageId: number) {
  await ensureDocumentTables()

  const result = await pool.query(
    `
    select
      p.id,
      p.tenant_id,
      t.slug as tenant_slug,
      p.job_id,
      p.package_type,
      p.document_title,
      p.template_source,
      p.status,
      p.payload,
      p.sent_at,
      p.signed_at,
      p.signed_file_path,
      p.created_at,
      p.updated_at
    from job_document_packages p
    join tenants t on t.id = p.tenant_id
    where p.id = $1
    limit 1
    `,
    [packageId]
  )

  return result.rowCount ? result.rows[0] : null
}

export async function createDocumentPackageByTenantSlug(
  tenantSlug: string,
  jobId: number,
  packageType: PackageType
) {
  await ensureDocumentTables()
  const tenantId = await getTenantIdBySlug(tenantSlug)
  const job = await getJobSummaryByTenantSlug(tenantSlug, jobId)
  const details = await getEstimateDetailsByTenantSlug(tenantSlug, jobId)

  const customerName = job.customer_name || "Unknown Customer"
  const address = cleanAddress(job)

  let documentTitle = ""
  let templateSource = ""
  let payload: Record<string, unknown> = {}

  if (packageType === "retail_estimate") {
    documentTitle = `Retail Estimate - ${customerName}`
    templateSource = "Roof Estimate - Bruno,J.pdf"
    payload = {
      customer_name: customerName,
      customer_email: job.customer_email || null,
      customer_phone: job.customer_phone || null,
      job_address: address,
      roof_type: details?.roof_type || null,
      roof_squares: details?.roof_squares || null,
      low_amount: details?.low_amount || null,
      high_amount: details?.high_amount || null,
      agreed_amount: details?.agreed_amount || null,
      proposal_type: details?.proposal_type || "retail",
      proposal_amount: details?.proposal_amount ?? details?.agreed_amount ?? null,
      contract_amount: details?.contract_amount ?? details?.proposal_amount ?? details?.agreed_amount ?? null,
      discount_amount: details?.discount_amount ?? null,
      discount_reason: details?.discount_reason || null,
      estimate_line_items: Array.isArray(details?.estimate_line_items) ? details.estimate_line_items : [],
      terms_and_conditions: details?.terms_and_conditions || null,
      estimator_remarks: details?.estimator_remarks || null,
      ready_for_signature: !!details?.agreed_amount,
    }
  } else if (packageType === "insurance_contract") {
    documentTitle = `Insurance Contract - ${customerName}`
    templateSource = "Roof Contract_ Bruno,J Claim#_ (1).pdf"
    payload = {
      customer_name: customerName,
      customer_email: job.customer_email || null,
      customer_phone: job.customer_phone || null,
      job_address: address,
      claim_number: details?.claim_number || null,
      carrier_approved_amount: details?.carrier_approved_amount || null,
      deductible: details?.deductible || null,
      proposal_type: details?.proposal_type || "insurance",
      proposal_amount: details?.proposal_amount ?? details?.carrier_approved_amount ?? null,
      contract_amount: details?.contract_amount ?? details?.proposal_amount ?? details?.carrier_approved_amount ?? null,
      discount_amount: details?.discount_amount ?? null,
      discount_reason: details?.discount_reason || null,
      vip_benefits_included: true,
      estimator_remarks: details?.estimator_remarks || null,
      ready_for_signature: !!details?.claim_number,
    }
  } else if (packageType === "ems_tarp") {
    documentTitle = `EMS Tarp Work Authorization - ${customerName}`
    templateSource = "EMS Work Auth_ Bruno,J-Claim#_.pdf"
    payload = {
      customer_name: customerName,
      customer_email: job.customer_email || null,
      customer_phone: job.customer_phone || null,
      job_address: address,
      claim_number: details?.claim_number || null,
      emergency_tarp_needed: !!details?.emergency_tarp_needed,
      emergency_tarp_sqft: details?.emergency_tarp_sqft || null,
      mobilization_fee: 250,
      tarp_rate_per_sqft: 2.5,
      estimator_remarks: details?.estimator_remarks || null,
      ready_for_signature: !!details?.emergency_tarp_needed,
    }
  } else {
    throw new Error(`Unsupported package type: ${packageType}`)
  }

  const result = await pool.query(
    `
    insert into job_document_packages (
      tenant_id,
      job_id,
      package_type,
      document_title,
      template_source,
      status,
      payload,
      created_at,
      updated_at
    )
    values (
      $1, $2, $3, $4, $5, 'draft_ready', $6::jsonb, now(), now()
    )
    returning
      id,
      package_type,
      document_title,
      template_source,
      status,
      payload,
      sent_at,
      signed_at,
      signed_file_path,
      created_at,
      updated_at
    `,
    [
      tenantId,
      jobId,
      packageType,
      documentTitle,
      templateSource,
      JSON.stringify(payload),
    ]
  )

  const createdPackage = result.rows[0]

  try {
    await saveDocumentSnapshotAsset({
      tenantSlug,
      jobId,
      doc: createdPackage,
      payload,
      statusLabel: "Draft Proposal Contract",
    })
  } catch (err) {
    console.error("Failed to save draft document snapshot:", err)
  }

  return createdPackage
}

export async function sendDocumentPackage(
  tenantSlug: string,
  jobId: number,
  packageId: number
) {
  await ensureDocumentTables()
  const tenantId = await getTenantIdBySlug(tenantSlug)

  const packageResult = await pool.query(
    `
    select *
    from job_document_packages
    where tenant_id = $1
      and job_id = $2
      and id = $3
    limit 1
    `,
    [tenantId, jobId, packageId]
  )

  if (!packageResult.rowCount) {
    throw new Error("Document package not found")
  }

  const documentPackage = packageResult.rows[0]
  const job = await getJobSummaryByTenantSlug(tenantSlug, jobId)

  const signBaseUrl =
    process.env.PUBLIC_SIGN_BASE_URL ||
    process.env.FRONTEND_BASE_URL ||
    "https://contractor-navigator.vercel.app"

  const signUrl = `${signBaseUrl.replace(/\/$/, "")}/sign/${documentPackage.id}`
  const message = `Good2Go Roofing: Your Proposal / Contract is ready for review and electronic signature. Please review the project details, terms, and authorization language here: ${signUrl}`

  let smsResult: any = null
  let emailResult: any = null

  if (job.customer_phone) {
    smsResult = await sendSMS(job.customer_phone, message)
  }

  if (job.customer_email) {
    emailResult = await sendAlertEmail(
      job.customer_email,
      documentPackage.document_title,
      message
    )
  }

  await pool.query(
    `
    update job_document_packages
    set
      status = 'sent',
      sent_at = now(),
      updated_at = now()
    where tenant_id = $1
      and job_id = $2
      and id = $3
    `,
    [tenantId, jobId, packageId]
  )

  await pool.query(
    `
    update jobs
    set
      stage = 'contract_sent',
      crm_substatus = 'signature_requested',
      contract_sent_at = coalesce(contract_sent_at, now()),
      updated_at = now()
    where tenant_id = $1
      and id = $2
    `,
    [tenantId, jobId]
  )

  await pool.query(
    `
    insert into timeline_events
      (tenant_id, job_id, kind, message, meta, created_at)
    values
      ($1, $2, 'document_package_sent', $3, $4::jsonb, now())
    `,
    [
      tenantId,
      jobId,
      `Proposal/Contract sent for electronic signature: ${documentPackage.document_title}`,
      JSON.stringify({
        package_id: packageId,
        package_type: documentPackage.package_type,
        document_title: documentPackage.document_title,
        sign_url: signUrl,
        proposal_amount: documentPackage.payload?.proposal_amount ?? documentPackage.payload?.agreed_amount ?? null,
        contract_amount: documentPackage.payload?.contract_amount ?? documentPackage.payload?.agreed_amount ?? null,
        discount_amount: documentPackage.payload?.discount_amount ?? null,
        discount_reason: documentPackage.payload?.discount_reason ?? null,
        crm_stage: "contract_sent",
        crm_substatus: "signature_requested",
        sms: smsResult,
        email: emailResult,
      }),
    ]
  )

  return {
    ok: true,
    package_id: packageId,
    sign_url: signUrl,
    sms: smsResult,
    email: emailResult,
  }
}

export async function signDocumentPackage(
  packageId: number,
  signerName: string,
  options: {
    terms_accepted?: boolean
    terms_version?: string | null
    terms_url?: string | null
  } = {}
) {
  await ensureDocumentTables()

  const doc = await getDocumentPackageById(packageId)

  if (!doc) {
    throw new Error("Document package not found")
  }

  const updatedPayload = {
    ...(doc.payload || {}),
    signed_by: signerName,
    signed_at: new Date().toISOString(),
    terms_accepted: options.terms_accepted ?? false,
    terms_version: options.terms_version || doc.payload?.terms_version || null,
    terms_url: options.terms_url || doc.payload?.terms_url || null,
  }

  const result = await pool.query(
    `
    update job_document_packages
    set
      status = 'signed',
      signed_at = now(),
      payload = $2::jsonb,
      updated_at = now()
    where id = $1
    returning *
    `,
    [packageId, JSON.stringify(updatedPayload)]
  )

  try {
    await saveDocumentSnapshotAsset({
      tenantSlug: String(doc.tenant_slug || "g2g-roofing"),
      jobId: Number(doc.job_id),
      doc,
      payload: updatedPayload,
      statusLabel: "Signed Proposal Contract",
    })
  } catch (err) {
    console.error("Failed to save signed document snapshot:", err)
  }

  const alertMsg = `SIGNED DEAL\n${doc.document_title}\nSigned by: ${signerName}`

  try {
    if (process.env.ALERT_SMS_TO) {
      await sendSMS(process.env.ALERT_SMS_TO, alertMsg)
    }

    if (process.env.ALERT_EMAIL_TO) {
      await sendAlertEmail(
        process.env.ALERT_EMAIL_TO,
        "Document Signed",
        alertMsg
      )
    }
  } catch (err) {
    console.error("Notification failed:", err)
  }

  await pool.query(
    `
    insert into timeline_events
      (tenant_id, job_id, kind, message, meta, created_at)
    values
      ($1, $2, 'document_package_signed', $3, $4::jsonb, now())
    `,
    [
      Number(doc.tenant_id),
      Number(doc.job_id),
      `Proposal/Contract electronically signed: ${doc.document_title}`,
      JSON.stringify({
        package_id: packageId,
        package_type: doc.package_type,
        document_title: doc.document_title,
        signer_name: signerName,
        proposal_amount: updatedPayload.proposal_amount ?? updatedPayload.agreed_amount ?? null,
        contract_amount: updatedPayload.contract_amount ?? updatedPayload.agreed_amount ?? null,
        discount_amount: updatedPayload.discount_amount ?? null,
        discount_reason: updatedPayload.discount_reason ?? null,
        terms_accepted: updatedPayload.terms_accepted ?? null,
        terms_version: updatedPayload.terms_version ?? null,
        terms_url: updatedPayload.terms_url ?? null,
      }),
    ]
  )

  return result.rows[0]
}
