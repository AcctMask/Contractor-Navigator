import { weatherAddressesMatch } from "../services/weatherAddressMatching";
import { saveJobAssetByTenantSlug } from "../services/jobAssetsService"
import { generateWeatherEvidencePdf } from "../services/weatherEvidencePdfService"
import type { FastifyInstance } from "fastify";
import { pool } from "../db/db";
import { sendSMS } from "../services/twilioService";
import { sendAlertEmail } from "../services/emailService";

const DEFAULT_TENANT = "g2g-roofing";

async function getTenantIdBySlug(slug: string): Promise<number> {
  const t = await pool.query(`select id from tenants where slug=$1 limit 1`, [slug]);
  if (!t.rowCount) throw new Error(`tenant not found: ${slug}`);
  return Number(t.rows[0].id);
}

function asString(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function classifyLeadIntent(body: any): { intent: string; recommendedAction: string } {
  const timeline = String(body.projectTimeline || "").toLowerCase();
  const budget = String(body.budgetComfort || "").toLowerCase();
  const roofingPreference = String(body.roofingPreference || "").toLowerCase();

  if (timeline.includes("asap") && (budget.includes("balanced") || budget.includes("premium"))) {
    return {
      intent: "high_intent",
      recommendedAction: "Call quickly. Customer appears closer-ready. Confirm details, pricing comfort, and next step."
    };
  }

  if (timeline.includes("30") || timeline.includes("60")) {
    return {
      intent: "medium_intent",
      recommendedAction: "Let Autopilot nurture. Follow up with options, material guidance, and timing."
    };
  }

  if (timeline.includes("researching") || budget.includes("lowest")) {
    return {
      intent: "low_intent",
      recommendedAction: "Automated follow-up only. Do not spend inspection or measurement time unless customer re-engages."
    };
  }

  if (roofingPreference.includes("metal")) {
    return {
      intent: "metal_interest",
      recommendedAction: "Clarify that standing seam metal is typically about 2x shingle pricing before spending time."
    };
  }

  return {
    intent: "standard_estimate",
    recommendedAction: "Standard estimate follow-up. Let Autopilot continue nurturing."
  };
}

function classifyEstimatorLead(body: any): { jobType: string; stage: string; crmSubstatus: string | null } {
  const text = [
    body.custSource,
    body.source,
    body.heardAbout,
    body.notes,
    body.roofType,
    body.estimateSummary,
  ]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");

  if (
    text.includes("tarp") ||
    text.includes("emergency") ||
    text.includes("ems") ||
    text.includes("mitigation") ||
    text.includes("alacrity") ||
    text.includes("preferred repair") ||
    text.includes("prn")
  ) {
    return {
      jobType: "TARP",
      stage: "tarp",
      crmSubstatus: "possible_emergency_tarp",
    };
  }

  if (
    text.includes("repair") ||
    text.includes("leak") ||
    text.includes("patch")
  ) {
    return {
      jobType: "ROOF_REPAIR",
      stage: "roof_repair",
      crmSubstatus: "possible_roof_repair",
    };
  }

  return {
    jobType: "ROOF_REPLACEMENT",
    stage: "estimate_sent",
    crmSubstatus: null,
  };
}

async function findOrCreateCustomer(
  tenantId: number,
  fullName: string | null,
  phone: string | null,
  email: string | null,
  address: string | null
): Promise<number> {
  // First: match by property address so property managers / repeat callers do not get merged by phone.
  if (address) {
    const byAddress = await pool.query(
      `select c.id
       from customers c
       join jobs j
         on j.customer_id = c.id
        and j.tenant_id = c.tenant_id
       where c.tenant_id = $1
         and lower(trim(j.address1)) = lower(trim($2))
       limit 1`,
      [tenantId, address]
    );

    if (byAddress.rowCount) return Number(byAddress.rows[0].id);
  }

  // Do not match by phone or email alone. Address/property is the job anchor.

  const inserted = await pool.query(
    `insert into customers (tenant_id, full_name, phone, email)
     values ($1,$2,$3,$4)
     returning id`,
    [tenantId, fullName, phone, email]
  );

  return Number(inserted.rows[0].id);
}

async function registerLeadRoutes(app: FastifyInstance) {

  app.post("/lead/contact", async (req, reply) => {
    try {
      const body: any = (req as any).body || {}

      const tenantSlug = asString(body.tenant_slug) || DEFAULT_TENANT
      const tenantId = await getTenantIdBySlug(tenantSlug)

      const fullName =
        asString(body.name) ||
        asString(body.Field1) ||
        "Unknown Lead"

      const email =
        asString(body.email) ||
        asString(body.Field2)

      const phone =
        asString(body.phone) ||
        asString(body.Field3)

      const zip =
        asString(body.zip) ||
        asString(body.Field4)

      const product =
        asString(body.product) ||
        asString(body.Field5) ||
        "Website Contact"

      const customerId = await findOrCreateCustomer(
        tenantId,
        fullName,
        phone,
        email,
        null
      )

      const insertedJob = await pool.query(
        `
        insert into jobs (
          tenant_id,
          customer_id,
          external_crm,
          external_job_id,
          job_type,
          stage,
          crm_substatus,
          address1,
          city,
          state,
          zip,
          lead_source,
          lead_source_detail
        )
        values (
          $1,$2,
          'website_contact_form',
          $3,
          $4,
          'lead',
          null,
          null,
          null,
          'FL',
          $5,
          'Website',
          'Contact Form'
        )
        returning id
        `,
        [
          tenantId,
          customerId,
          `contact-${Date.now()}`,
          product,
          zip,
        ]
      )

      const jobId = Number(insertedJob.rows[0].id)

      let customerSmsResult: any = null
      let customerEmailResult: any = null
      let ownerSmsResult: any = null
      let ownerEmailResult: any = null

      const customerAck =
        `Good2Go Roofing: Thank you for contacting us. We received your request about ${product}. A team member will follow up with you soon. Reply STOP to opt out.`

      const ownerAlert =
        `NEW WEBSITE CONTACT\n\n` +
        `Customer: ${fullName}\n` +
        `Job ID: ${jobId}\n` +
        `Phone: ${phone || "Unknown"}\n` +
        `Email: ${email || "Unknown"}\n` +
        `ZIP: ${zip || "Unknown"}\n` +
        `Requested Service: ${product}\n\n` +
        `Source: Website Contact Form`

      try {
        if (phone) {
          customerSmsResult = await sendSMS(phone, customerAck)
        } else {
          customerSmsResult = { skipped: true, reason: "missing_phone" }
        }

        if (email) {
          customerEmailResult = await sendAlertEmail(
            email,
            "Good2Go Roofing received your request",
            customerAck
          )
        } else {
          customerEmailResult = { skipped: true, reason: "missing_email" }
        }

        if (process.env.ALERT_SMS_TO) {
          ownerSmsResult = await sendSMS(process.env.ALERT_SMS_TO, ownerAlert)
        } else {
          ownerSmsResult = { skipped: true, reason: "missing_alert_sms_to" }
        }

        const ownerEmailTo =
          process.env.G2G_GMAIL_TO ||
          process.env.ALERT_EMAIL_TO ||
          "good2goroofingandconstruction@gmail.com"

        if (ownerEmailTo) {
          ownerEmailResult = await sendAlertEmail(
            ownerEmailTo,
            `New website contact: ${fullName}`,
            ownerAlert
          )
        }
      } catch (err: any) {
        ownerEmailResult = ownerEmailResult || { error: err?.message || String(err) }
      }

      await pool.query(
        `
        insert into timeline_events (
          tenant_id, job_id, kind, message, meta, created_at
        )
        values ($1,$2,'lead_created',$3,$4::jsonb,now())
        `,
        [
          tenantId,
          jobId,
          `Website contact form received: ${product}`,
          JSON.stringify({
            source: "wordpress_contact_form",
            product,
            raw_payload: body,
            customer_sms: customerSmsResult,
            customer_email: customerEmailResult,
            owner_sms: ownerSmsResult,
            owner_email: ownerEmailResult,
          }),
        ]
      )

      reply.header("Content-Type", "text/html; charset=utf-8")
      return reply.send(`
        <!doctype html>
        <html>
          <head>
            <title>Thank you</title>
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <style>
              body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
              .box { max-width: 640px; margin: 0 auto; }
              h1 { color: #166534; }
            </style>
          </head>
          <body>
            <div class="box">
              <h1>Thank you for contacting Good2Go Roofing.</h1>
              <p>We received your request and a team member will be in touch soon.</p>
              <p>You may close this page.</p>
            </div>
          </body>
        </html>
      `)
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || "Contact form intake failed" }
    }
  })

  app.post("/lead/new", async (req, reply) => {
    const body: any = (req as any).body || {};

    const tenantSlug = asString(body.tenant_slug) || DEFAULT_TENANT;
    const tenantId = await getTenantIdBySlug(tenantSlug);

    const fullName = asString(body.name) || "Unknown Lead";
    const phone = asString(body.phone);
    const email = asString(body.email);

    const customerId = await findOrCreateCustomer(tenantId, fullName, phone, email, asString(body.address));
    const classification = {
      jobType: "ROOF_REPLACEMENT",
      stage: "estimate_sent",
      crmSubstatus: null,
    };
    const leadIntent = classifyLeadIntent(body);

const insertedJob = await pool.query(
  `insert into jobs (
    tenant_id,
    customer_id,
    external_crm,
    external_job_id,
    job_type,
    stage,
    crm_substatus,
    address1,
    city,
    state,
    zip,
    lead_source,
    lead_source_detail
  )
  values (
    $1,$2,
    'estimator_app',
    $3,
    $4,
    $5,
    $6,
    $7,$8,$9,$10,
    $11,
    $12
  )
  returning id`,
  [
    tenantId,
    customerId,
    `est-${Date.now()}`,

    classification.jobType,
    classification.stage,
    classification.crmSubstatus,

    asString(body.address),
    asString(body.city),
    asString(body.state),
    asString(body.zip),

    asString(body.lead_source) ||
      "Estimator",

    asString(body.lead_source_detail) ||
      asString(body.custSource) ||
      asString(body.source) ||
      asString(body.heardAbout) ||
      "instant_estimator",
  ]
);
    const jobId = Number(insertedJob.rows[0].id);

    await pool.query(
      `
      update jobs
         set crm_substatus = coalesce($1, crm_substatus),
             crm_flow_key = $2,
             updated_at = now()
       where tenant_id = $3
         and id = $4
      `,
      [
        leadIntent.intent,
        `estimator_${leadIntent.intent}`,
        tenantId,
        jobId
      ]
    );

    // Save structured estimate details for sales + AI follow-up
    try {
      const { upsertEstimateDetailsByTenantSlug } = await import("../services/documentPipelineService")

      await upsertEstimateDetailsByTenantSlug(tenantSlug, jobId, {
        roof_type: asString(body.roofType),
        roof_squares: body.roofSqft ? Number(body.roofSqft) / 100 : null,
        low_amount: body.estimateLow ? Number(body.estimateLow) : null,
        high_amount: body.estimateHigh ? Number(body.estimateHigh) : null,
        estimator_remarks: asString(body.estimateSummary)
      })
    } catch (err) {
      console.error("Failed to save estimate details", err)
    }

    await pool.query(
      `insert into timeline_events (
        tenant_id, job_id, kind, message, meta
      )
      values ($1,$2,'lead_created','Website estimate received',$3)`,
      [tenantId, jobId, JSON.stringify(body)]
    );

    const estimateDetailsMeta = {
      roof_type: asString(body.roofType),
      stories: asString(body.stories),
      condition: asString(body.condition),
      structure_sqft: body.structureSqft ? Number(body.structureSqft) : null,
      roof_sqft: body.roofSqft ? Number(body.roofSqft) : null,
      estimate_low: body.estimateLow ? Number(body.estimateLow) : null,
      estimate_high: body.estimateHigh ? Number(body.estimateHigh) : null,
      estimate_summary: asString(body.estimateSummary),
      project_timeline: asString(body.projectTimeline),
      roofing_preference: asString(body.roofingPreference),
      budget_comfort: asString(body.budgetComfort),
      lead_intent: leadIntent.intent,
      recommended_action: leadIntent.recommendedAction,
      estimator_notes: asString(body.notes),
      captured_at: new Date().toISOString()
    };

    const estimateDetailsMessage =
      `Estimator details captured\n` +
      `Roof Type: ${estimateDetailsMeta.roof_type || "-"}\n` +
      `Stories: ${estimateDetailsMeta.stories || "-"}\n` +
      `Condition: ${estimateDetailsMeta.condition || "-"}\n` +
      `Home Sq Ft: ${estimateDetailsMeta.structure_sqft || "-"}\n` +
      `Roof Sq Ft: ${estimateDetailsMeta.roof_sqft || "-"}\n` +
      `Estimate Low: ${estimateDetailsMeta.estimate_low || "-"}\n` +
      `Estimate High: ${estimateDetailsMeta.estimate_high || "-"}\n` +
      `Estimate Summary: ${estimateDetailsMeta.estimate_summary || "-"}\n` +
      `Project Timeline: ${estimateDetailsMeta.project_timeline || "-"}\n` +
      `Roofing Preference: ${estimateDetailsMeta.roofing_preference || "-"}\n` +
      `Budget Comfort: ${estimateDetailsMeta.budget_comfort || "-"}\n` +
      `Lead Intent: ${estimateDetailsMeta.lead_intent || "-"}\n` +
      `Recommended Action: ${estimateDetailsMeta.recommended_action || "-"}\n` +
      `Customer Notes: ${estimateDetailsMeta.estimator_notes || "-"}`;

    await pool.query(
      `insert into timeline_events (
        tenant_id, job_id, kind, message, meta
      )
      values ($1,$2,'estimate_details',$3,$4)`,
      [
        tenantId,
        jobId,
        estimateDetailsMessage,
        JSON.stringify(estimateDetailsMeta)
      ]
    );

    await pool.query(
      `insert into timeline_events (
        tenant_id, job_id, kind, message, meta
      )
      values ($1,$2,'lead_intent_classified',$3,$4)`,
      [
        tenantId,
        jobId,
        `Lead classified as ${leadIntent.intent}. Recommended action: ${leadIntent.recommendedAction}`,
        JSON.stringify({
          lead_intent: leadIntent.intent,
          recommended_action: leadIntent.recommendedAction,
          projectTimeline: asString(body.projectTimeline),
          roofingPreference: asString(body.roofingPreference),
          budgetComfort: asString(body.budgetComfort)
        })
      ]
    );


    try {
      await fetch(
        process.env.AA_ACTIVITY_GATEWAY_URL ||
          "https://actual-assistant-owner-controls.vercel.app/api/record-activity",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-aa-activity-secret":
              process.env.AA_ACTIVITY_GATEWAY_SECRET || "",
          },
          body: JSON.stringify({
            tenant_slug: tenantSlug,
            module_id: "instant_estimator",
            module_name: "Instant Roof Estimator",
            activity_type: "estimate_request_created",
            title: "New estimate request received",
            description:
              "Instant estimator generated a homeowner roof estimate request.",
            source: "website_estimator",
            metadata: {
              customer_name: asString(body.name),
              phone: asString(body.phone),
              email: asString(body.email),
              address: asString(body.address),
              city: asString(body.city),
              zip: asString(body.zip),
              roof_type: asString(body.roofType),
              estimate_low: body.estimateLow
                ? Number(body.estimateLow)
                : null,
              estimate_high: body.estimateHigh
                ? Number(body.estimateHigh)
                : null,
              job_id: jobId,
            },
          }),
        }
      );
    } catch (err) {
      console.error("Failed to report estimator activity", err);
    }

    return reply.send({
      ok: true,
      job_id: jobId,
      lead_intent: leadIntent.intent,
      recommended_action: leadIntent.recommendedAction
    });
  });


  app.post("/lead/weather-evidence", async (req, reply) => {

    const configuredKey = process.env.STORM_NAVIGATOR_SECRET;
    const suppliedKey = req.headers["x-storm-integration-key"];

    if (!configuredKey ||
        typeof suppliedKey !== "string" ||
        suppliedKey !== configuredKey) {
      return reply.code(401).send({
        ok: false,
        error: "Unauthorized Storm Verification integration"
      });
    }


    const body: any = (req as any).body || {};

    const tenantSlug = asString(body.tenant_slug) || DEFAULT_TENANT;
    const tenantId = await getTenantIdBySlug(tenantSlug);

    const fullName = asString(body.name) || "Unknown Lead";
    const phone = asString(body.phone);
    const email = asString(body.email);
    const address = asString(body.address);

    if (!address) {
      return reply.code(400).send({
        ok: false,
        error: "Property address is required"
      });
    }

    if (tenantSlug !== "g2g-roofing") {
      return reply.code(403).send({
        ok: false,
        error: "Weather evidence intake is restricted to Good2Go"
      });
    }

    const reportId = asString(body.report_id);

    if (!reportId) {
      return reply.code(400).send({
        ok: false,
        error: "Weather report ID is required"
      });
    }

    const weatherReport = body.weather_report;

    if (!weatherReport?.ok ||
        weatherReport.report_id !== reportId ||
        !Array.isArray(weatherReport.events)) {
      return reply.code(400).send({
        ok: false,
        error: "Complete Storm Verification report is required"
      });
    }


    const reportAddress = asString(
      weatherReport.property?.address ||
      weatherReport.property?.formatted_address
    );
    if (!reportAddress ||
        !weatherAddressesMatch(address, reportAddress)) {
      return reply.code(400).send({
        ok: false,
        error: "Weather report property does not match submitted address"
      });
    }

    const existingReport = await pool.query(
      `select job_id
       from timeline_events
       where tenant_id = $1
         and kind = 'weather_evidence_report_generated'
         and meta->>'report_id' = $2
       order by created_at desc
       limit 1`,
      [tenantId, reportId]
    );

    if (existingReport.rowCount) {
      return reply.send({
        ok: true,
        job_id: Number(existingReport.rows[0].job_id),
        already_submitted: true
      });
    }

    // Storm Verification only: find candidate properties without
    // requiring a homeowner to enter a full postal address.
    const candidates = await pool.query(
      `select j.id, j.stage, j.customer_id, j.address1,
              j.city, j.state, j.zip,
              c.full_name as customer_name
         from jobs j
         left join customers c on c.id = j.customer_id
        where j.tenant_id = $1
        order by j.created_at desc`,
      [tenantId]
    );

    const enteredCity = asString(body.city);
    const matchingRows = candidates.rows.filter((job: any) => {
      // Compare against the existing complete job address without
      // modifying Navigator's stored customer or property records.
      const jobAddress = [
        job.address1,
        job.city,
        job.state,
        job.zip
      ].filter((part: unknown) => String(part || "").trim()).join(", ");
      if (!weatherAddressesMatch(address, jobAddress)) {
        return false;
      }
      if (enteredCity && job.city &&
          enteredCity.trim().toLowerCase() !==
          String(job.city).trim().toLowerCase()) {
        return false;
      }
      return true;
    });

    const matchingJobs = {
      rows: matchingRows,
      rowCount: matchingRows.length
    };

    // Storm Verification: property address is the primary job identity.
    // Use the unique address match regardless of minor customer-name differences.
    // Where multiple jobs share an address, require one unambiguous name match.
    const normalizeStormCustomerName = (value: unknown) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

    const normalizedName = normalizeStormCustomerName(fullName);

    const eligibleJobs = matchingJobs.rows.filter((job: any) =>
      normalizeStormCustomerName(job.customer_name) === normalizedName
    );

    let jobId: number;

    if (matchingJobs.rowCount === 1) {
      jobId = Number(matchingJobs.rows[0].id);
    } else if (eligibleJobs.length === 1) {
      jobId = Number(eligibleJobs[0].id);
    } else if (matchingJobs.rowCount) {
      return reply.code(409).send({
        ok: false,
        error: "Property has existing jobs requiring staff review before attaching weather evidence"
      });
    } else {
      const customerId = await findOrCreateCustomer(
        tenantId,
        fullName,
        phone,
        email,
        address
      );

      const insertedJob = await pool.query(
        `insert into jobs (
          tenant_id, customer_id, external_crm, external_job_id,
          job_type, stage, crm_substatus, crm_flow_key,
          address1, city, state, zip,
          lead_source, lead_source_detail
        )
        values (
          $1,$2,'storm_verification',$3,
          'ROOF_REPLACEMENT','lead',
          'weather_evidence_report_generated','weather_evidence_report',
          $4,$5,$6,$7,
          'Storm Verification','weather_evidence_report'
        )
        returning id`,
        [
          tenantId,
          customerId,
          `weather-${reportId}`,
          address,
          asString(body.city),
          asString(body.state),
          asString(body.zip)
        ]
      );

      jobId = Number(insertedJob.rows[0].id);
    }



    const pdfName = `Weather-Evidence-${reportId}.pdf`;
    const existingPdf = await pool.query(
      `select to_regclass('public.job_assets') as table_name`
    );
    const savedPdf = existingPdf.rows[0]?.table_name
      ? await pool.query(
          `select id from job_assets
           where tenant_id = $1 and job_id = $2
             and original_name = $3 limit 1`,
          [tenantId, jobId, pdfName]
        )
      : { rowCount: 0 };

    if (!savedPdf.rowCount) {
    const pdfBuffer = await generateWeatherEvidencePdf(weatherReport);


    await saveJobAssetByTenantSlug({
      tenantSlug,
      jobId,
      assetType: "other",
      assetCategory: "Documents",
      originalName: `Weather-Evidence-${reportId}.pdf`,
      mimeType: "application/pdf",
      note: "Professional Storm Verification weather evidence report",
      uploadedBy: "Storm Verification",
      fileBuffer: pdfBuffer
    });
    }

    const reportMeta = {
      source: "storm_verification",
      report_id: asString(body.report_id),
      report_generated_at: asString(body.report_generated_at),
      report_type: asString(body.report_type) || "Weather Evidence Report",
      property_address: address,
      property_county: asString(body.property_county),
      property_zip: asString(body.zip),
      search_start: asString(body.search_start),
      search_end: asString(body.search_end),
      search_radius_miles: body.search_radius_miles ? Number(body.search_radius_miles) : null,
      events_within_radius: weatherReport.weather_evidence_summary?.events_within_radius != null ? Number(weatherReport.weather_evidence_summary.events_within_radius) : null,
      hail_observations: weatherReport.weather_evidence_summary?.hail_observations != null ? Number(weatherReport.weather_evidence_summary.hail_observations) : null,
      wind_observations: weatherReport.weather_evidence_summary?.wind_observations != null ? Number(weatherReport.weather_evidence_summary.wind_observations) : null,
      highest_wind_mph: weatherReport.weather_evidence_summary?.highest_wind_mph != null ? Number(weatherReport.weather_evidence_summary.highest_wind_mph) : null,
      largest_hail_in: weatherReport.weather_evidence_summary?.largest_hail_in != null ? Number(weatherReport.weather_evidence_summary.largest_hail_in) : null,
    };

    await pool.query(
      `insert into timeline_events (
        tenant_id, job_id, kind, message, meta
      )
      values ($1,$2,'weather_evidence_report_generated',$3,$4)`,
      [
        tenantId,
        jobId,
        `Weather Evidence Report generated and added to ECO${reportMeta.report_id ? `: ${reportMeta.report_id}` : ""}`,
        JSON.stringify(reportMeta)
      ]
    );

    try {
      const recipient = process.env.G2G_GMAIL_TO ||
        process.env.ALERT_EMAIL_TO ||
        "good2goroofingandconstruction@gmail.com";
      const message = [
        "New Storm Verification Weather Evidence Report",
        `Customer: ${fullName}`,
        `Phone: ${phone || "Not provided"}`,
        `Email: ${email || "Not provided"}`,
        `Property: ${address}`,
        `Report ID: ${reportId}`,
        `Search: ${reportMeta.search_start} through ${reportMeta.search_end}`,
        `Radius: ${reportMeta.search_radius_miles ?? "N/A"} miles`,
        `Wind: ${reportMeta.highest_wind_mph ?? "N/A"} MPH`,
        `Hail: ${reportMeta.largest_hail_in ?? "N/A"} inches`,
        `Navigator Job ID: ${jobId}`,
        "The complete professional PDF is archived in Job Documents."
      ].join("\n");
      const emailResult = await sendAlertEmail(recipient,
        `Storm Verification Report: ${fullName}`, message);
      if (!emailResult.ok) {
        req.log.error({ reportId, error: emailResult.error },
          "Storm Verification email was not accepted");
      }
    } catch (emailError) {
      req.log.error({ err: emailError, reportId },
        "Storm Verification staff notification failed");
    }

    // Verify both durable records before confirming archival success.
    const verifiedPdf = await pool.query(
      `select id from job_assets
       where tenant_id = $1 and job_id = $2
         and original_name = $3
       limit 1`,
      [tenantId, jobId, pdfName]
    );

    const verifiedActivity = await pool.query(
      `select id from timeline_events
       where tenant_id = $1 and job_id = $2
         and kind = 'weather_evidence_report_generated'
         and meta->>'report_id' = $3
       limit 1`,
      [tenantId, jobId, reportId]
    );

    if (!verifiedPdf.rowCount || !verifiedActivity.rowCount) {
      req.log.error(
        { reportId, jobId,
          pdfSaved: Boolean(verifiedPdf.rowCount),
          activitySaved: Boolean(verifiedActivity.rowCount) },
        "Weather evidence archival verification failed"
      );
      return reply.code(502).send({
        ok: false,
        error: "Weather report archival could not be fully verified"
      });
    }

    return reply.send({
      ok: true,
      job_id: jobId,
      crm_flow_key: "weather_evidence_report",
      stage: "lead"
    });
  });


  app.post("/lead/contract-click", async (req, reply) => {
    const body: any = (req as any).body || {};

    const tenantSlug = asString(body.tenant_slug) || DEFAULT_TENANT;
    const tenantId = await getTenantIdBySlug(tenantSlug);

    const fullName = asString(body.name);
    const phone = asString(body.phone);
    const email = asString(body.email);

    const customerId = await findOrCreateCustomer(tenantId, fullName, phone, email, asString(body.address));

    const insertedJob = await pool.query(
      `insert into jobs (
        tenant_id,
        customer_id,
        external_crm,
        external_job_id,
        job_type,
        stage,
        contract_status
      )
      values (
        $1,$2,
        'estimator_app',
        $3,
        'ROOF_REPLACEMENT',
        'contract_requested',
        'requested'
      )
      returning id`,
      [
        tenantId,
        customerId,
        `contract-${Date.now()}`
      ]
    );

    const jobId = Number(insertedJob.rows[0].id);

    await pool.query(
      `insert into timeline_events (
        tenant_id, job_id, kind, message, meta
      )
      values ($1,$2,'contract_click','Contract requested',$3)`,
      [tenantId, jobId, JSON.stringify(body)]
    );

    return reply.send({
      ok: true,
      job_id: jobId
    });
  });

}

export default registerLeadRoutes;
