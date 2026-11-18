/** Test-only tenant scope. Membership and credential checks are separate. */
export function signedAcceptanceTenants(): string[] {
  if (process.env.PASHLOC_ACCEPTANCE_ONLY !== "yes" ||
      process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME !== "pashloc_iv_disposable_mfa_isolated") return []
  return (process.env.PASHLOC_SIGNED_TEST_TENANTS || "pashloc-genuine-acceptance-20261114,g2g-roofing")
    .split(",").map(slug => slug.trim()).filter(slug => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
}

export function tenantAllowed(slug: unknown): slug is string {
  return typeof slug === "string" && signedAcceptanceTenants().includes(slug)
}
