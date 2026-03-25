import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"

const API = import.meta.env.VITE_API_BASE || "http://localhost:8787"

type SignStatus = "loading" | "ready" | "error" | "signed" | "submitting"

export default function SignDocument() {
  const { id } = useParams()
  const [doc, setDoc] = useState<any>(null)
  const [name, setName] = useState("")
  const [agree, setAgree] = useState(false)
  const [status, setStatus] = useState<SignStatus>("loading")
  const [error, setError] = useState("")

  useEffect(() => {
    let isMounted = true

    async function loadDocument() {
      try {
        setStatus("loading")
        setError("")

        const res = await fetch(`${API}/sign/${id}`)
        const data = await res.json()

        if (!isMounted) return

        if (data?.ok && data?.document) {
          setDoc(data.document)
          setStatus("ready")
          return
        }

        setStatus("error")
        setError(data?.error || "Document not found")
      } catch (err: any) {
        if (!isMounted) return
        setStatus("error")
        setError(err?.message || "Unable to load document")
      }
    }

    void loadDocument()

    return () => {
      isMounted = false
    }
  }, [id])

  async function handleSign() {
    if (!name.trim()) {
      setError("Please enter your full name.")
      return
    }

    if (!agree) {
      setError("Please confirm authorization before signing.")
      return
    }

    try {
      setError("")
      setStatus("submitting")

      const res = await fetch(`${API}/sign/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signer_name: name.trim() }),
      })

      const data = await res.json()

      if (!data?.ok) {
        throw new Error(data?.error || "Signing failed")
      }

      setStatus("signed")
    } catch (err: any) {
      setStatus("ready")
      setError(err?.message || "Signing failed")
    }
  }

  const payload = doc?.payload || {}

  const customerName = payload.customer_name || "Customer"
  const propertyAddress = payload.job_address || "Address to be confirmed"
  const roofType = payload.roof_type || "To be determined"
  const roofSquares = payload.roof_squares || "To be determined"
  const lowAmount = payload.low_amount
  const highAmount = payload.high_amount
  const agreedAmount = payload.agreed_amount
  const phone = payload.customer_phone || "Not provided"
  const email = payload.customer_email || "Not provided"
  const remarks = payload.estimator_remarks || "None provided"

  const amountDisplay = useMemo(() => {
    const formatMoney = (value: any) => {
      const num = Number(value)
      if (!Number.isFinite(num)) return null
      return num.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })
    }

    const agreed = formatMoney(agreedAmount)
    const low = formatMoney(lowAmount)
    const high = formatMoney(highAmount)

    if (agreed) return agreed
    if (low && high) return `${low} - ${high}`
    if (low) return low
    if (high) return high
    return "To be determined"
  }, [agreedAmount, lowAmount, highAmount])

  if (status === "loading") {
    return (
      <div style={page}>
        <div style={card}>
          <div style={pill}>Loading document</div>
          <h1 style={title}>Please wait…</h1>
        </div>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div style={page}>
        <div style={card}>
          <div style={pill}>Document unavailable</div>
          <h1 style={title}>Document not found</h1>
          <p style={subtext}>{error}</p>
        </div>
      </div>
    )
  }

  if (status === "signed") {
    return (
      <div style={page}>
        <div style={card}>
          <div style={successBadge}>Signed Successfully</div>
          <h1 style={title}>Thank you, {name}.</h1>
          <p style={subtext}>
            Your document has been signed and saved. A Good2Go Roofing team member
            will follow up with next steps.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={page}>
      <div style={shell}>
        <div style={headerCard}>
          <div style={pill}>Good2Go Roofing</div>
          <h1 style={title}>{doc?.document_title || "Document Review"}</h1>
          <p style={subtext}>
            Please review the information below, confirm authorization, and sign to proceed.
          </p>
        </div>

        <div style={grid}>
          <section style={leftCard}>
            <h2 style={sectionTitle}>Project Summary</h2>

            <div style={summaryGrid}>
              <Info label="Customer" value={customerName} />
              <Info label="Phone" value={phone} />
              <Info label="Email" value={email} />
              <Info label="Property Address" value={propertyAddress} />
              <Info label="Roof Type" value={roofType} />
              <Info label="Roof Size" value={String(roofSquares)} />
              <Info label="Estimated Amount" value={amountDisplay} />
            </div>

            <div style={docBox}>
              <h3 style={docBoxTitle}>Authorization</h3>
              <p style={docText}>
                By signing below, you authorize Good2Go Roofing to prepare, present,
                and move forward with the work described for this property based on
                the applicable document package and project details.
              </p>
              <p style={docText}>
                Final scope, pricing, materials, and claim-related handling will follow
                the terms of the selected document package and any approved insurance,
                estimate, or project-specific information associated with this file.
              </p>
              <p style={docText}>
                Additional remarks: {remarks}
              </p>
            </div>
          </section>

          <section style={rightCard}>
            <h2 style={sectionTitle}>Customer Signature</h2>

            <label style={label}>Full Legal Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Type your full name"
              style={input}
            />

            <label style={checkRow}>
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
              />
              <span>
                By checking this box, I authorize Good2Go Roofing to proceed in
                accordance with this document and the related project terms.
              </span>
            </label>

            {error ? <div style={errorBox}>{error}</div> : null}

            <button
              onClick={handleSign}
              style={button}
              disabled={status === "submitting"}
            >
              {status === "submitting" ? "Signing..." : "Sign Document"}
            </button>

            <div style={noteBox}>
              <strong>Note:</strong> This mobile-friendly signature flow is intended to
              make approvals fast and simple for customers in the field or at home.
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={infoCard}>
      <div style={infoLabel}>{label}</div>
      <div style={infoValue}>{value}</div>
    </div>
  )
}

const page: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #02142f 0%, #031a42 100%)",
  padding: "28px 18px",
  color: "#edf4ff",
}

const shell: React.CSSProperties = {
  maxWidth: "1100px",
  margin: "0 auto",
  display: "grid",
  gap: "18px",
}

const headerCard: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(12,33,84,0.98) 0%, rgba(21,54,126,0.92) 100%)",
  border: "1px solid rgba(93, 146, 255, 0.22)",
  borderRadius: "24px",
  padding: "24px",
  boxShadow: "0 18px 48px rgba(0,0,0,0.24)",
}

const card: React.CSSProperties = {
  maxWidth: "720px",
  margin: "60px auto",
  background: "linear-gradient(135deg, rgba(12,33,84,0.98) 0%, rgba(21,54,126,0.92) 100%)",
  border: "1px solid rgba(93, 146, 255, 0.22)",
  borderRadius: "24px",
  padding: "28px",
  boxShadow: "0 18px 48px rgba(0,0,0,0.24)",
}

const pill: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 12px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.08)",
  fontSize: "12px",
  fontWeight: 700,
  marginBottom: "14px",
}

const successBadge: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 12px",
  borderRadius: "999px",
  background: "rgba(34,197,94,0.16)",
  color: "#c9ffd9",
  fontSize: "12px",
  fontWeight: 700,
  marginBottom: "14px",
  border: "1px solid rgba(34,197,94,0.28)",
}

const title: React.CSSProperties = {
  fontSize: "clamp(30px, 5vw, 52px)",
  lineHeight: 1.05,
  margin: 0,
  fontWeight: 800,
}

const subtext: React.CSSProperties = {
  marginTop: "12px",
  fontSize: "17px",
  lineHeight: 1.5,
  color: "rgba(237,244,255,0.82)",
}

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.2fr 0.9fr",
  gap: "18px",
}

const leftCard: React.CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(93, 146, 255, 0.16)",
  borderRadius: "22px",
  padding: "22px",
}

const rightCard: React.CSSProperties = {
  background: "rgba(8, 22, 59, 0.92)",
  border: "1px solid rgba(93, 146, 255, 0.16)",
  borderRadius: "22px",
  padding: "22px",
}

const sectionTitle: React.CSSProperties = {
  margin: "0 0 16px 0",
  fontSize: "26px",
  fontWeight: 800,
}

const summaryGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "12px",
}

const infoCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "16px",
  padding: "14px",
}

const infoLabel: React.CSSProperties = {
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  opacity: 0.65,
  marginBottom: "6px",
}

const infoValue: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 700,
  lineHeight: 1.35,
}

const docBox: React.CSSProperties = {
  marginTop: "18px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  padding: "18px",
}

const docBoxTitle: React.CSSProperties = {
  margin: "0 0 10px 0",
  fontSize: "18px",
  fontWeight: 800,
}

const docText: React.CSSProperties = {
  margin: "0 0 12px 0",
  lineHeight: 1.6,
  color: "rgba(237,244,255,0.88)",
}

const label: React.CSSProperties = {
  display: "block",
  marginBottom: "8px",
  fontSize: "14px",
  fontWeight: 700,
}

const input: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: "14px",
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.96)",
  color: "#0b1733",
  fontSize: "16px",
  boxSizing: "border-box",
}

const checkRow: React.CSSProperties = {
  display: "flex",
  gap: "12px",
  alignItems: "flex-start",
  marginTop: "18px",
  lineHeight: 1.5,
  fontSize: "15px",
}

const button: React.CSSProperties = {
  width: "100%",
  marginTop: "18px",
  padding: "14px 16px",
  borderRadius: "14px",
  border: "none",
  background: "linear-gradient(90deg, #2563eb 0%, #4aa8ff 100%)",
  color: "#fff",
  fontSize: "18px",
  fontWeight: 800,
  cursor: "pointer",
}

const noteBox: React.CSSProperties = {
  marginTop: "16px",
  padding: "14px 16px",
  borderRadius: "14px",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "rgba(237,244,255,0.84)",
  lineHeight: 1.5,
}

const errorBox: React.CSSProperties = {
  marginTop: "14px",
  padding: "12px 14px",
  borderRadius: "12px",
  background: "rgba(255, 90, 90, 0.12)",
  border: "1px solid rgba(255, 90, 90, 0.28)",
  color: "#ffd4d4",
}
