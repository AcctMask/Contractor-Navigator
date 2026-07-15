import type { FastifyInstance } from "fastify"
import {
  getDeveloperSettingsByTenantSlug,
  saveDeveloperSettingsByTenantSlug,
} from "../services/devSettingsService"
import {
  getCurrentUserFromToken,
} from "../services/authService"
import { pool } from "../db/db"

function getBearerToken(request: any) {
  const authorization = String(
    request.headers.authorization || "",
  )

  return authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : ""
}

async function authorizeTenantSettingsAccess(
  request: any,
  reply: any,
  tenantSlug: string,
) {
  const token = getBearerToken(request)

  if (!token) {
    reply.code(401).send({
      ok: false,
      error: "Authentication required.",
    })

    return null
  }

  const currentUser =
    await getCurrentUserFromToken(token)

  if (!currentUser?.is_active) {
    reply.code(401).send({
      ok: false,
      error: "User account is inactive.",
    })

    return null
  }

  const tenantResult = await pool.query(
    `
      select
        id,
        slug,
        name
      from tenants
      where lower(slug) = lower($1)
      limit 1
    `,
    [tenantSlug],
  )

  const tenant = tenantResult.rows[0]

  if (!tenant) {
    reply.code(404).send({
      ok: false,
      error: "Tenant was not found.",
    })

    return null
  }

  const isPlatformOwner =
    String(currentUser.role) ===
    "platform_owner"

  const sameTenant =
    Number(currentUser.tenant_id) ===
    Number(tenant.id)

  if (!isPlatformOwner && !sameTenant) {
    reply.code(403).send({
      ok: false,
      error:
        "You are not authorized to manage settings for this tenant.",
    })

    return null
  }

  const allowedRoles = new Set([
    "platform_owner",
    "tenant_admin",
    "admin",
    "manager",
  ])

  if (
    !allowedRoles.has(
      String(currentUser.role),
    )
  ) {
    reply.code(403).send({
      ok: false,
      error:
        "Administrative settings authorization required.",
    })

    return null
  }

  return {
    currentUser,
    tenant: {
      id: Number(tenant.id),
      slug: String(tenant.slug),
      name: String(tenant.name),
    },
  }
}

export async function registerDevSettingsRoutes(
  app: FastifyInstance,
) {
  app.get(
    "/admin/dev-settings/:tenantSlug",
    async (request: any, reply) => {
      const tenantSlug = String(
        request.params?.tenantSlug || "",
      ).trim()

      if (!tenantSlug) {
        return reply.code(400).send({
          ok: false,
          error: "tenantSlug is required.",
        })
      }

      try {
        const authorization =
          await authorizeTenantSettingsAccess(
            request,
            reply,
            tenantSlug,
          )

        if (!authorization) {
          return
        }

        const settings =
          await getDeveloperSettingsByTenantSlug(
            authorization.tenant.slug,
          )

        return reply.send({
          ok: true,
          tenant: authorization.tenant,
          settings,
        })
      } catch (error: any) {
        request.log.error(error)

        return reply.code(500).send({
          ok: false,
          error:
            "AI follow-up settings could not be loaded.",
          details:
            error?.message || String(error),
        })
      }
    },
  )

  app.post(
    "/admin/dev-settings/:tenantSlug",
    async (request: any, reply) => {
      const tenantSlug = String(
        request.params?.tenantSlug || "",
      ).trim()

      if (!tenantSlug) {
        return reply.code(400).send({
          ok: false,
          error: "tenantSlug is required.",
        })
      }

      try {
        const authorization =
          await authorizeTenantSettingsAccess(
            request,
            reply,
            tenantSlug,
          )

        if (!authorization) {
          return
        }

        const settings =
          await saveDeveloperSettingsByTenantSlug(
            authorization.tenant.slug,
            request.body || {},
          )

        return reply.send({
          ok: true,
          tenant: authorization.tenant,
          settings,
          updated_by: {
            id:
              authorization.currentUser.id,
            email:
              authorization.currentUser.email,
            role:
              authorization.currentUser.role,
          },
        })
      } catch (error: any) {
        request.log.error(error)

        return reply.code(500).send({
          ok: false,
          error:
            "AI follow-up settings could not be saved.",
          details:
            error?.message || String(error),
        })
      }
    },
  )
}
