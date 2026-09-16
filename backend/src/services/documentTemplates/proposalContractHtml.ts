import { G2G_TERMS_AND_CONDITIONS } from "./g2gTerms"

function moneyValue(value: any) {
  if (value === null || value === undefined || value === "") return "—"
  const n = Number(value)
  if (Number.isNaN(n)) return String(value)
  return `$${n.toLocaleString()}`
}

function escapeHtml(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function buildDocumentSnapshotHtml(doc: any, payload: any, statusLabel: string) {
  const displayMode = String(payload.document_display_mode || "")
  const isEmsWorkAuthorization =
    displayMode === "ems_work_authorization"

  const termsAndConditions =
    isEmsWorkAuthorization
      ? String(payload.terms_and_conditions || "")
      : G2G_TERMS_AND_CONDITIONS

  const rows: any[][] = [
    ["Document", doc.document_title],
    ["Document Number", payload.document_number],
    ["Package Type", doc.package_type],
    ["Customer", payload.customer_name],
    ["Phone", payload.customer_phone],
    ["Email", payload.customer_email],
    ["Address", payload.job_address],
  ]

  if (displayMode === "retail_contract") {
    rows.push(
      ["Contract Amount", moneyValue(
        payload.contract_amount ??
        payload.proposal_contract_amount ??
        payload.proposal_amount ??
        payload.agreed_amount
      )],
      ["Roof Type", payload.roof_type],
      ["Roof Squares", payload.roof_squares]
    )
  }

  if (
    displayMode === "retail_contract" &&
    Array.isArray(payload.estimate_line_items)
  ) {
    payload.estimate_line_items.forEach(
      (item: any, index: number) => {
        rows.push([
          `Contract Line Item ${index + 1}`,
          [
            String(item?.description || "").trim(),
            item?.amount !== null &&
            item?.amount !== undefined
              ? moneyValue(item.amount)
              : "",
          ]
            .filter(Boolean)
            .join(" — "),
        ])
      }
    )
  }

  if (displayMode === "insurance_contract") {
    rows.push(
      ["Carrier", payload.carrier],
      ["Claim Number", payload.claim_number],
      ["Date of Loss", payload.date_of_loss],
      ["Carrier Approved Amount", moneyValue(payload.carrier_approved_amount)],
      ["Deductible", payload.deductible]
    )
  }

  if (
    displayMode === "change_order" ||
    displayMode === "supplement"
  ) {
    rows.push(
      ["Description", payload.adjustment_description]
    )

    if (Array.isArray(payload.adjustment_line_items)) {
      payload.adjustment_line_items.forEach(
        (item: any, index: number) => {
          const quantity = Number(item?.quantity)
          const unitPrice = Number(item?.unit_price)
          const amount = Number(item?.amount)

          rows.push([
            `${payload.adjustment_title || "Adjustment"} Line Item ${index + 1}`,
            [
              String(item?.description || "").trim(),
              Number.isFinite(quantity) ? `Qty ${quantity}` : "",
              Number.isFinite(unitPrice)
                ? `@ ${moneyValue(unitPrice)}`
                : "",
              Number.isFinite(amount)
                ? `= ${moneyValue(amount)}`
                : "",
            ]
              .filter(Boolean)
              .join(" — "),
          ])
        }
      )
    }

    rows.push([
      displayMode === "change_order"
        ? "Change Order Total"
        : "Supplement Total",
      moneyValue(payload.adjustment_amount),
    ])
  }

  if (displayMode === "ems_work_authorization") {
    rows.push(
      ["TPA", payload.tpa],
      ["Carrier", payload.carrier],
      ["Claim Number", payload.claim_number],
      ["Date of Loss", payload.date_of_loss]
    )
  }

  if (
    displayMode === "retail_contract" ||
    displayMode === "insurance_contract"
  ) {
    rows.push(
      ["Contract Notes", payload.estimator_remarks]
    )
  }

  rows.push(
    ["Terms Accepted", payload.terms_accepted === true ? "Yes" : "No / Not signed yet"],
    ["Signed By", payload.signed_by],
    ["Signed At", payload.signed_at]
  )

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(doc.document_title)} - ${escapeHtml(statusLabel)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; padding: 32px; line-height: 1.45; }
    h1 { margin-bottom: 4px; }
    .muted { color: #555; margin-bottom: 24px; }
    table { border-collapse: collapse; width: 100%; margin-top: 18px; margin-bottom: 28px; }
    td { border: 1px solid #ddd; padding: 10px; vertical-align: top; }
    td:first-child { font-weight: bold; width: 260px; background: #f7f7f7; }
    tr.document-section-start td { border-top: 4px solid #111; padding-top: 16px; }
    tr.signature-section-start td { border-top: 4px solid #111; padding-top: 16px; }
    section { margin-top: 28px; }
    .terms { white-space: pre-wrap; border: 1px solid #ddd; padding: 18px; background: #fafafa; }
    .signature-name {
      font-family: "Brush Script MT", "Segoe Script", cursive;
      font-size: 24px;
      line-height: 1.2;
    }

    .signature { margin-top: 32px; padding-top: 16px; border-top: 2px solid #111; }
  </style>
</head>
<body>
  <h1>Good2Go Roofing &amp; Construction LLC ${escapeHtml(statusLabel)}</h1>
  <div class="muted">
    855-766-3246 &nbsp;|&nbsp;
    info@g2groofing.com &nbsp;|&nbsp;
    www.g2groofing.com<br />
    Florida Licenses: CCC1331529 &amp; CBC1259416
  </div>
  <table>
    ${rows.map(([label, value]) => {
      const rowClass =
        label === "Description"
          ? "document-section-start"
          : label === "Terms Accepted"
            ? "signature-section-start"
            : ""
      return `<tr class="${rowClass}"><td>${escapeHtml(label)}</td><td>${escapeHtml(value || "—")}</td></tr>`
    }).join("\n")}
  </table>

  ${isEmsWorkAuthorization ? `
  <section>
    <h2>Project Details</h2>
    <p><strong>Property:</strong> ${escapeHtml(payload.job_address || "Address to be confirmed")}</p>
    <p>Good2Go Roofing and Construction LLC was assigned by ${escapeHtml(payload.carrier || payload.tpa || "your insurance carrier")} to provide emergency services at this property.</p>
    <p>By signing below, I authorize Good2Go Roofing and Construction LLC and their affiliates to provide a roof inspection and, upon their assessment of damages, install a tarp in affected areas as deemed necessary.</p>
    <p>I understand that all photos, invoices, and estimates for repairs and/or replacement will be processed through the appropriate insurance assignment process for authorization and payment.</p>
  </section>
  ` : ""}

  <div class="signature">
    <strong>Electronic Signature:</strong> <span class="signature-name">${escapeHtml(payload.signed_by || "Not signed yet")}</span><br />
    <strong>Signed At:</strong> ${escapeHtml(payload.signed_at || "—")}<br />
    <strong>Terms Accepted:</strong> ${payload.terms_accepted === true ? "Yes" : "No / Not signed yet"}<br />
    <strong>Electronic Signature Statement:</strong> Typed signature accepted as electronic signature.
  </div>

  ${
    displayMode === "supplement" &&
    payload?.approval?.method === "admin"
      ? `
  <div class="administrative-approval">
    <strong>Administratively Approved:</strong> Yes<br />
    <strong>Approved By:</strong> ${escapeHtml(
      payload.approval.actor?.full_name ||
      payload.approval.actor?.email ||
      "Authorized Navigator user"
    )}<br />
    <strong>Approved At:</strong> ${escapeHtml(payload.approval.approved_at || "—")}<br />
    <strong>Approval Reason:</strong> ${escapeHtml(payload.approval.explanation || "—")}
  </div>
  `
      : ""
  }

  <section>
    <h2>Terms and Conditions</h2>
    <div class="terms">${escapeHtml(termsAndConditions)}</div>
  </section>
</body>
</html>`
}
