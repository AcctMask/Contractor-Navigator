import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import { getMe, type AuthUser } from "../lib/auth"

type Props = {
  children: React.ReactNode
  roles?: string[]
  unauthorizedTo?: string
}

export default function ProtectedRoute({
  children,
  roles,
  unauthorizedTo = "/",
}: Props) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loadError,setLoadError]=useState("")

  useEffect(() => {
    let active = true

    async function run() {
      try {
        const me = await Promise.race([getMe(),new Promise<never>((_,reject)=>window.setTimeout(()=>reject(new Error("Session verification timed out after 12 seconds")),12000))])
        if (active) setUser(me)
      } catch(error) {
        if(active)setLoadError(error instanceof Error ? error.message : "Session verification failed")
      } finally {
        if (active) setLoading(false)
      }
    }

    run()

    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background:
            "linear-gradient(135deg, rgba(0,25,70,1) 0%, rgba(2,18,47,1) 45%, rgba(8,42,102,1) 100%)",
          color: "#e8eefc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "20px",
        }}
      >
        Checking login...
      </div>
    )
  }

  if(loadError) return <div role="alert" style={{padding:32}}>Navigator sign-in succeeded, but session validation failed: {loadError}. Refresh this page to retry.</div>

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (roles && roles.length && !roles.includes(user.role)) {
    if(unauthorizedTo==="/field" && user.role==="subcontractor")return <Navigate to="/field" replace />
    return <div role="alert" style={{padding:32}}>PashLoc authentication completed, but this Navigator account has role <strong>{user.role}</strong>, which is not permitted on this page. Access has not been expanded. Contact Navigator administration to correct the role assignment.</div>
  }

  return <>{children}</>
}
