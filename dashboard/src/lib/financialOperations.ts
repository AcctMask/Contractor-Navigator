import { getToken } from "./auth"

const API_BASE = import.meta.env.VITE_API_BASE

const FOM_BASE_URL =
  import.meta.env.VITE_FINANCIAL_OPERATIONS_URL ||
  "https://actual-assistant-financial-operatio.vercel.app"

export async function openFinancialOperations(
  jobId?: number
): Promise<void> {
  const token = getToken()

  if (!token) {
    throw new Error("Navigator login required")
  }

  const response = await fetch(
    `${API_BASE}/financial-operations/handoff`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        job_id: jobId ?? null,
      }),
    }
  )

  const data = await response.json()

  if (!response.ok || !data?.code) {
    throw new Error(
      data?.error ||
        "Financial Operations could not be opened"
    )
  }

  const destination =
    `${FOM_BASE_URL}/navigator-handoff` +
    `?code=${encodeURIComponent(data.code)}`

  window.location.assign(destination)
}
