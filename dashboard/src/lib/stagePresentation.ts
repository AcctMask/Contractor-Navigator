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
        backgroundColor: "#fbd650",
        borderColor: "#bb8410",
        color: "#111827",
      }

    // Estimate / authorization activity
    case "estimate_sent":
    case "wa_sent":
      return {
        backgroundColor: "#fda158",
        borderColor: "#d15e1a",
        color: "#111827",
      }

    // Strong commitment / urgent active work
    case "contract_sent":
    case "tarp":
      return {
        backgroundColor: "#f57575",
        borderColor: "#ba3f3f",
        color: "#111827",
      }

    // Major commitment / production preparation
    case "pre_production":
      return {
        backgroundColor: "#5c94f4",
        borderColor: "#3764b1",
        color: "#111827",
      }

    // Hottest active production state
    case "in_production":
      return {
        backgroundColor: "#fcfdfe",
        borderColor: "#5879c9",
        color: "#111827",
      }

    // Work completed
    case "tarp_complete":
    case "completed":
      return {
        backgroundColor: "#a1f3be",
        borderColor: "#3cae66",
        color: "#111827",
      }

    // Financial completion progression
    case "invoiced":
      return {
        backgroundColor: "#54da85",
        borderColor: "#329758",
        color: "#111827",
      }

    case "paid":
      return {
        backgroundColor: "#30af5f",
        borderColor: "#21663f",
        color: "#111827",
      }

    // Inactive / closed without active work
    case "disqualified":
    case "dnc":
    case "archived":
      return {
        backgroundColor: "#b4bcc8",
        borderColor: "#707c8e",
        color: "#111827",
      }

    // Neutral fallback for non-stage / unknown presentation.
    default:
      return {
        backgroundColor: "#dfe7eb",
        borderColor: "#849db0",
        color: "#111827",
      }
  }
}
