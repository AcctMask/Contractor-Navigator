import { useEffect, useState, type CSSProperties } from "react"
import { Link, useParams } from "react-router-dom"

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787"
const TENANT = "g2g-roofing"

const STAGES = [
  "lead","callback","inspection","roof_repair","roof_replacement","tarp",
  "estimate_sent","contract_sent","pre_production","in_production",
  "completed","tarp_complete","invoiced","paid","dnc"
]

export default function JobDetail() {
  const { id } = useParams()

  const [job, setJob] = useState<any>(null)
  const [assets, setAssets] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [files, setFiles] = useState<FileList | null>(null)
  const [noteText, setNoteText] = useState("")
  const [stage, setStage] = useState("lead")
  const [crmSubstatus, setCrmSubstatus] = useState("")
  const [botPaused, setBotPaused] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")

  const [isEditingJob, setIsEditingJob] = useState(false)
  const [jobForm, setJobForm] = useState<any>({})

  async function loadJob() {
    const res = await fetch(`${API_BASE}/admin/${TENANT}/jobs/${id}`)
    const data = await res.json()
    if (!data.ok) return setError("Failed to load job")

    setJob(data.job)
    setJobForm(data.job)
    setStage(data.job.stage || "lead")
    setCrmSubstatus(data.job.crm_substatus || "")
    setBotPaused(Boolean(data.job.bot_paused))
  }

  async function loadAssets() {
    const res = await fetch(`${API_BASE}/assets/${TENANT}/job/${id}`)
    const data = await res.json()
    if (!data.ok) return

    setAssets(data.assets || [])
    setNotes(data.notes || [])
  }

  function setField(field: string, value: string) {
    setJobForm((p: any) => ({ ...p, [field]: value }))
  }

  async function saveJob() {
    setStatus("Saving...")
    const res = await fetch(`${API_BASE}/admin/job/${TENANT}/${id}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jobForm),
    })
    const data = await res.json()

    if (!data.ok) {
      setError("Save failed")
      setStatus("")
      return
    }

    setIsEditingJob(false)
    setStatus("Saved")
    loadJob()
  }

  async function saveStage() {
    await fetch(`${API_BASE}/admin/${TENANT}/jobs/${id}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage,
        crm_substatus: crmSubstatus,
        bot_paused: botPaused,
      }),
    })
    setStatus("Stage saved")
    loadJob()
  }

  useEffect(() => {
    loadJob()
    loadAssets()
  }, [id])

  return (
    <div style={page}>
      <Link to="/job-admin" style={link}>← Back</Link>

      <h1 style={{ color: "white" }}>Job #{id}</h1>

      {status && <p style={success}>{status}</p>}
      {error && <p style={danger}>{error}</p>}

      <section style={card}>
        <div style={header}>
          <h2>Customer / Claim Info</h2>
          <button onClick={() => setIsEditingJob(!isEditingJob)} style={button}>
            {isEditingJob ? "Cancel" : "Edit"}
          </button>
        </div>

        {!job ? <p>Loading...</p> : !isEditingJob ? (
          <>
            <p><b>{job.customer_name}</b></p>
            <p>{job.customer_phone}</p>
            <p>{job.customer_email}</p>
            <p>{[job.address1, job.city, job.state, job.zip].join(", ")}</p>

            <h3>Claim</h3>
            <p>{job.carrier}</p>
            <p>{job.claim_number}</p>
          </>
        ) : (
          <>
            <input value={jobForm.customer_name || ""} onChange={(e)=>setField("customer_name",e.target.value)} style={input}/>
            <input value={jobForm.customer_phone || ""} onChange={(e)=>setField("customer_phone",e.target.value)} style={input}/>
            <input value={jobForm.customer_email || ""} onChange={(e)=>setField("customer_email",e.target.value)} style={input}/>
            <input value={jobForm.address1 || ""} onChange={(e)=>setField("address1",e.target.value)} style={input}/>
            <input value={jobForm.city || ""} onChange={(e)=>setField("city",e.target.value)} style={input}/>
            <input value={jobForm.state || ""} onChange={(e)=>setField("state",e.target.value)} style={input}/>
            <input value={jobForm.zip || ""} onChange={(e)=>setField("zip",e.target.value)} style={input}/>

            <input value={jobForm.carrier || ""} onChange={(e)=>setField("carrier",e.target.value)} style={input}/>
            <input value={jobForm.claim_number || ""} onChange={(e)=>setField("claim_number",e.target.value)} style={input}/>

            <textarea value={jobForm.damage_summary || ""} onChange={(e)=>setField("damage_summary",e.target.value)} style={textarea}/>

            <button onClick={saveJob} style={button}>Save</button>
          </>
        )}
      </section>

      <section style={card}>
        <h2>Stage</h2>
        <select value={stage} onChange={(e)=>setStage(e.target.value)} style={input}>
          {STAGES.map(s => <option key={s}>{s}</option>)}
        </select>
        <button onClick={saveStage} style={button}>Save Stage</button>
      </section>

      <section style={card}>
        <h2>Notes</h2>
        {notes.map(n => <div key={n.id} style={note}>{n.message}</div>)}
      </section>

      <section style={card}>
        <h2>Files</h2>
        {assets.map(a => <div key={a.id}>{a.file_name}</div>)}
      </section>
    </div>
  )
}

const page: CSSProperties = { padding: 20 }
const card: CSSProperties = { background:"#111827",color:"white",padding:20,marginBottom:20,borderRadius:10 }
const input: CSSProperties = { width:"100%",padding:8,marginBottom:10 }
const textarea: CSSProperties = { width:"100%",padding:8,minHeight:80 }
const button: CSSProperties = { padding:"8px 12px",marginTop:10 }
const header: CSSProperties = { display:"flex",justifyContent:"space-between" }
const link: CSSProperties = { color:"#93c5fd" }
const success: CSSProperties = { color:"#22c55e" }
const danger: CSSProperties = { color:"#ef4444" }
const note: CSSProperties = { background:"#1f2937",padding:10,marginTop:10 }
