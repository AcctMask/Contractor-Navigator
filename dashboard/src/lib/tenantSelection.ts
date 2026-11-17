/** UI-only check. Server authorization is always authoritative.
 * The Owner selector must never switch to a workspace absent from the
 * authenticated directory response.
 */
export type AuthorizedTenantOption = {slug: string}

export function maySelectOwnerWorkspace(
  role: unknown,
  requestedSlug: unknown,
  directory: AuthorizedTenantOption[] | null | undefined,
): boolean {
  if(role !== "platform_owner" || typeof requestedSlug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug) ||
      !Array.isArray(directory)) return false
  return directory.some(entry => entry?.slug === requestedSlug)
}
