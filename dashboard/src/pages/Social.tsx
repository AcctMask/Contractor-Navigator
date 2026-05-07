import { useEffect, useState } from "react"

const API = import.meta.env.VITE_SOCIAL_API_BASE || "https://g2g-weather-event-backend-1.onrender.com"
const CONTRACTOR_ID = "g2g"

export default function SocialPage() {
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function loadPosts() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/social/posts?contractor_id=${CONTRACTOR_ID}&limit=50`)
      const data = await res.json()
      setPosts(data.rows || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function queue() {
    await fetch(`${API}/social/queue-biweekly-evergreen?include_good2go=true&include_actual_assistant=false`, {
      method: "POST",
    })
    loadPosts()
  }

  async function notify() {
    await fetch(`${API}/social/notify-pending-approvals`, { method: "POST" })
    loadPosts()
  }

  async function approve(id: string) {
    await fetch(`${API}/social/approve/${id}`)
    loadPosts()
  }

  async function reject(id: string) {
    await fetch(`${API}/social/reject/${id}`)
    loadPosts()
  }

  useEffect(() => {
    loadPosts()
  }, [])

  return (
    <div style={{ padding: 20 }}>
      <h1>Social Dashboard (G2G)</h1>

      <div style={{ marginBottom: 20 }}>
        <button onClick={queue}>Queue Evergreen</button>
        <button onClick={notify} style={{ marginLeft: 10 }}>
          Send Approvals
        </button>
        <button onClick={loadPosts} style={{ marginLeft: 10 }}>
          Refresh
        </button>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        posts.map((p) => (
          <div
            key={p.id}
            style={{
              border: "1px solid #ccc",
              padding: 12,
              marginBottom: 10,
            }}
          >
            <div><b>Status:</b> {p.status}</div>
            <div><b>Text:</b> {p.post_text}</div>
            <div><b>Created:</b> {p.created_at}</div>
            <div><b>Approved:</b> {p.approved_at || "-"}</div>
            <div><b>Published:</b> {p.published_at || "-"}</div>

            {p.publish_error && (
              <div style={{ color: "red" }}>
                <b>Error:</b> {p.publish_error}
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <button onClick={() => approve(p.id)}>Approve</button>
              <button onClick={() => reject(p.id)} style={{ marginLeft: 10 }}>
                Reject
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
