import { pool } from "../db/db"
import { sendAlertEmail } from "./emailService"
import { sendSMS } from "./twilioService"
import { saveJobAssetByTenantSlug } from "./jobAssetsService"
import { buildDocumentSnapshotHtml } from "./documentTemplates/proposalContractHtml"
import { PDFDocument, StandardFonts } from "pdf-lib"
import fs from "fs"
import path from "path"

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


async function saveSignedEmsWaPdfAsset(params: {
  tenantSlug: string
  jobId: number
  doc: any
  payload: any
}) {
  const pdfDoc = await PDFDocument.create()

  const regularFont =
    await pdfDoc.embedFont(StandardFonts.Helvetica)

  const boldFont =
    await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const pageSize: [number, number] = [612, 792]
  const margin = 48
  const maxWidth = pageSize[0] - (margin * 2)
  const normalSize = 10
  const smallSize = 9
  const headingSize = 14
  const titleSize = 17
  const lineGap = 4

  let page = pdfDoc.addPage(pageSize)
  let y = pageSize[1] - margin

  function addPage() {
    page = pdfDoc.addPage(pageSize)
    y = pageSize[1] - margin
  }

  function ensureSpace(height: number) {
    if (y - height < margin) {
      addPage()
    }
  }

  function wrapText(
    value: unknown,
    font: any,
    size: number,
    width: number
  ) {
    const text =
      String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()

    if (!text) {
      return [""]
    }

    const words = text.split(" ")
    const lines: string[] = []
    let current = ""

    for (const word of words) {
      const candidate =
        current
          ? `${current} ${word}`
          : word

      if (
        current &&
        font.widthOfTextAtSize(
          candidate,
          size
        ) > width
      ) {
        lines.push(current)
        current = word
      } else {
        current = candidate
      }
    }

    if (current) {
      lines.push(current)
    }

    return lines
  }

  function drawWrapped(
    value: unknown,
    options: {
      font?: any
      size?: number
      indent?: number
      after?: number
    } = {}
  ) {
    const font =
      options.font || regularFont

    const size =
      options.size || normalSize

    const indent =
      options.indent || 0

    const after =
      options.after ?? 8

    const lines =
      wrapText(
        value,
        font,
        size,
        maxWidth - indent
      )

    const lineHeight =
      size + lineGap

    ensureSpace(
      Math.max(
        lineHeight,
        lines.length * lineHeight
      ) + after
    )

    for (const line of lines) {
      page.drawText(
        line || " ",
        {
          x: margin + indent,
          y,
          size,
          font,
        }
      )

      y -= lineHeight
    }

    y -= after
  }

  function drawField(
    label: string,
    value: unknown
  ) {
    const normalized =
      String(value ?? "—").trim() || "—"

    drawWrapped(
      `${label}: ${normalized}`,
      {
        size: normalSize,
        after: 3,
      }
    )
  }

  function drawHeading(
    value: string
  ) {
    ensureSpace(headingSize + 20)

    y -= 4

    page.drawText(
      value,
      {
        x: margin,
        y,
        size: headingSize,
        font: boldFont,
      }
    )

    y -= headingSize + 10
  }

  const payload =
    params.payload || {}

  const customer =
    payload.customer_name ||
    payload.insured_name ||
    "Customer"

  const safeCustomer =
    String(customer)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") ||
    "Customer"

  pdfDoc.setTitle(
    `Emergency Tarp Work Authorization - ${customer}`
  )

  pdfDoc.setSubject(
    `Signed Emergency Tarp Work Authorization for job ${params.jobId}`
  )

  pdfDoc.setCreator(
    "Good2Go Roofing & Construction LLC"
  )

  pdfDoc.setProducer(
    "Contractor Navigator"
  )

  const logoCandidates = [
    path.resolve(
      process.cwd(),
      "../dashboard/public/branding/g2g-logo.png"
    ),
    path.resolve(
      process.cwd(),
      "dashboard/public/branding/g2g-logo.png"
    ),
  ]

  const logoPath =
    logoCandidates.find((candidate) =>
      fs.existsSync(candidate)
    ) || null

  let logoHeight = 0

  if (logoPath) {
    try {
      const logoBytes =
        fs.readFileSync(logoPath)

      const logo =
        await pdfDoc.embedPng(logoBytes)

      const logoSize =
        logo.scaleToFit(105, 82)

      logoHeight =
        logoSize.height

      page.drawImage(
        logo,
        {
          x: margin,
          y:
            pageSize[1] -
            margin -
            logoSize.height,
          width:
            logoSize.width,
          height:
            logoSize.height,
        }
      )
    } catch (err) {
      console.error(
        "Failed to embed G2G logo in signed EMS WA PDF:",
        err
      )
    }
  } else {
    console.warn(
      "G2G logo asset not found for signed EMS WA PDF"
    )
  }

  const headerTextX =
    logoHeight > 0
      ? margin + 125
      : margin

  page.drawText(
    "Good2Go Roofing & Construction LLC",
    {
      x: headerTextX,
      y,
      size: 12,
      font: boldFont,
    }
  )

  y -= 22

  page.drawText(
    "EMS Tarp Work Authorization",
    {
      x: headerTextX,
      y,
      size: titleSize,
      font: boldFont,
    }
  )

  if (logoHeight > 0) {
    y =
      Math.min(
        y - 28,
        pageSize[1] -
          margin -
          logoHeight -
          16
      )
  } else {
    y -= 28
  }

  drawField(
    "Customer",
    customer
  )

  drawField(
    "Phone",
    payload.customer_phone
  )

  drawField(
    "Email",
    payload.customer_email
  )

  drawField(
    "Property Address",
    payload.job_address
  )

  drawField(
    "Carrier",
    payload.carrier ||
    payload.tpa
  )

  drawField(
    "Claim Number",
    payload.claim_number
  )

  drawField(
    "Date of Loss",
    payload.date_of_loss
  )


  drawHeading(
    "Project Details"
  )

  drawWrapped(
    `Property: ${
      payload.job_address ||
      "Address to be confirmed"
    }`
  )

  drawWrapped(
    `Good2Go Roofing and Construction LLC was assigned by ${
      payload.carrier ||
      payload.tpa ||
      "your insurance carrier"
    } to provide emergency services at this property.`
  )

  drawWrapped(
    "By signing below, I authorize Good2Go Roofing and Construction LLC and their affiliates to provide a roof inspection and, upon their assessment of damages, install a tarp in affected areas as deemed necessary."
  )

  drawWrapped(
    "I understand that all photos, invoices, and estimates for repairs and/or replacement will be processed through the appropriate insurance assignment process for authorization and payment."
  )


  drawHeading(
    "Electronic Signature"
  )

  drawField(
    "Signed By",
    payload.signed_by ||
    "—"
  )

  drawField(
    "Signed At",
    payload.signed_at ||
    "—"
  )

  drawField(
    "Terms Accepted",
    payload.terms_accepted === true
      ? "Yes"
      : "No"
  )

  drawWrapped(
    "Electronic Signature Statement: Typed signature accepted as electronic signature.",
    {
      size: smallSize,
      after: 10,
    }
  )


  drawHeading(
    "Terms and Conditions"
  )

  drawWrapped(
    G2G_STANDARD_WA_TERMS,
    {
      size: smallSize,
      after: 0,
    }
  )

  const pdfBytes =
    await pdfDoc.save()

  const pdfBuffer =
    Buffer.from(pdfBytes)

  await saveJobAssetByTenantSlug({
    tenantSlug: params.tenantSlug,
    jobId: params.jobId,
    assetType: "contract",
    originalName:
      `${safeCustomer}-Signed-Emergency-Tarp-Work-Authorization.pdf`,
    mimeType: "application/pdf",
    note:
      `Signed Emergency Tarp Work Authorization: ${params.doc.document_title}`,
    uploadedBy:
      "Document Pipeline",
    fileBuffer:
      pdfBuffer,
  })
}

const G2G_STANDARD_WA_TERMS = 'If the carrier does not approve the claim, or deems that damages are not under a covered loss, I acknowledge that I may be responsible for any balance due for the services provided.'

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
      add column if not exists discount_reason text,
      add column if not exists tpa text;

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
      j.carrier,
      j.claim_number as job_claim_number,
      j.date_of_loss,
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
      tpa,
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
    tpa?: string | null
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
      tpa,
      created_at,
      updated_at
    )
    values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, false), $12, $13, $14, $15::jsonb, $16, $17, $18, $19, $20, $21, $22, now(), now()
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
      tpa = excluded.tpa,
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
      input.tpa || null,
    ]
  )

  return getEstimateDetailsByTenantSlug(tenantSlug, jobId)
}

export async function setEmergencyTarpNeededByTenantSlug(
  tenantSlug: string,
  jobId: number,
  needed: boolean
) {
  await ensureDocumentTables()
  const tenantId = await getTenantIdBySlug(tenantSlug)

  const updated = await pool.query(
    `
    update job_estimate_details
    set
      emergency_tarp_needed = $3,
      updated_at = now()
    where tenant_id = $1
      and job_id = $2
    returning job_id
    `,
    [tenantId, jobId, needed]
  )

  if (!updated.rowCount) {
    await pool.query(
      `
      insert into job_estimate_details (
        tenant_id,
        job_id,
        emergency_tarp_needed,
        created_at,
        updated_at
      )
      values ($1, $2, $3, now(), now())
      `,
      [tenantId, jobId, needed]
    )
  }

  return {
    ok: true,
    tenant_id: tenantId,
    job_id: jobId,
    emergency_tarp_needed: needed,
  }
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

export async function regenerateDocumentSnapshotAsset(packageId: number) {
  await ensureDocumentTables()

  const doc = await getDocumentPackageById(packageId)

  if (!doc) {
    throw new Error("Document package not found")
  }

  const statusLabel =
    doc.status === "signed"
      ? "Signed Proposal Contract"
      : doc.status === "sent"
        ? "Sent Proposal Contract"
        : "Draft Proposal Contract"

  await saveDocumentSnapshotAsset({
    tenantSlug: String(doc.tenant_slug || "g2g-roofing"),
    jobId: Number(doc.job_id),
    doc,
    payload: doc.payload || {},
    statusLabel,
  })

  await pool.query(
    `
    insert into timeline_events
      (tenant_id, job_id, kind, message, meta, created_at)
    values
      ($1, $2, 'document_snapshot_regenerated', $3, $4::jsonb, now())
    `,
    [
      Number(doc.tenant_id),
      Number(doc.job_id),
      `Document snapshot regenerated from stored package payload: ${doc.document_title}`,
      JSON.stringify({
        author: "ECO Document Pipeline",
        package_id: packageId,
        package_type: doc.package_type,
        document_title: doc.document_title,
        package_status: doc.status,
        signed_at: doc.signed_at || null,
      }),
    ]
  )

  return {
    ok: true,
    package_id: packageId,
    job_id: Number(doc.job_id),
    status: doc.status,
    document_title: doc.document_title,
    status_label: statusLabel,
  }
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
    documentTitle = `Retail Estimate / Contract - ${customerName}`
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
      proposal_contract_amount:
        details?.contract_amount ??
        details?.proposal_amount ??
        details?.agreed_amount ??
        null,
      vip_benefits_included: true,
      document_display_mode: "retail_contract",
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
      carrier: job.carrier || null,
      claim_number: details?.claim_number || job.job_claim_number || null,
      date_of_loss: job.date_of_loss || null,
      carrier_approved_amount: details?.carrier_approved_amount || null,
      deductible: details?.deductible || null,
      proposal_type: details?.proposal_type || "insurance",
      proposal_amount: details?.proposal_amount ?? details?.carrier_approved_amount ?? null,
      contract_amount: details?.contract_amount ?? details?.proposal_amount ?? details?.carrier_approved_amount ?? null,
      discount_amount: details?.discount_amount ?? null,
      discount_reason: details?.discount_reason || null,
      vip_benefits_included: true,
      estimator_remarks: details?.estimator_remarks || null,
      document_display_mode: "insurance_contract",
      ready_for_signature: !!(details?.claim_number || job.job_claim_number),
    }
  } else if (packageType === "ems_tarp") {
    documentTitle = `EMS Tarp Work Authorization - ${customerName}`
    templateSource = "EMS Work Auth_ Bruno,J-Claim#_.pdf"
    payload = {
      customer_name: customerName,
      customer_email: job.customer_email || null,
      customer_phone: job.customer_phone || null,
      job_address: address,
      tpa: details?.tpa || null,
      carrier: job.carrier || null,
      claim_number: details?.claim_number || job.job_claim_number || null,
      date_of_loss: job.date_of_loss || null,
      emergency_tarp_needed: !!details?.emergency_tarp_needed,
      emergency_tarp_sqft: details?.emergency_tarp_sqft || null,
      mobilization_fee: 250,
      tarp_rate_per_sqft: 2.5,
      estimator_remarks: details?.estimator_remarks || null,
      terms_and_conditions: G2G_STANDARD_WA_TERMS,
      document_display_mode: "ems_work_authorization",
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
  const isEmsTarp = documentPackage.package_type === "ems_tarp"

  const message = isEmsTarp
    ? `Good2Go Roofing & Construction was assigned by ${documentPackage.payload?.carrier || "your insurance carrier"} to provide emergency services at ${documentPackage.payload?.job_address || "your property"}. Before we can inspect the roof and, if necessary, perform emergency tarp work, we need your signed Emergency Tarp Work Authorization.

Please review and sign the authorization here: ${signUrl}

Once we receive it, your job will move into our emergency service queue for inspection and crew assignment as needed.`
    : `Good2Go Roofing: Your Proposal / Contract is ready for review and electronic signature.

Please review the project details, pricing, authorization language, and terms and conditions before signing.

Sign here: ${signUrl}`

  let smsResult: any = null
  let emailResult: any = null
  let internalSmsResult: any = null
  let internalEmailResult: any = null

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

  const internalNotificationEmail =
    process.env.SIGNED_DOCUMENT_EMAIL_TO ||
    process.env.G2G_GMAIL_TO ||
    "good2goroofingandconstruction@gmail.com"

  const internalAlertMsg = isEmsTarp
    ? `EMERGENCY TARP WA SENT\n` +
      `${documentPackage.document_title}\n` +
      `Job ID: ${jobId}\n` +
      `Customer: ${job.customer_name || "Unknown"}\n` +
      `Phone: ${job.customer_phone || "Unknown"}\n` +
      `Email: ${job.customer_email || "Unknown"}\n` +
      `Sign Link: ${signUrl}\n\n` +
      `Status: Waiting on Emergency Tarp Work Authorization signature.`
    : `CONTRACT SENT\n` +
      `${documentPackage.document_title}\n` +
      `Job ID: ${jobId}\n` +
      `Customer: ${job.customer_name || "Unknown"}\n` +
      `Phone: ${job.customer_phone || "Unknown"}\n` +
      `Email: ${job.customer_email || "Unknown"}\n` +
      `Amount: ${documentPackage.payload?.contract_amount ?? documentPackage.payload?.proposal_amount ?? documentPackage.payload?.agreed_amount ?? "Unknown"}\n` +
      `Sign Link: ${signUrl}\n\n` +
      `Status: Waiting on customer signature.`

  try {
    if (process.env.ALERT_SMS_TO) {
      internalSmsResult = await sendSMS(process.env.ALERT_SMS_TO, internalAlertMsg)
    }

    if (internalNotificationEmail) {
      internalEmailResult = await sendAlertEmail(
        internalNotificationEmail,
        documentPackage.package_type === "ems_tarp"
          ? `Emergency Tarp WA Sent: ${job.customer_name || `Job #${jobId}`}`
          : `Contract Sent: ${job.customer_name || `Job #${jobId}`}`,
        internalAlertMsg
      )
    }
  } catch (err: any) {
    internalEmailResult = internalEmailResult || { error: err?.message || String(err) }
  }

  if (documentPackage.package_type === "ems_tarp") {
    await pool.query(
      `
      update jobs
      set
        stage = 'wa_sent',
        crm_substatus = 'ems_authorization_sent',
        wa_status = 'sent',
        wa_sent_at = now(),
        updated_at = now()
      where tenant_id = $1
        and id = $2
      `,
      [tenantId, jobId]
    )
  } else {
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
  }

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
      documentPackage.package_type === "ems_tarp"
        ? `Emergency Tarp Work Authorization sent for electronic signature: ${documentPackage.document_title}`
        : `Proposal/Contract sent for electronic signature: ${documentPackage.document_title}`,
      JSON.stringify({
        author: "ECO Document Pipeline",
        package_id: packageId,
        package_type: documentPackage.package_type,
        document_title: documentPackage.document_title,
        sign_url: signUrl,
        proposal_amount: documentPackage.payload?.proposal_amount ?? documentPackage.payload?.agreed_amount ?? null,
        contract_amount: documentPackage.payload?.contract_amount ?? documentPackage.payload?.agreed_amount ?? null,
        discount_amount: documentPackage.payload?.discount_amount ?? null,
        discount_reason: documentPackage.payload?.discount_reason ?? null,
        crm_stage: documentPackage.package_type === "ems_tarp" ? "wa_sent" : "contract_sent",
        crm_substatus:
          documentPackage.package_type === "ems_tarp"
            ? "ems_authorization_sent"
            : "signature_requested",
        sms: smsResult,
        email: emailResult,
        internal_sms: internalSmsResult,
        internal_email: internalEmailResult,
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
      statusLabel:
        doc.package_type === "ems_tarp"
          ? "Signed Emergency Tarp Work Authorization"
          : "Signed Proposal Contract",
    })
  } catch (err) {
    console.error("Failed to save signed document snapshot:", err)
  }

  const isEmsTarp = doc.package_type === "ems_tarp"

  if (isEmsTarp) {
    try {
      await saveSignedEmsWaPdfAsset({
        tenantSlug: String(doc.tenant_slug || "g2g-roofing"),
        jobId: Number(doc.job_id),
        doc,
        payload: updatedPayload,
      })
    } catch (err) {
      console.error(
        "Failed to save signed EMS WA PDF:",
        err
      )
    }

    await pool.query(
      `
      update jobs
      set
        stage = 'tarp',
        crm_substatus = 'ems_authorized_ready_for_crew',
        wa_status = 'signed',
        wa_signed_at = now(),
        updated_at = now()
      where tenant_id = $1
        and id = $2
      `,
      [Number(doc.tenant_id), Number(doc.job_id)]
    )
  }

  const alertMsg = isEmsTarp
    ? `EMS TARP AUTHORIZATION SIGNED\n${doc.document_title}\nSigned by: ${signerName}\nJob ID: ${doc.job_id}\nStatus: READY FOR CREW ASSIGNMENT`
    : `SIGNED DEAL\n${doc.document_title}\nSigned by: ${signerName}`

  const customerAckMsg = isEmsTarp
    ? `Good2Go Roofing: Thank you. We received your Emergency Tarp Work Authorization and your property is now in our emergency tarp queue. We have not forgotten you. We will assign a crew and notify them of your needs. During a major storm, power outages, blocked roads, weather conditions, safety issues, and geographic crew routing can affect response times. If you have a tree on the roof, severe active water intrusion, unsafe access, or another urgent circumstance, reply to this message so our staff and crew can be notified.`
    : `Good2Go Roofing: Thank you. We received your signed Proposal / Contract for ${doc.document_title}. A production staff member will review it and contact you soon with next steps.`

  try {
    if (process.env.ALERT_SMS_TO) {
      await sendSMS(process.env.ALERT_SMS_TO, alertMsg)
    }

    const signedNotificationEmail =
      process.env.SIGNED_DOCUMENT_EMAIL_TO ||
      process.env.G2G_GMAIL_TO ||
      "good2goroofingandconstruction@gmail.com"

    if (signedNotificationEmail) {
      await sendAlertEmail(
        signedNotificationEmail,
        isEmsTarp
          ? "Emergency Tarp Work Authorization Signed — Ready for Crew"
          : "Document Signed",
        alertMsg
      )
    }

    if (updatedPayload.customer_email) {
      await sendAlertEmail(
        String(updatedPayload.customer_email),
        isEmsTarp
          ? "Good2Go Roofing received your Emergency Tarp Work Authorization"
          : "Good2Go Roofing received your signed Proposal / Contract",
        customerAckMsg
      )
    }

    if (updatedPayload.customer_phone) {
      await sendSMS(String(updatedPayload.customer_phone), customerAckMsg)
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
      isEmsTarp
        ? `Emergency Tarp Work Authorization signed — ready for crew: ${doc.document_title}`
        : `Proposal/Contract electronically signed: ${doc.document_title}`,
      JSON.stringify({
        author: signerName || "Customer",
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
        crm_stage: isEmsTarp ? "tarp" : null,
        crm_substatus: isEmsTarp ? "ems_authorized_ready_for_crew" : null,
        wa_status: isEmsTarp ? "signed" : null,
      }),
    ]
  )

  return result.rows[0]
}
