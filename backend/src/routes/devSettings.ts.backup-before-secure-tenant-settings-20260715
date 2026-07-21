import type { FastifyInstance } from "fastify"
import {
  getDeveloperSettingsByTenantSlug,
  saveDeveloperSettingsByTenantSlug,
} from "../services/devSettingsService"

export async function registerDevSettingsRoutes(app: FastifyInstance) {
  app.get("/admin/dev-settings/:tenantSlug", async (request: any) => {
    const { tenantSlug } = request.params
    const settings = await getDeveloperSettingsByTenantSlug(tenantSlug)

    return {
      ok: true,
      tenant_slug: tenantSlug,
      settings,
    }
  })

  app.post("/admin/dev-settings/:tenantSlug", async (request: any) => {
    const { tenantSlug } = request.params
    const settings = await saveDeveloperSettingsByTenantSlug(tenantSlug, request.body || {})

    return {
      ok: true,
      tenant_slug: tenantSlug,
      settings,
    }
  })
}
