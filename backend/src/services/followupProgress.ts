export const AI_FOLLOWUP_PROGRESS_KIND = "ai_message_sent"

type TimelineProgressEvent = {
  kind: string
  meta?: Record<string, unknown> | null
}

export function isCompletedAiFollowupEvent(
  event: TimelineProgressEvent,
  workflowKey: string
) {
  const kind = String(event.kind || "").toLowerCase()
  const eventWorkflow = String(event.meta?.stage || "")

  return (
    kind === AI_FOLLOWUP_PROGRESS_KIND &&
    eventWorkflow === workflowKey
  )
}

export function countCompletedAiFollowups(
  timeline: TimelineProgressEvent[],
  workflowKey: string
) {
  return timeline.filter((event) =>
    isCompletedAiFollowupEvent(event, workflowKey)
  ).length
}
