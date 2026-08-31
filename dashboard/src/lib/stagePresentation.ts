export type StagePresentation = {
  backgroundColor: string
  borderColor: string
  color: string
}

export function stagePresentation(
  stageValue?: string | null
): StagePresentation {
  const stage = String(stageValue || "").trim().toLowerCase()

  switch (stage) {
    // Early opportunity / discovery
    case "intake_pending":
    case "lead":
    case "callback":
    case "inspection":
      return {
        backgroundColor: "#fde68a",
        borderColor: "#d6a514",
        color: "#111827",
      }

    // Estimate / authorization activity
    case "estimate_sent":
    case "wa_sent":
      return {
        backgroundColor: "#fdba74",
        borderColor: "#e07a28",
        color: "#111827",
      }

    // Strong commitment / urgent active work
    case "contract_sent":
    case "tarp":
      return {
        backgroundColor: "#fca5a5",
        borderColor: "#dc6262",
        color: "#111827",
      }

    // Major commitment / production preparation
    case "pre_production":
      return {
        backgroundColor: "#93c5fd",
        borderColor: "#4f8ed8",
        color: "#111827",
      }

    // Hottest active production state
    case "in_production":
      return {
        backgroundColor: "#f8fafc",
        borderColor: "#93a4ba",
        color: "#111827",
      }

    // Work completed
    case "tarp_complete":
    case "completed":
      return {
        backgroundColor: "#bbf7d0",
        borderColor: "#62b982",
        color: "#111827",
      }

    // Financial completion progression
    case "invoiced":
      return {
        backgroundColor: "#86efac",
        borderColor: "#4eae70",
        color: "#111827",
      }

    case "paid":
      return {
        backgroundColor: "#4ade80",
        borderColor: "#2d9955",
        color: "#111827",
      }

    // Inactive / closed without active work
    case "disqualified":
    case "dnc":
    case "archived":
      return {
        backgroundColor: "#cbd5e1",
        borderColor: "#94a3b8",
        color: "#111827",
      }

    // Neutral fallback for non-stage / unknown presentation.
    default:
      return {
        backgroundColor: "#e2e8f0",
        borderColor: "#a8b5c7",
        color: "#111827",
      }
  }
}
