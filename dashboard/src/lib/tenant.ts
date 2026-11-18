const TENANT_SLUG_KEY =
  "contractor_navigator_tenant_slug"

const DEFAULT_TENANT_SLUG =
  "g2g-roofing"

export type TenantWorkspace = {
  slug: string
  name: string
  branding?: {
    business_display_name?: string | null
    dba_name?: string | null
    primary_color?: string | null
    accent_color?: string | null
    website?: string | null
    email?: string | null
    phone?: string | null
  }
  workflow_defaults?: Record<string, unknown>
}

export function normalizeTenantSlug(
  value: unknown,
) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return normalized || DEFAULT_TENANT_SLUG
}

export function getTenantSlug() {
  if (typeof window === "undefined") {
    return DEFAULT_TENANT_SLUG
  }

  return normalizeTenantSlug(
    window.localStorage.getItem(
      TENANT_SLUG_KEY,
    ) || DEFAULT_TENANT_SLUG,
  )
}

export function setTenantSlug(
  tenantSlug: string,
) {
  const normalized =
    normalizeTenantSlug(tenantSlug)

  window.localStorage.setItem(
    TENANT_SLUG_KEY,
    normalized,
  )

  window.dispatchEvent(
    new CustomEvent(
      "contractor-navigator-tenant-change",
      {
        detail: {
          tenantSlug: normalized,
        },
      },
    ),
  )

  return normalized
}

export function clearTenantSlug() {
  window.localStorage.removeItem(
    TENANT_SLUG_KEY,
  )

  window.dispatchEvent(
    new CustomEvent(
      "contractor-navigator-tenant-change",
      {
        detail: {
          tenantSlug:
            DEFAULT_TENANT_SLUG,
        },
      },
    ),
  )
}

export function tenantDisplayName(
  tenantSlug = getTenantSlug(),
) {
  if (
    tenantSlug ===
    "actual-assistant-llc"
  ) {
    return "Actual Assistant"
  }

  if (tenantSlug === "g2g-roofing") {
    return "Good2Go Roofing"
  }

  return tenantSlug
    .split("-")
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1),
    )
    .join(" ")
}

export function tenantLoginPath(
  tenantSlug = getTenantSlug(),
) {
  return `/auth/${encodeURIComponent(
    normalizeTenantSlug(tenantSlug),
  )}/login`
}
