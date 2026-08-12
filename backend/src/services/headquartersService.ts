const HEADQUARTERS_COMPOSER_URL =
  process.env.HEADQUARTERS_COMPOSER_URL ||
  "https://actual-assistant-owner-controls.vercel.app/api/headquarters/compose"

const HEADQUARTERS_COMPOSER_SECRET =
  process.env.HEADQUARTERS_COMPOSER_SECRET || ""

export type HeadquartersCompositionCandidate = {
  schema_version?: number
  owner?: string
  capability?: string
  tenant_slug?: string
  consumer?: string
  task?: string
  channel?: string
  generated_at?: string
  model?: string
  subject?: string | null
  text: string
  html?: string | null
  learning_record_ids?: string[]
  [key: string]: unknown
}

export async function composeNavigatorCandidate(input: {
  tenantSlug: string
  task: string
  channel: string
  currentContext?: Record<string, unknown>
}): Promise<HeadquartersCompositionCandidate> {
  const tenantSlug = input.tenantSlug?.trim()
  const task = input.task?.trim()
  const channel = input.channel?.trim()

  if (!tenantSlug) {
    throw new Error("Navigator Headquarters composition requires tenantSlug")
  }

  if (!task) {
    throw new Error("Navigator Headquarters composition requires task")
  }

  if (!channel) {
    throw new Error("Navigator Headquarters composition requires channel")
  }

  if (!HEADQUARTERS_COMPOSER_SECRET) {
    throw new Error("HEADQUARTERS_COMPOSER_SECRET is required")
  }

  const response = await fetch(
    HEADQUARTERS_COMPOSER_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-aa-headquarters-composer-secret":
          HEADQUARTERS_COMPOSER_SECRET,
      },
      body: JSON.stringify({
        tenant_slug: tenantSlug,
        consumer: "navigator",
        task,
        channel,
        current_context:
          input.currentContext &&
          typeof input.currentContext === "object"
            ? input.currentContext
            : {},
      }),
    }
  )

  const payload: any =
    await response.json().catch(() => null)

  if (!response.ok) {
    const detail =
      payload &&
      typeof payload.error === "string"
        ? `: ${payload.error}`
        : ""

    throw new Error(
      `Headquarters composer failed: ${response.status}${detail}`
    )
  }

  const candidate =
    payload?.candidate

  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.text !== "string" ||
    candidate.text.trim() === ""
  ) {
    throw new Error(
      "Headquarters composer returned no usable Navigator candidate"
    )
  }

  return candidate as HeadquartersCompositionCandidate
}
