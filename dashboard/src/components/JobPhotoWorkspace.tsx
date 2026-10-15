import { useCallback, useEffect, useRef, useState } from "react"
import { getToken } from "../lib/auth"
import { useLanguage } from "../context/LanguageContext"

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
  const { language } = useLanguage()
  const spanish = language === "es"
  const tr = (en: string, es: string) => spanish ? es : en

  // Translate presentation only; preserve category database keys.
  const categoryLabels: Record<string, string> = {
    Roof: "Techo",
    Tarp: "Lona",
    Repairs: "Reparaciones",
    Exterior: "Exterior",
    Interior: "Interior",
    Damage: "Daños",
    Before: "Antes",
    During: "Durante",
    After: "Después",
    Other: "Otro",
    Documents: "Documentos",
  }
  const categoryLabel = (key: string) =>
    spanish ? (categoryLabels[key] || key) : key
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
  const [selectedViewerPhotoId, setSelectedViewerPhotoId] = useState<number | null>(null)
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
      setMessage(spanish ? "Operación completada" : `${label} completed`)
    } catch (err: any) {
      setError(err?.message || tr(`${label} failed`, "No se pudo completar la operación"))
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

  async function deletePhoto(photo: Photo) {
    if (busy) return

    if (!window.confirm(
      tr("Permanently delete this photo? This cannot be undone.", "¿Eliminar esta foto permanentemente? Esta acción no se puede deshacer.")
    )) return

    setBusy("Delete photo")
    setError("")
    setMessage("")

    try {
      const response = await fetch(`${base}/photo/${photo.id}`, {
        method: "DELETE",
        headers: headers(),
      })

      const data = await response.json()
      if (!response.ok || !data.ok) {
        throw new Error(data.error || tr("Photo deletion failed", "No se pudo eliminar la foto"))
      }

      const index = photos.findIndex(item => item.id === photo.id)
      const adjacent = photos[index + 1] || photos[index - 1]
      setSelectedViewerPhotoId(current =>
        current === photo.id ? (adjacent?.id ?? null) : current
      )
      setMessage(tr("Photo permanently deleted", "Foto eliminada permanentemente"))
      await load()
    } catch (err: any) {
      setError(err?.message || tr("Photo deletion failed", "No se pudo eliminar la foto"))
    } finally {
      setBusy("")
    }
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
      {selectedViewerPhotoId !== null && (() => {
          const index = photos.findIndex(photo => photo.id === selectedViewerPhotoId)
          if (index < 0) return null

          const photo = photos[index]
          const previous = photos[index - 1]
          const next = photos[index + 1]

          return (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={tr("Job photo viewer", "Visor de fotos del trabajo")}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 20000,
                background: "rgba(0,0,0,0.94)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                padding: 18,
                boxSizing: "border-box",
                color: "#fff",
              }}
            >
              <strong>{tr("Photo", "Foto")} {index + 1} / {photos.length}</strong>
              {previews[photo.id] ? (
                <img
                  src={previews[photo.id]}
                  alt={photo.note || photo.original_name || "Job photo"}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "75vh",
                    objectFit: "contain",
                    transform: `rotate(${rotations[photo.id] || 0}deg)`,
                  }}
                />
              ) : (
                <span>{tr("Loading photo...", "Cargando foto...")}</span>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <button
                  type="button"
                  disabled={!previous}
                  onClick={() => previous && setSelectedViewerPhotoId(previous.id)}
                >
                  {tr("← Back", "← Anterior")}
                </button>
                <button
                  type="button"
                  disabled={!next}
                  onClick={() => next && setSelectedViewerPhotoId(next.id)}
                >
                  {tr("Next →", "Siguiente →")}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void deletePhoto(photo)}
                  style={{
                    background: "#dc2626",
                    color: "#fff",
                    padding: "10px 14px",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 800,
                  }}
                >
                  {tr("Delete Photo", "Eliminar foto")}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedViewerPhotoId(null)}
                >
                  {tr("Close", "Cerrar")}
                </button>
              </div>
            </div>
          )
        })()}

        <h3>{tr("Job Photo Workspace", "Espacio de fotos del trabajo")} ({photos.length})</h3>
      <p>{tr("Shared photo history for currently assigned job personnel.", "Historial de fotos compartido con el personal asignado al trabajo.")}</p>

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
          {CATEGORIES.map(value => <option key={value} value={value}>{categoryLabel(value)}</option>)}
        </select>
        <button disabled={!!busy || !files.length} onClick={() => void upload()}>
          {busy === "Upload" ? tr("Uploading...", "Subiendo...") : tr("Upload Photos", "Subir fotos")}
        </button>
      </div>

      {loading && <p>{tr("Loading photos...", "Cargando fotos...")}</p>}

      {photos.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(value => !value)}
            aria-expanded={expanded}
          >
            {expanded
              ? tr("Finish Editing / Show Recent Photos", "Terminar edición / Mostrar fotos recientes")
              : photos.length > 3
                ? tr(`View All ${photos.length} Photos / Edit`, `Ver las ${photos.length} fotos / Editar`)
                : tr("Edit Photos", "Editar fotos")}
          </button>
        )}

      <div style={{
        display: "grid",
        gridTemplateColumns: expanded
          ? "repeat(2, minmax(0, 1fr))"
          : "repeat(3, minmax(0, 1fr))",
        gap: 14,
        marginTop: 14,
        alignItems: "start",
      }}>
      {(expanded ? photos : photos.slice(0, 3)).map(photo => (
        <article key={photo.id} style={{
          padding: 12,
          minWidth: 0,
          background: "#1c3b61",
          borderRadius: 10,
        }}>
          {previews[photo.id] && (
            <img
              src={previews[photo.id]}
              alt={photo.note || photo.original_name || "Job photo"}
              style={{
                width: "100%",
                height: expanded ? 250 : 160,
                objectFit: "contain",
                transform: `rotate(${rotations[photo.id] || 0}deg)`,
              }}
            />
          )}

          <p style={{ overflowWrap: "anywhere", fontWeight: 700 }}>{photo.original_name || `Photo ${photo.id}`}</p>
            <button
              type="button"
              onClick={() => {
                setExpanded(true)
                setSelectedViewerPhotoId(photo.id)
              }}
            >
              {tr("Open Full Size", "Ver foto en tamaño completo")}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void deletePhoto(photo)}
              style={{
                background: "#dc2626",
                color: "#fff",
                border: "none",
                padding: "8px 12px",
                borderRadius: 8,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {tr("Delete Photo", "Eliminar foto")}
            </button>
          {!expanded && (
            <div>
              <p>{descriptions[photo.id] || tr("No description", "Sin descripción")}</p>
              <p>{tr("Category", "Categoría")}: {categoryLabel(categories[photo.id] || "Not specified")}</p>
              <button disabled={!!busy} onClick={() => void downloadPhoto(photo)}>{tr("Download Photo", "Descargar foto")}</button>
            </div>
          )}
          {expanded && (
            <div style={{ display: "grid", gap: 8 }}>

          <label>
            {tr("Description", "Descripción")}
            <textarea
              value={descriptions[photo.id] || ""}
              onChange={event => setDescriptions(current => ({
                ...current,
                [photo.id]: event.target.value,
              }))}
            />
          </label>

          <label>
            {tr("Category", "Categoría")}
            <select
              value={categories[photo.id] || "Roof"}
              onChange={event => setCategories(current => ({
                ...current,
                [photo.id]: event.target.value,
              }))}
            >
              {[...new Set([...CATEGORIES, categories[photo.id] || "Roof"])].map(
                value => <option key={value} value={value}>{categoryLabel(value)}</option>
              )}
            </select>
          </label>

          <label>
            {tr("Sequence", "Secuencia")}
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
            {tr("Photo location", "Ubicación de la foto")}
            <input
              value={locations[photo.id] || ""}
              placeholder={tr("e.g. Front roof slope", "Ej.: pendiente frontal del techo")}
              onChange={event => setLocations(current => ({
                ...current,
                [photo.id]: event.target.value,
              }))}
            />
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={!!busy} onClick={() => void saveDetails(photo)}>
              {tr("Save Description / Category", "Guardar descripción / categoría")}
            </button>
            <button onClick={() => setRotations(current => ({
              ...current,
              [photo.id]: ((current[photo.id] || 0) + 270) % 360,
            }))}>
              {tr("Rotate Left", "Girar a la izquierda")}
            </button>
            <button onClick={() => setRotations(current => ({
              ...current,
              [photo.id]: ((current[photo.id] || 0) + 90) % 360,
            }))}>
              {tr("Rotate Right", "Girar a la derecha")}
            </button>
            <button disabled={!!busy} onClick={() => void downloadPhoto(photo)}>
              {tr("Download Photo", "Descargar foto")}
            </button>
          </div>
                      </div>
            )}
</article>
      ))}
      </div>

      {photos.length > 0 && (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 20,
        }}>
          <button disabled={!!busy} onClick={() => void saveSequence()}>
            {tr("Save Photo Sequence", "Guardar secuencia de fotos")}
          </button>
          <button disabled={!!busy} onClick={() => void downloadPhotos()}>
            {tr("Download Photos", "Descargar fotos")}
          </button>
          <button disabled={!!busy} onClick={() => void report()}>
            {tr("Generate PDF Photo Report", "Generar informe PDF de fotos")}
          </button>
        </div>
      )}
    </section>
  )
}
