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
        backgroundColor: "#facc15",
        borderColor: "#a16207",
        color: "#111827",
      }

    // Estimate / authorization activity
    case "estimate_sent":
    case "wa_sent":
      return {
        backgroundColor: "#fb923c",
        borderColor: "#c2410c",
        color: "#111827",
      }

    // Strong commitment / urgent active work
    case "contract_sent":
    case "tarp":
      return {
        backgroundColor: "#ef4444",
        borderColor: "#991b1b",
        color: "#ffffff",
      }

    // Major commitment / production preparation
    case "pre_production":
      return {
        backgroundColor: "#2563eb",
        borderColor: "#1e3a8a",
        color: "#ffffff",
      }

    // Hottest active production state
    case "in_production":
      return {
        backgroundColor: "#ffffff",
        borderColor: "#1d4ed8",
        color: "#111827",
      }

    // Work completed
    case "tarp_complete":
    case "completed":
      return {
        backgroundColor: "#86efac",
        borderColor: "#16a34a",
        color: "#14532d",
      }

    // Financial completion progression
    case "invoiced":
      return {
        backgroundColor: "#22c55e",
        borderColor: "#15803d",
        color: "#052e16",
      }

    case "paid":
      return {
        backgroundColor: "#15803d",
        borderColor: "#14532d",
        color: "#ffffff",
      }

    // Inactive / closed without active work
    case "disqualified":
    case "dnc":
    case "archived":
      return {
        backgroundColor: "#9ca3af",
        borderColor: "#4b5563",
        color: "#111827",
      }

    // Neutral fallback for non-stage / unknown presentation.
    default:
      return {
        backgroundColor: "#dbeafe",
        borderColor: "#60a5fa",
        color: "#1e3a8a",
      }
  }
}
