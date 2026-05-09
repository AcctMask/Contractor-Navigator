import { useEffect, useMemo, useState } from "react"

const API =
  import.meta.env.VITE_SOCIAL_API_BASE ||
  "https://g2g-weather-event-backend-1.onrender.com"

const CONTRACTOR_ID = "g2g"

type SocialPost = {
  id: string
  brand?: string
  post_text?: string
  source?: string
  status?: string
  approval_email?: string
  created_at?: string
  approved_at?: string | null
  rejected_at?: string | null
  published_at?: string | null
  published_url?: string | null
  destination_url?: string | null
  publish_error?: string | null
  facebook_post_id?: string | null
  facebook_post_url?: string | null
  wordpress_post_id?: string | null
}

function formatDate(value?: string | null) {
  if (!value) return "-"
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

function PostCard({
  post,
  onApprove,
  onReject,
}: {
  post: SocialPost
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  const actionable = post.status === "queued" || post.status === "approved"

  return (
    <div style={{ border: "1px solid #334155", borderRadius: 10, padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <b>{post.status || "unknown"}</b>
        <span>{formatDate(post.created_at)}</span>
      </div>

      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, marginBottom: 12 }}>
        {post.post_text || "No post text"}
      </div>

      <div style={{ fontSize: 13 }}>
        <div><b>Brand:</b> {post.brand || "-"}</div>
        <div><b>Source:</b> {post.source || "-"}</div>
        <div><b>Approval Email:</b> {post.approval_email || "-"}</div>
        <div><b>Approved:</b> {formatDate(post.approved_at)}</div>
        <div><b>Rejected:</b> {formatDate(post.rejected_at)}</div>
        <div><b>Published:</b> {formatDate(post.published_at)}</div>
        <div><b>Destination:</b> {post.destination_url || "-"}</div>
        {post.published_url && (
          <div><b>Website Post:</b> <a href={post.published_url} target="_blank" rel="noreferrer">{post.published_url}</a></div>
        )}
        {post.facebook_post_url && (
          <div><b>Facebook Post:</b> <a href={post.facebook_post_url} target="_blank" rel="noreferrer">{post.facebook_post_url}</a></div>
        )}
        {!post.facebook_post_url && post.facebook_post_id && <div><b>Facebook Post ID:</b> {post.facebook_post_id}</div>}
        {post.wordpress_post_id && <div><b>WordPress Post ID:</b> {post.wordpress_post_id}</div>}
      </div>

      {post.publish_error && (
        <div style={{ marginTop: 12, color: "red" }}>
          <b>Error:</b> {post.publish_error}
        </div>
      )}

      {actionable && (
        <div style={{ marginTop: 14 }}>
          <button onClick={() => onApprove(post.id)}>Approve / Publish</button>
          <button onClick={() => onReject(post.id)} style={{ marginLeft: 10 }}>Reject</button>
        </div>
      )}
    </div>
  )
}

export default function SocialPage() {
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)

  const operationalPosts = useMemo(() => {
    return posts.filter((p) => p.status === "queued" || p.status === "approved")
  }, [posts])

  const historyPosts = useMemo(() => {
    return posts.filter((p) => p.status === "published" || p.status === "rejected")
  }, [posts])

  async function loadPosts() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/social/posts?contractor_id=${CONTRACTOR_ID}&limit=100`)
      const data = await res.json()
      setPosts(data.rows || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function queue() {
    await fetch(`${API}/social/queue-biweekly-evergreen?include_good2go=true&include_actual_assistant=false`, { method: "POST" })
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
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1>Social Dashboard</h1>
      <p>Operational queue shows posts needing action. Published and rejected posts are stored in history. Click “Show History” to see completed posts and publishing links.</p>

      <div style={{ marginBottom: 20 }}>
        <button onClick={queue}>Queue Evergreen</button>
        <button onClick={notify} style={{ marginLeft: 10 }}>Send Approvals</button>
        <button onClick={loadPosts} style={{ marginLeft: 10 }}>Refresh</button>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <>
          <h2>Operational Queue ({operationalPosts.length})</h2>

          {operationalPosts.length === 0 ? (
            <div>No queued or approved posts need action.</div>
          ) : (
            operationalPosts.map((post) => (
              <PostCard key={post.id} post={post} onApprove={approve} onReject={reject} />
            ))
          )}

          <div style={{ marginTop: 30 }}>
            <button onClick={() => setShowHistory(!showHistory)}>
              {showHistory ? "Hide History" : `Show History (${historyPosts.length})`}
            </button>
          </div>

          {showHistory && (
            <div style={{ marginTop: 20 }}>
              <h2>History ({historyPosts.length})</h2>
              {historyPosts.map((post) => (
                <PostCard key={post.id} post={post} onApprove={approve} onReject={reject} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
