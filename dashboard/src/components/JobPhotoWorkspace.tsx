import { useCallback, useEffect, useRef, useState } from "react"
import { getToken } from "../lib/auth"

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://contractor-navigator.onrender.com"

type Photo = {
  id: number
  original_name?: string
  asset_category?: string
  note?: string | null
  created_at?: string | null
  mime_type?: string
}

type Props = {
  tenantSlug: string
  jobId: number
}

const CATEGORIES = [
  "Roof",
  "Tarp",
  "Repairs",
  "Exterior",
  "Interior",
  "Damage",
  "Before",
  "During",
  "After",
  "Other",
]

export default function JobPhotoWorkspace({ tenantSlug, jobId }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [previews, setPreviews] = useState<Record<number, string>>({})
  const [files, setFiles] = useState<File[]>([])
  const [category, setCategory] = useState("Roof")
  const [descriptions, setDescriptions] = useState<Record<number, string>>({})
  const [categories, setCategories] = useState<Record<number, string>>({})
  const [sequences, setSequences] = useState<Record<number, string>>({})
  const [rotations, setRotations] = useState<Record<number, number>>({})
  const [locations, setLocations] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [expanded, setExpanded] = useState(false)
  const previewUrls = useRef<string[]>([])

  const base = `${API_BASE}/assets/${encodeURIComponent(tenantSlug)}/job/${jobId}`

  const headers = () => ({
    Authorization: `Bearer ${getToken()}`,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${base}/photos`, {
        headers: headers(),
        cache: "no-store",
      })
      const data = await response.json()
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to load photos")
      }
      const items: Photo[] = Array.isArray(data.assets) ? data.assets : []
      setPhotos(items)
      setDescriptions(Object.fromEntries(
        items.map(photo => [photo.id, photo.note || ""])
      ))
      setCategories(Object.fromEntries(
        items.map(photo => [photo.id, photo.asset_category || "Roof"])
      ))
      if (Array.isArray(data.photo_sequence)) {
        setSequences(Object.fromEntries(
          data.photo_sequence.map((id: number, index: number) => [id, String(index + 1)])
        ))
      }
    } catch (err: any) {
      setError(err?.message || "Unable to load photos")
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    const created: string[] = []

    async function fetchPreviews() {
      const visible = expanded ? photos : photos.slice(0, 3)
      const next: Record<number, string> = {}

      for (const photo of visible) {
        if (cancelled) break
        try {
          const response = await fetch(
            `${API_BASE}/assets/${encodeURIComponent(tenantSlug)}/file/${photo.id}`,
            { headers: headers() }
          )
          if (!response.ok) continue
          const url = URL.createObjectURL(await response.blob())
          created.push(url)
          next[photo.id] = url
        } catch {
          // Never expose an unauthenticated fallback URL.
        }
      }

      if (!cancelled) setPreviews(next)
    }

    void fetchPreviews()

    return () => {
      cancelled = true
      created.forEach(url => URL.revokeObjectURL(url))
      previewUrls.current = []
    }
  }, [photos, expanded, tenantSlug])

  async function request(
    endpoint: string,
    method: string,
    body?: unknown
  ) {
    const response = await fetch(`${base}${endpoint}`, {
      method,
      headers: {
        ...headers(),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await response.json()
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `${method} ${endpoint} failed`)
    }
    return data
  }

  async function perform(label: string, action: () => Promise<void>) {
    if (busy) return
    setBusy(label)
    setError("")
    setMessage("")
    try {
      await action()
      setMessage(`${label} completed`)
    } catch (err: any) {
      setError(err?.message || `${label} failed`)
    } finally {
      setBusy("")
    }
  }

  async function upload() {
    if (!files.length) return
    await perform("Upload", async () => {
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          throw new Error(`Not an image: ${file.name}`)
        }
        const form = new FormData()
        form.append("file", file)
        form.append("asset_category", category)
        form.append("note", "")
        const response = await fetch(`${base}/upload`, {
          method: "POST",
          headers: headers(),
          body: form,
        })
        const data = await response.json()
        if (!response.ok || !data.ok) {
          throw new Error(data.error || `Upload failed: ${file.name}`)
        }
      }
      setFiles([])
      await load()
    })
  }

  async function saveDetails(photo: Photo) {
    await perform("Save details", async () => {
      await request(`/file/${photo.id}/metadata`, "PATCH", {
        note: descriptions[photo.id] || "",
        asset_category: categories[photo.id] || "Roof",
      })
      await load()
    })
  }

  function selectedPhotos() {
    const chosen = photos
      .map(photo => ({
        photo,
        sequence: Number(sequences[photo.id]),
      }))
      .filter(item => Number.isInteger(item.sequence) && item.sequence > 0)
      .sort((a, b) => a.sequence - b.sequence)

    if (!chosen.length) {
      throw new Error("Enter sequence numbers for the photos to include")
    }

    const values = chosen.map(item => item.sequence)
    if (new Set(values).size !== values.length) {
      throw new Error("Photo sequence numbers must be unique")
    }

    return chosen
  }

  async function saveSequence() {
    await perform("Save sequence", async () => {
      const chosen = selectedPhotos()
      await request("/photo-sequence", "POST", {
        photo_ids: chosen.map(item => item.photo.id),
      })
    })
  }

  async function report() {
    await perform("Generate PDF report", async () => {
      const chosen = selectedPhotos()
      const result = await request("/photo-report", "POST", {
        photo_ids: chosen.map(item => item.photo.id),
        photo_edits: chosen.map(item => ({
          photo_id: item.photo.id,
          rotation: rotations[item.photo.id] || 0,
          location: locations[item.photo.id] || "",
        })),
      })
      const reportId = Number(result.report?.id)
      if (!Number.isInteger(reportId) || reportId <= 0) {
        throw new Error("Report generated without a valid download ID")
      }
      await download(
        `/photo-report/${reportId}/download`,
        result.report?.original_name || `job-${jobId}-photo-report.pdf`
      )
      await load()
    })
  }

  async function download(endpoint: string, filename: string) {
    const response = await fetch(`${base}${endpoint}`, {
      headers: headers(),
    })
    if (!response.ok) {
      throw new Error(`Download failed (${response.status})`)
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    try {
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    }
  }

  async function downloadPhotos() {
    await perform("Download photos", async () => {
      const response = await fetch(`${base}/photo-download`, {
        headers: headers(),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Photo download failed")
      }

      const contentType = response.headers.get("content-type") || ""

      if (contentType.includes("application/json")) {
        const data = await response.json()

        if (!data.ok || data.mode !== "individual" || !Array.isArray(data.files)) {
          throw new Error(data.error || "Unexpected photo download response")
        }

        for (const file of data.files) {
          const photo = photos.find(item => item.id === Number(file.asset_id))
          if (!photo) {
            throw new Error("Photo no longer available in this workspace")
          }

          const photoResponse = await fetch(
            `${API_BASE}/assets/${encodeURIComponent(tenantSlug)}/file/${photo.id}`,
            { headers: headers() }
          )

          if (!photoResponse.ok) {
            throw new Error(`Unable to download photo ${photo.id}`)
          }

          const blob = await photoResponse.blob()
          const url = URL.createObjectURL(blob)

          try {
            const anchor = document.createElement("a")
            anchor.href = url
            anchor.download = file.filename || photo.original_name || `photo-${photo.id}`
            document.body.appendChild(anchor)
            anchor.click()
            anchor.remove()
          } finally {
            setTimeout(() => URL.revokeObjectURL(url), 10000)
          }
        }
        return
      }

      if (!contentType.includes("application/zip")) {
        throw new Error("Unexpected photo archive format")
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)

      try {
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = `job-${jobId}-photos.zip`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
    })
  }

  async function downloadPhoto(photo: Photo) {
    await perform("Download photo", async () => {
      const response = await fetch(
        `${API_BASE}/assets/${encodeURIComponent(tenantSlug)}/file/${photo.id}`,
        { headers: headers() }
      )
      if (!response.ok) throw new Error("Unable to download photo")
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      try {
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = photo.original_name || `photo-${photo.id}`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
    })
  }

  return (
    <section style={{
      padding: 16,
      marginTop: 16,
      borderRadius: 12,
      background: "#142b4a",
      color: "#fff",
    }}>
      <h3>Job Photo Workspace ({photos.length})</h3>
      <p>Shared photo history for currently assigned job personnel.</p>

      {error && <p role="alert" style={{ color: "#fecaca" }}>{error}</p>}
      {message && <p style={{ color: "#bbf7d0" }}>{message}</p>}

      <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={event => setFiles(Array.from(event.target.files || []))}
        />
        <select value={category} onChange={event => setCategory(event.target.value)}>
          {CATEGORIES.map(value => <option key={value}>{value}</option>)}
        </select>
        <button disabled={!!busy || !files.length} onClick={() => void upload()}>
          {busy === "Upload" ? "Uploading..." : "Upload Photos"}
        </button>
      </div>

      {loading && <p>Loading photos...</p>}

      {photos.length > 3 && (
        <button onClick={() => setExpanded(value => !value)}>
          {expanded ? "Show Fewer Photos" : `View All ${photos.length} Photos`}
        </button>
      )}

      {(expanded ? photos : photos.slice(0, 3)).map(photo => (
        <article key={photo.id} style={{
          padding: 12,
          marginTop: 12,
          background: "#1c3b61",
          borderRadius: 10,
        }}>
          {previews[photo.id] && (
            <img
              src={previews[photo.id]}
              alt={photo.note || photo.original_name || "Job photo"}
              style={{
                width: "100%",
                maxHeight: 350,
                objectFit: "contain",
                transform: `rotate(${rotations[photo.id] || 0}deg)`,
              }}
            />
          )}

          <p>{photo.original_name || `Photo ${photo.id}`}</p>

          <label>
            Description
            <textarea
              value={descriptions[photo.id] || ""}
              onChange={event => setDescriptions(current => ({
                ...current,
                [photo.id]: event.target.value,
              }))}
            />
          </label>

          <label>
            Category
            <select
              value={categories[photo.id] || "Roof"}
              onChange={event => setCategories(current => ({
                ...current,
                [photo.id]: event.target.value,
              }))}
            >
              {[...new Set([...CATEGORIES, categories[photo.id] || "Roof"])].map(
                value => <option key={value}>{value}</option>
              )}
            </select>
          </label>

          <label>
            Sequence
            <input
              type="number"
              min="1"
              value={sequences[photo.id] || ""}
              onChange={event => setSequences(current => ({
                ...current,
                [photo.id]: event.target.value,
              }))}
            />
          </label>

          <label>
            Photo location
            <input
              value={locations[photo.id] || ""}
              placeholder="e.g. Front roof slope"
              onChange={event => setLocations(current => ({
                ...current,
                [photo.id]: event.target.value,
              }))}
            />
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={!!busy} onClick={() => void saveDetails(photo)}>
              Save Description / Category
            </button>
            <button onClick={() => setRotations(current => ({
              ...current,
              [photo.id]: ((current[photo.id] || 0) + 270) % 360,
            }))}>
              Rotate Left
            </button>
            <button onClick={() => setRotations(current => ({
              ...current,
              [photo.id]: ((current[photo.id] || 0) + 90) % 360,
            }))}>
              Rotate Right
            </button>
            <button disabled={!!busy} onClick={() => void downloadPhoto(photo)}>
              Download Photo
            </button>
          </div>
        </article>
      ))}

      {photos.length > 0 && (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 20,
        }}>
          <button disabled={!!busy} onClick={() => void saveSequence()}>
            Save Photo Sequence
          </button>
          <button disabled={!!busy} onClick={() => void downloadPhotos()}>
            Download Photos
          </button>
          <button disabled={!!busy} onClick={() => void report()}>
            Generate PDF Photo Report
          </button>
        </div>
      )}
    </section>
  )
}
