import { pool } from "../db/db"

export type PackageType =
  | "retail_estimate"
  | "insurance_contract"
  | "ems_tarp"

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
      created_at,
      updated_at
    )
    values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, false), $12, $13, $14, now(), now()
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
    ]
  )

  return getEstimateDetailsByTenantSlug(tenantSlug, jobId)
}

function cleanAddress(job: any) {
  return [job.address1, job.city, job.state, job.zip].filter(Boolean).join(", ")
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

  return result.rows[0]
}
