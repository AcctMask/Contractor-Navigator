import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { G2G_TERMS_AND_CONDITIONS } from "../lib/g2gTerms"
import { getToken } from "../lib/auth"
import { getTenantSlug } from "../lib/tenant"

const API_BASE = import.meta.env.VITE_API_BASE 
type JobSummary = {
  id: number
  stage?: string | null
  crm_substatus?: string | null
  address1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  customer_name?: string | null
  customer_email?: string | null
  customer_phone?: string | null
  carrier?: string | null
  job_claim_number?: string | null
  date_of_loss?: string | null
}

type EstimateLineItem = {
  description: string
  amount: number | null
}

type AdjustmentLineItem = {
  description: string
  quantity: number | null
  unit_price: number | null
}

type EstimateDetails = {
  roof_type?: string | null
  roof_squares?: number | null
  low_amount?: number | null
  high_amount?: number | null
  agreed_amount?: number | null
  carrier_approved_amount?: number | null
  claim_number?: string | null
  deductible?: string | null
  tpa?: string | null
  emergency_tarp_needed?: boolean
  emergency_tarp_sqft?: number | null
  callback_notes?: string | null
  estimator_remarks?: string | null
  estimate_line_items?: EstimateLineItem[]
  terms_and_conditions?: string | null
  proposal_type?: string | null
  proposal_amount?: number | null
  contract_amount?: number | null
  discount_amount?: number | null
  discount_reason?: string | null
}

type DocumentPackage = {
  id: number
  package_type: string
  document_title: string
  template_source?: string | null
  status: string
  payload: Record<string, unknown>
  created_at?: string
}

type JobAsset = {
  id: number
  asset_type?: string | null
  asset_category?: string | null
  original_name: string
  mime_type?: string | null
  file_size_bytes?: number | null
  note?: string | null
  created_at?: string | null
}

function addressLine(job?: JobSummary | null) {
  if (!job) return "—"
  return [job.address1, job.city, job.state, job.zip].filter(Boolean).join(", ") || "—"
}

function defaultEstimateLineItems(): EstimateLineItem[] {
  return [
    {
      description:
        "Complete Roof Replacement - Complete roof replacement using high-end architectural shingles and underlayment from the manufacturer of the customer's choice. Re-nail all plywood.",
      amount: null,
    },
    {
      description:
        "Added Value - Replace all vents / painted to match the new shingle. Starter strip on the entire perimeter to better protect the home from wind damage. Metal Valley to better protect the home from water damage. Up to 4 sheets of plywood.",
      amount: null,
    },
  ]
}

const DEFAULT_TERMS = G2G_TERMS_AND_CONDITIONS

export default function DocumentPipelinePage() {
  const requestedDocumentType =
    new URLSearchParams(window.location.search).get("type") || ""
  const [searchParams] = useSearchParams()
  const [jobId, setJobId] = useState(() => searchParams.get("jobId") || "")
  const [job, setJob] = useState<JobSummary | null>(null)
  const [documents, setDocuments] = useState<DocumentPackage[]>([])
  const [assets, setAssets] = useState<JobAsset[]>([])
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([])
  const [attachmentProgress, setAttachmentProgress] = useState<
    Array<{
      assetId: number
      name: string
      state: "pending" | "preparing" | "sent" | "failed"
    }>
  >([])
  const [isSendingPackage, setIsSendingPackage] = useState(false)
  const [adjustmentDescription, setAdjustmentDescription] = useState("")
  const [adjustmentLineItems, setAdjustmentLineItems] = useState<AdjustmentLineItem[]>([
    { description: "", quantity: 1, unit_price: null },
  ])
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message })
    window.setTimeout(() => setToast(null), 2600)
  }

  function successToast(message: string) {
    setStatus(message)
    showToast("success", message)
  }

  function errorToast(message: string) {
    setStatus("")
    setError(message)
    showToast("error", message)
  }

  const [form, setForm] = useState<EstimateDetails>({
    roof_type: "",
    roof_squares: null,
    low_amount: null,
    high_amount: null,
    agreed_amount: null,
    carrier_approved_amount: null,
    claim_number: "",
    deductible: "",
    tpa: "",
    emergency_tarp_needed: false,
    emergency_tarp_sqft: null,
    callback_notes: "",
    estimator_remarks: "",
    estimate_line_items: defaultEstimateLineItems(),
    terms_and_conditions: DEFAULT_TERMS,
    proposal_type: "retail",
    proposal_amount: null,
    contract_amount: null,
    discount_amount: null,
    discount_reason: "",
  })

  function cleanNumber(value: any): number | null {
    if (value === "" || value === null || value === undefined) return null
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function cleanEstimatePayload(input: EstimateDetails): EstimateDetails {
    const proposalAmount = cleanNumber(input.proposal_amount)
    let contractAmount = cleanNumber(input.contract_amount)
    let discountAmount = cleanNumber(input.discount_amount)

    if (proposalAmount != null && contractAmount == null) {
      contractAmount = proposalAmount
    }

    if (proposalAmount != null && contractAmount != null && discountAmount == null) {
      discountAmount = proposalAmount - contractAmount
    }

    return {
      ...input,
      roof_squares: cleanNumber(input.roof_squares),
      low_amount: cleanNumber(input.low_amount),
      high_amount: cleanNumber(input.high_amount),
      agreed_amount: cleanNumber(input.agreed_amount),
      carrier_approved_amount: cleanNumber(input.carrier_approved_amount),
      emergency_tarp_sqft: cleanNumber(input.emergency_tarp_sqft),
      proposal_amount: proposalAmount,
      contract_amount: contractAmount,
      discount_amount: discountAmount,
      estimate_line_items: Array.isArray(input.estimate_line_items)
        ? input.estimate_line_items.map((item) => ({
            description: item.description || "",
            amount: cleanNumber(item.amount),
          }))
        : [],
    }
  }

  function setField<K extends keyof EstimateDetails>(key: K, value: EstimateDetails[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function addAdjustmentLineItem() {
    setAdjustmentLineItems((current) => [
      ...current,
      { description: "", quantity: 1, unit_price: null },
    ])
  }

  function updateAdjustmentLineItem(
    index: number,
    field: keyof AdjustmentLineItem,
    value: string
  ) {
    setAdjustmentLineItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item

        if (field === "description") {
          return { ...item, description: value }
        }

        return {
          ...item,
          [field]: value === "" ? null : Number(value),
        }
      })
    )
  }

  function removeAdjustmentLineItem(index: number) {
    setAdjustmentLineItems((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index)
      return next.length
        ? next
        : [{ description: "", quantity: 1, unit_price: null }]
    })
  }

  const proposedAdjustmentAmount = adjustmentLineItems.reduce((sum, item) => {
    const quantity = Number(item.quantity)
    const unitPrice = Number(item.unit_price)

    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
      return sum
    }

    return sum + quantity * unitPrice
  }, 0)

  useEffect(() => {
    const urlJobId = searchParams.get("jobId")
    if (urlJobId) {
      setJobId(urlJobId)
    }
  }, [searchParams])

  useEffect(() => {
    if (jobId) {
      void loadJob()
    }
  }, [jobId])

  async function loadJob() {
    setError("")
    setStatus("Loading pipeline...")

    try {
      const res = await fetch(`${API_BASE}/pipeline/${getTenantSlug()}/job/${jobId}`)
      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error || "Load failed")
      }

      setJob(json.job || null)
      setDocuments(Array.isArray(json.documents) ? json.documents : [])

      const d = json.estimate_details || {}
      setForm({
        roof_type: d.roof_type || "",
        roof_squares: d.roof_squares ?? null,
        low_amount: d.low_amount ?? null,
        high_amount: d.high_amount ?? null,
        agreed_amount: d.agreed_amount ?? null,
        carrier_approved_amount: d.carrier_approved_amount ?? null,
        claim_number: d.claim_number || "",
        deductible: d.deductible || "",
        tpa: d.tpa || "",
        emergency_tarp_needed: !!d.emergency_tarp_needed,
        emergency_tarp_sqft: d.emergency_tarp_sqft ?? null,
        callback_notes: d.callback_notes || "",
        estimator_remarks: d.estimator_remarks || "",
        estimate_line_items: Array.isArray(d.estimate_line_items) && d.estimate_line_items.length
          ? d.estimate_line_items
          : defaultEstimateLineItems(),
        terms_and_conditions: d.terms_and_conditions || DEFAULT_TERMS,
        proposal_type: d.proposal_type || "retail",
        proposal_amount: d.proposal_amount ?? null,
        contract_amount: d.contract_amount ?? d.proposal_amount ?? null,
        discount_amount: d.discount_amount ?? null,
        discount_reason: d.discount_reason || "",
      })

      setStatus("Pipeline loaded")
    } catch (err: any) {
      setError(err?.message || "Load failed")
      setStatus("Load failed")
    }
  }

  async function loadAttachmentAssets() {
    if (!jobId) {
      setAssets([])
      setSelectedAssetIds([])
      return
    }

    try {
      const token = getToken()

      const res = await fetch(
        `${API_BASE}/assets/${getTenantSlug()}/job/${jobId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )

      const json = await res.json()

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to load job files")
      }

      const loadedAssets = Array.isArray(json.assets)
        ? json.assets
        : []

      setAssets(loadedAssets)

      setSelectedAssetIds((current) =>
        current.filter((id) =>
          loadedAssets.some(
            (asset: JobAsset) =>
              Number(asset.id) === id
          )
        )
      )
    } catch (err: any) {
      setAssets([])
      setSelectedAssetIds([])
      errorToast(
        err?.message ||
          "Failed to load job files"
      )
    }
  }

  useEffect(() => {
    void loadAttachmentAssets()
  }, [jobId])

  async function saveEstimateDetails() {
    setError("")
    setStatus("Saving contract details...")

    try {
      const res = await fetch(`${API_BASE}/pipeline/${getTenantSlug()}/job/${jobId}/estimate-details`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cleanEstimatePayload(form)),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error || "Save failed")
      }

      successToast("Contract details saved")
      await loadJob()
    } catch (err: any) {
      errorToast(err?.message || "Save failed")
      setStatus("Save failed")
    }
  }

  function updateLineItem(index: number, key: keyof EstimateLineItem, value: string) {
    setForm((prev) => {
      const items = Array.isArray(prev.estimate_line_items)
        ? [...prev.estimate_line_items]
        : defaultEstimateLineItems()

      items[index] = {
        ...items[index],
[key]: key === "amount" ? cleanNumber(value) : value,
      }

      return { ...prev, estimate_line_items: items }
    })
  }

  function addLineItem() {
    setForm((prev) => ({
      ...prev,
      estimate_line_items: [
        ...(Array.isArray(prev.estimate_line_items) ? prev.estimate_line_items : []),
        { description: "", amount: null },
      ],
    }))
  }

  function removeLineItem(index: number) {
    setForm((prev) => ({
      ...prev,
      estimate_line_items: (prev.estimate_line_items || []).filter((_, i) => i !== index),
    }))
  }

  async function sendPackage(packageId: number) {
    if (isSendingPackage) return

    setError("")
    setIsSendingPackage(true)

    const selectedAssets = selectedAssetIds
      .map((assetId) =>
        assets.find((asset) => Number(asset.id) === assetId)
      )
      .filter((asset): asset is JobAsset => Boolean(asset))

    setAttachmentProgress(
      selectedAssets.map((asset) => ({
        assetId: Number(asset.id),
        name: asset.original_name,
        state: "pending",
      }))
    )

    try {
      for (const asset of selectedAssets) {
        setAttachmentProgress((current) =>
          current.map((item) =>
            item.assetId === Number(asset.id)
              ? { ...item, state: "preparing" }
              : item
          )
        )

        setStatus(`Preparing attachment: ${asset.original_name}`)
        await Promise.resolve()
      }

      setStatus("Sending package for signature...")

      const res = await fetch(
        `${API_BASE}/pipeline/${getTenantSlug()}/job/${jobId}/send-package`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            package_id: packageId,
            asset_ids: selectedAssetIds,
          }),
        }
      )

      const json = await res.json()

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Send package failed")
      }

      setAttachmentProgress((current) =>
        current.map((item) => ({
          ...item,
          state: "sent",
        }))
      )

      successToast(
        selectedAssets.length
          ? `Package sent with ${selectedAssets.length} document${
              selectedAssets.length === 1 ? "" : "s"
            }`
          : "Package sent for signature"
      )

      await loadJob()
    } catch (err: any) {
      setAttachmentProgress((current) =>
        current.map((item) => ({
          ...item,
          state: "failed",
        }))
      )

      errorToast(err?.message || "Send package failed")
      setStatus("Send package failed")
    } finally {
      setIsSendingPackage(false)
    }
  }

  async function openCompletedDocument(doc: DocumentPackage) {
    const assetId = Number(doc?.payload?.completed_asset_id)

    if (!assetId) {
      errorToast("Completed document file is unavailable")
      return
    }

    const viewingWindow = window.open("", "_blank")

    if (!viewingWindow) {
      errorToast("Allow pop-ups for Navigator to view files")
      return
    }

    viewingWindow.document.title = "Opening document..."
    viewingWindow.document.body.innerHTML =
      '<p style="font-family: sans-serif; padding: 24px;">Opening document...</p>'

    try {
      const token = getToken()
      const assetUrl =
        `${API_BASE}/assets/${getTenantSlug()}/file/${assetId}`

      const res = await fetch(assetUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        let message = "Open document failed"

        try {
          const data = await res.json()
          message = data?.error || message
        } catch {
          // Preserve generic error for non-JSON responses.
        }

        viewingWindow.close()
        errorToast(message)
        return
      }

      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)

      viewingWindow.location.replace(objectUrl)

      window.setTimeout(
        () => URL.revokeObjectURL(objectUrl),
        60000
      )
    } catch (err: any) {
      viewingWindow.close()
      errorToast(err?.message || "Open document failed")
    }
  }

  const hasSignedOriginalContract = documents.some(
    (doc) =>
      (doc.package_type === "retail_estimate" ||
        doc.package_type === "insurance_contract") &&
      doc.status === "signed"
  )

  const requestedAdjustmentIsIneligible =
    (requestedDocumentType === "change_order" ||
      requestedDocumentType === "supplement") &&
    !hasSignedOriginalContract

  async function createPackage(
    packageType:
      | "retail_estimate"
      | "insurance_contract"
      | "ems_tarp"
      | "change_order"
      | "supplement"
  ) {
    if (
      (packageType === "change_order" ||
        packageType === "supplement") &&
      !hasSignedOriginalContract
    ) {
      errorToast("Ineligible without a signed contract")
      setStatus("Ineligible without a signed contract")
      return
    }

    setError("")
    setStatus(`Creating ${packageType} package...`)

    try {
      if (packageType === "retail_estimate") {
        setStatus("Saving current contract details...")

        const saveRes = await fetch(
          `${API_BASE}/pipeline/${getTenantSlug()}/job/${jobId}/estimate-details`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(cleanEstimatePayload(form)),
          }
        )

        const saveJson = await saveRes.json()

        if (!saveRes.ok) {
          throw new Error(
            saveJson?.error || "Save contract details failed"
          )
        }

        setStatus("Creating contract...")
      }

      const res = await fetch(`${API_BASE}/pipeline/${getTenantSlug()}/job/${jobId}/create-package`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          package_type: packageType,
          ...(packageType === "change_order" || packageType === "supplement"
            ? {
                adjustment_description: adjustmentDescription,
                adjustment_line_items: adjustmentLineItems,
              }
            : {}),
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error || "Create package failed")
      }

      const packageLabel =
        packageType === "change_order"
          ? "Change Order"
          : packageType === "supplement"
            ? "Supplement"
            : packageType

      successToast(`${packageLabel} package created`)

      if (packageType === "change_order" || packageType === "supplement") {
        setAdjustmentDescription("")
        setAdjustmentLineItems([
          { description: "", quantity: 1, unit_price: null },
        ])
      }

      await loadJob()
    } catch (err: any) {
      errorToast(err?.message || "Create package failed")
      setStatus("Create package failed")
    }
  }

  return (
    <div
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        display: "grid",
        gap: "24px",
      }}
    >
      {toast ? (
        <div style={{
          position: "fixed",
          top: 18,
          right: 18,
          zIndex: 9999,
          padding: "12px 16px",
          borderRadius: 12,
          fontWeight: 900,
          color: "#ffffff",
          background: toast.type === "success" ? "#16a34a" : "#dc2626",
          boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
        }}>
          {toast.type === "success" ? "✓ " : "✕ "}{toast.message}
        </div>
      ) : null}

      <section style={cardStyle}>
        <h1 style={{ marginTop: 0, fontSize: "42px", lineHeight: 1.1 }}>Document Pipeline</h1>
        {requestedAdjustmentIsIneligible ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              border: "1px solid #f59e0b",
              borderRadius: 8,
              fontWeight: 700,
            }}
          >
            Ineligible without a signed contract.
          </div>
        ) : null}
        <p style={{ marginTop: "12px", fontSize: "18px", opacity: 0.88 }}>
          Save estimator details, then create the estimate, insurance contract, and EMS tarp document packages.
        </p>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Load Job</h2>

        <div style={{ display: "grid", gap: "14px" }}>
          <div>
            <label style={labelStyle}>Job ID</label>
            <input
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              placeholder="27"
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={loadJob} style={buttonStyle}>
              Load Pipeline
            </button>
            <span style={{ opacity: 0.85 }}>{status}</span>
          </div>

          {error ? <div style={errorStyle}>{error}</div> : null}
        </div>
      </section>

      <section style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>Job Summary</h2>
          {jobId ? (
            <a href={`/job/${jobId}`} style={linkButtonStyle}>
              Back to Job Details
            </a>
          ) : null}
        </div>

        {job ? (
          <div style={{ lineHeight: 1.7, fontSize: "18px" }}>
            <div><strong>Customer:</strong> {job.customer_name || "—"}</div>
            <div><strong>Email:</strong> {job.customer_email || "—"}</div>
            <div><strong>Phone:</strong> {job.customer_phone || "—"}</div>
            <div><strong>Address:</strong> {addressLine(job)}</div>
            <div><strong>Carrier:</strong> {job.carrier || "—"}</div>
            <div><strong>Claim #:</strong> {job.job_claim_number || "—"}</div>
            <div><strong>Date of Loss:</strong> {job.date_of_loss ? String(job.date_of_loss).slice(0, 10) : "—"}</div>
            <div><strong>Stage:</strong> {job.stage || "—"}</div>
            <div><strong>CRM Substatus:</strong> {job.crm_substatus || "—"}</div>
          </div>
        ) : (
          <p>No job loaded yet.</p>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Contract Details</h2>

        <div style={{ display: "grid", gap: "14px" }}>
          <div>
            <label style={labelStyle}>Roof Type</label>
            <input
              value={form.roof_type || ""}
              onChange={(e) => setField("roof_type", e.target.value)}
              placeholder="Architectural shingle"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Roof Squares</label>
            <input
              value={form.roof_squares ?? ""}
              onChange={(e) =>
                setField("roof_squares", e.target.value === "" ? null : Number(e.target.value))
              }
              placeholder="32"
              style={inputStyle}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            <div>
              <label style={labelStyle}>Contract Type</label>
              <select
                value={form.proposal_type || "retail"}
                onChange={(e) => setField("proposal_type", e.target.value)}
                style={inputStyle}
              >
                <option value="retail">Retail Contract</option>
                <option value="insurance">Insurance Contract</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Contract Amount</label>
              <input
                value={form.contract_amount ?? ""}
                onChange={(e) =>
                  setField(
                    "contract_amount",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
                placeholder="17500"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px" }}>
            <div>
              <label style={labelStyle}>Carrier Approved Amount</label>
              <input
                value={form.carrier_approved_amount ?? ""}
                onChange={(e) =>
                  setField(
                    "carrier_approved_amount",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
                placeholder="14500"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Claim Number</label>
              <input
                value={form.claim_number || ""}
                onChange={(e) => setField("claim_number", e.target.value)}
                placeholder="CLAIM-12345"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Deductible</label>
              <input
                value={form.deductible || ""}
                onChange={(e) => setField("deductible", e.target.value)}
                placeholder="$1,000"
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>TPA / Third-Party Administrator</label>
            <input
              value={form.tpa || ""}
              onChange={(e) => setField("tpa", e.target.value)}
              placeholder="Hancock Claims, Altimeter Solutions Group, etc."
              style={inputStyle}
            />
          </div>

          <label style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={!!form.emergency_tarp_needed}
              onChange={(e) => setField("emergency_tarp_needed", e.target.checked)}
            />
            Emergency tarp needed
          </label>

          <div>
            <label style={labelStyle}>Emergency Tarp Square Feet</label>
            <input
              value={form.emergency_tarp_sqft ?? ""}
              onChange={(e) =>
                setField(
                  "emergency_tarp_sqft",
                  e.target.value === "" ? null : Number(e.target.value)
                )
              }
              placeholder="1200"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Callback / Negotiation Notes</label>
            <textarea
              value={form.callback_notes || ""}
              onChange={(e) => setField("callback_notes", e.target.value)}
              placeholder="Customer asked for afternoon callback. Negotiated toward lower end of range."
              style={textareaStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Contract Notes</label>
            <textarea
              value={form.estimator_remarks || ""}
              onChange={(e) => setField("estimator_remarks", e.target.value)}
              placeholder="32 squares, architectural shingles, replace vents, renail deck."
              style={textareaStyle}
            />
          </div>

          <div style={{ display: "grid", gap: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Contract Line Items</label>
              <button type="button" onClick={addLineItem} style={buttonStyle}>
                Add Line Item
              </button>
            </div>

            {(form.estimate_line_items || []).map((item, index) => (
              <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 180px 92px", gap: "10px", alignItems: "center" }}>
                <input
                  value={item.description || ""}
                  onChange={(e) => updateLineItem(index, "description", e.target.value)}
                  placeholder="Description"
                  style={inputStyle}
                />
                <input
                  value={item.amount ?? ""}
                  onChange={(e) => updateLineItem(index, "amount", e.target.value)}
                  placeholder="Amount"
                  style={inputStyle}
                />
                <button type="button" onClick={() => removeLineItem(index)} style={secondaryButtonStyle}>
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div>
            <label style={labelStyle}>Terms and Conditions</label>
            <textarea
              value={form.terms_and_conditions || ""}
              onChange={(e) => setField("terms_and_conditions", e.target.value)}
              placeholder={DEFAULT_TERMS}
              style={{ ...textareaStyle, minHeight: "150px" }}
            />
          </div>

          <div>
            <button onClick={saveEstimateDetails} style={buttonStyle}>
              Save Contract Details
            </button>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Create Document Packages</h2>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <button onClick={() => createPackage("retail_estimate")} style={buttonStyle}>
            Create Contract
          </button>
          <button onClick={() => createPackage("insurance_contract")} style={buttonStyle}>
            Create Insurance Contract
          </button>
          <button onClick={() => createPackage("ems_tarp")} style={buttonStyle}>
            Create EMS Tarp Authorization
          </button>
        </div>

        <div
          style={{
            marginTop: "24px",
            paddingTop: "24px",
            borderTop: "1px solid rgba(255,255,255,0.12)",
            display: "grid",
            gap: "14px",
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>Contract Adjustments</h3>
            <p style={{ marginBottom: 0, opacity: 0.8 }}>
              Create a proposed Change Order or Supplement. The adjustment
              becomes part of the contractual job value only after customer
              signature.
            </p>
          </div>

          <div>
            <label style={labelStyle}>Description / Reason</label>
            <textarea
              value={adjustmentDescription}
              onChange={(e) => setAdjustmentDescription(e.target.value)}
              placeholder="Describe the additional, removed, or revised scope."
              style={textareaStyle}
            />
          </div>

          <div style={{ display: "grid", gap: "12px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <label style={{ ...labelStyle, marginBottom: 0 }}>
                Adjustment Line Items
              </label>
              <button
                type="button"
                onClick={addAdjustmentLineItem}
                style={buttonStyle}
              >
                Add Line Item
              </button>
            </div>

            {adjustmentLineItems.map((item, index) => (
              <div
                key={index}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 120px 160px 92px",
                  gap: "10px",
                  alignItems: "center",
                }}
              >
                <input
                  value={item.description}
                  onChange={(e) =>
                    updateAdjustmentLineItem(
                      index,
                      "description",
                      e.target.value
                    )
                  }
                  placeholder="Description"
                  style={inputStyle}
                />

                <input
                  type="number"
                  value={item.quantity ?? ""}
                  onChange={(e) =>
                    updateAdjustmentLineItem(index, "quantity", e.target.value)
                  }
                  placeholder="Qty"
                  style={inputStyle}
                />

                <input
                  type="number"
                  step="0.01"
                  value={item.unit_price ?? ""}
                  onChange={(e) =>
                    updateAdjustmentLineItem(index, "unit_price", e.target.value)
                  }
                  placeholder="Unit Price"
                  style={inputStyle}
                />

                <button
                  type="button"
                  onClick={() => removeAdjustmentLineItem(index)}
                  style={secondaryButtonStyle}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div style={{ fontSize: "18px", fontWeight: 800 }}>
            Proposed Adjustment:{" "}
            {proposedAdjustmentAmount.toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
            })}
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => createPackage("change_order")}
              style={buttonStyle}
            >
              Create Change Order
            </button>

            <button
              type="button"
              onClick={() => createPackage("supplement")}
              style={buttonStyle}
            >
              Create Supplement
            </button>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Attachments</h2>

        <p style={{ marginTop: 0, opacity: 0.8 }}>
          Select existing job files to include with the customer email.
          Nothing selected preserves the current send behavior.
        </p>

        {assets.filter(
          (asset) =>
            String(asset.asset_category || "").trim() === "Documents"
        ).length ? (
          <div style={{ display: "grid", gap: "10px" }}>
            {assets
              .filter(
                (asset) =>
                  String(asset.asset_category || "").trim() === "Documents"
              )
              .map((asset) => {
              const assetId = Number(asset.id)
              const checked =
                selectedAssetIds.includes(assetId)

              return (
                <label
                  key={assetId}
                  style={{
                    display: "flex",
                    gap: "10px",
                    alignItems: "flex-start",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setSelectedAssetIds(
                        (current) =>
                          event.target.checked
                            ? Array.from(
                                new Set([
                                  ...current,
                                  assetId,
                                ])
                              )
                            : current.filter(
                                (id) =>
                                  id !== assetId
                              )
                      )
                    }}
                  />

                  <span>
                    <strong>
                      {asset.original_name}
                    </strong>

                    <span
                      style={{
                        display: "block",
                        opacity: 0.7,
                        fontSize: "0.9rem",
                      }}
                    >
                      {asset.asset_category ||
                        asset.asset_type ||
                        "Job file"}
                      {asset.note
                        ? ` — ${asset.note}`
                        : ""}
                    </span>
                  </span>
                </label>
              )
            })}

            <div
              style={{
                marginTop: "6px",
                opacity: 0.75,
              }}
            >
              {selectedAssetIds.length
                ? `${selectedAssetIds.length} attachment${
                    selectedAssetIds.length === 1
                      ? ""
                      : "s"
                  } selected`
                : "No attachments selected"}
            </div>
          </div>
        ) : (
          <p style={{ opacity: 0.75 }}>
            No job documents are available to attach.
          </p>
        )}
      </section>

      {attachmentProgress.length ? (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Send Progress</h2>

          <div style={{ display: "grid", gap: "8px" }}>
            {attachmentProgress.map((item) => (
              <div
                key={item.assetId}
                style={{
                  fontWeight: 700,
                  color:
                    item.state === "sent"
                      ? "#86efac"
                      : item.state === "failed"
                        ? "#fca5a5"
                        : "inherit",
                }}
              >
                {item.state === "pending" ? "○ " : null}
                {item.state === "preparing" ? "⏳ " : null}
                {item.state === "sent" ? "✓ " : null}
                {item.state === "failed" ? "✕ " : null}

                {item.state === "pending"
                  ? `Waiting: ${item.name}`
                  : null}

                {item.state === "preparing"
                  ? `Preparing ${item.name}...`
                  : null}

                {item.state === "sent"
                  ? `Sent: ${item.name}`
                  : null}

                {item.state === "failed"
                  ? `Failed: ${item.name}`
                  : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Generated Packages</h2>

        {documents.length ? (
          <div style={{ display: "grid", gap: "12px" }}>
            {documents.map((doc) => (
              <div key={doc.id} style={rowStyle}>
                <div style={{ fontWeight: 700 }}>{doc.document_title}</div>
                <div style={{ opacity: 0.9 }}>Type: {doc.package_type}</div>
                <div style={{ opacity: 0.9 }}>Status: {doc.status}</div>
                <div style={{ opacity: 0.9 }}>
                  Contract Amount: {doc.payload?.contract_amount ? `$${Number(doc.payload.contract_amount).toLocaleString()}` : "—"}
                </div>
                <div style={{ opacity: 0.75 }}>Template: {doc.template_source || "—"}</div>
                <div style={{ opacity: 0.65 }}>
                  Created: {doc.created_at ? new Date(doc.created_at).toLocaleString() : "—"}
                </div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "10px" }}>
                  {doc.status === "signed" || doc.status === "approved" ? (
                    <button
                      type="button"
                      onClick={() => openCompletedDocument(doc)}
                      style={linkButtonStyle}
                    >
                      View Document
                    </button>
                  ) : (
                    <>
                      <a
                        href={`/sign/${doc.id}`}
                        target="_blank"
                        rel="noreferrer"
                        style={linkButtonStyle}
                      >
                        {doc.package_type === "supplement"
                          ? "Review / Approve"
                          : "View / Sign"}
                      </a>

                      <button
                        type="button"
                        onClick={() => sendPackage(doc.id)}
                        disabled={isSendingPackage}
                        style={{
                          ...buttonStyle,
                          opacity: isSendingPackage ? 0.72 : 1,
                          cursor: isSendingPackage ? "wait" : "pointer",
                        }}
                      >
                        {isSendingPackage
                          ? "⏳ Sending..."
                          : doc.package_type === "supplement"
                            ? "Send For Approval"
                            : "Send For Signature"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p>No document packages yet.</p>
        )}
      </section>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(81, 133, 255, 0.25)",
  borderRadius: "24px",
  padding: "24px",
}

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "8px",
  fontWeight: 700,
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  color: "#e8eefc",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: "14px",
  padding: "14px 16px",
  fontSize: "16px",
  outline: "none",
}

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "110px",
  boxSizing: "border-box",
  resize: "vertical",
  background: "rgba(255,255,255,0.06)",
  color: "#e8eefc",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: "14px",
  padding: "14px 16px",
  fontSize: "16px",
  outline: "none",
}

const linkButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  textDecoration: "none",
  color: "#fff",
  background: "rgba(81, 133, 255, 0.35)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: "14px",
  padding: "12px 16px",
  fontWeight: 800,
}

const secondaryButtonStyle: React.CSSProperties = {
  color: "#fff",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: "14px",
  padding: "12px 14px",
  fontWeight: 800,
  cursor: "pointer",
}

const buttonStyle: React.CSSProperties = {
  color: "#fff",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  border: "none",
  padding: "12px 18px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: 700,
}

const rowStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "16px",
  padding: "14px 16px",
}

const errorStyle: React.CSSProperties = {
  background: "rgba(150, 30, 30, 0.22)",
  border: "1px solid rgba(255, 120, 120, 0.35)",
  color: "#ffd1d1",
  borderRadius: "14px",
  padding: "12px 14px",
}
