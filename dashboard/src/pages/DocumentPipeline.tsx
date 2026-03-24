import { useState } from "react"

const API_BASE = "http://localhost:8787"
const TENANT_SLUG = "g2g-roofing"

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
  emergency_tarp_needed?: boolean
  emergency_tarp_sqft?: number | null
  callback_notes?: string | null
  estimator_remarks?: string | null
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

function addressLine(job?: JobSummary | null) {
  if (!job) return "—"
  return [job.address1, job.city, job.state, job.zip].filter(Boolean).join(", ") || "—"
}

export default function DocumentPipelinePage() {
  const [jobId, setJobId] = useState("")
  const [job, setJob] = useState<JobSummary | null>(null)
  const [documents, setDocuments] = useState<DocumentPackage[]>([])
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")

  const [form, setForm] = useState<EstimateDetails>({
    roof_type: "",
    roof_squares: null,
    low_amount: null,
    high_amount: null,
    agreed_amount: null,
    carrier_approved_amount: null,
    claim_number: "",
    deductible: "",
    emergency_tarp_needed: false,
    emergency_tarp_sqft: null,
    callback_notes: "",
    estimator_remarks: "",
  })

  function setField<K extends keyof EstimateDetails>(key: K, value: EstimateDetails[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function loadJob() {
    setError("")
    setStatus("Loading pipeline...")

    try {
      const res = await fetch(`${API_BASE}/pipeline/${TENANT_SLUG}/job/${jobId}`)
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
        emergency_tarp_needed: !!d.emergency_tarp_needed,
        emergency_tarp_sqft: d.emergency_tarp_sqft ?? null,
        callback_notes: d.callback_notes || "",
        estimator_remarks: d.estimator_remarks || "",
      })

      setStatus("Pipeline loaded")
    } catch (err: any) {
      setError(err?.message || "Load failed")
      setStatus("Load failed")
    }
  }

  async function saveEstimateDetails() {
    setError("")
    setStatus("Saving estimate details...")

    try {
      const res = await fetch(`${API_BASE}/pipeline/${TENANT_SLUG}/job/${jobId}/estimate-details`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error || "Save failed")
      }

      setStatus("Estimate details saved")
      await loadJob()
    } catch (err: any) {
      setError(err?.message || "Save failed")
      setStatus("Save failed")
    }
  }

  async function createPackage(packageType: "retail_estimate" | "insurance_contract" | "ems_tarp") {
    setError("")
    setStatus(`Creating ${packageType} package...`)

    try {
      const res = await fetch(`${API_BASE}/pipeline/${TENANT_SLUG}/job/${jobId}/create-package`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          package_type: packageType,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error || "Create package failed")
      }

      setStatus(`${packageType} package created`)
      await loadJob()
    } catch (err: any) {
      setError(err?.message || "Create package failed")
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
      <section style={cardStyle}>
        <h1 style={{ marginTop: 0, fontSize: "42px", lineHeight: 1.1 }}>Document Pipeline</h1>
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
        <h2 style={{ marginTop: 0 }}>Job Summary</h2>
        {job ? (
          <div style={{ lineHeight: 1.7, fontSize: "18px" }}>
            <div><strong>Customer:</strong> {job.customer_name || "—"}</div>
            <div><strong>Email:</strong> {job.customer_email || "—"}</div>
            <div><strong>Phone:</strong> {job.customer_phone || "—"}</div>
            <div><strong>Address:</strong> {addressLine(job)}</div>
            <div><strong>Stage:</strong> {job.stage || "—"}</div>
            <div><strong>CRM Substatus:</strong> {job.crm_substatus || "—"}</div>
          </div>
        ) : (
          <p>No job loaded yet.</p>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Estimator Details</h2>

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

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px" }}>
            <div>
              <label style={labelStyle}>Low Amount</label>
              <input
                value={form.low_amount ?? ""}
                onChange={(e) =>
                  setField("low_amount", e.target.value === "" ? null : Number(e.target.value))
                }
                placeholder="9800"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>High Amount</label>
              <input
                value={form.high_amount ?? ""}
                onChange={(e) =>
                  setField("high_amount", e.target.value === "" ? null : Number(e.target.value))
                }
                placeholder="11800"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Agreed Amount</label>
              <input
                value={form.agreed_amount ?? ""}
                onChange={(e) =>
                  setField("agreed_amount", e.target.value === "" ? null : Number(e.target.value))
                }
                placeholder="10500"
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
            <label style={labelStyle}>Estimator Remarks</label>
            <textarea
              value={form.estimator_remarks || ""}
              onChange={(e) => setField("estimator_remarks", e.target.value)}
              placeholder="32 squares, architectural shingles, replace vents, renail deck."
              style={textareaStyle}
            />
          </div>

          <div>
            <button onClick={saveEstimateDetails} style={buttonStyle}>
              Save Estimator Details
            </button>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Create Document Packages</h2>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <button onClick={() => createPackage("retail_estimate")} style={buttonStyle}>
            Create Retail Estimate
          </button>
          <button onClick={() => createPackage("insurance_contract")} style={buttonStyle}>
            Create Insurance Contract
          </button>
          <button onClick={() => createPackage("ems_tarp")} style={buttonStyle}>
            Create EMS Tarp Authorization
          </button>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Generated Packages</h2>

        {documents.length ? (
          <div style={{ display: "grid", gap: "12px" }}>
            {documents.map((doc) => (
              <div key={doc.id} style={rowStyle}>
                <div style={{ fontWeight: 700 }}>{doc.document_title}</div>
                <div style={{ opacity: 0.9 }}>Type: {doc.package_type}</div>
                <div style={{ opacity: 0.9 }}>Status: {doc.status}</div>
                <div style={{ opacity: 0.75 }}>Template: {doc.template_source || "—"}</div>
                <div style={{ opacity: 0.65 }}>
                  Created: {doc.created_at ? new Date(doc.created_at).toLocaleString() : "—"}
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
