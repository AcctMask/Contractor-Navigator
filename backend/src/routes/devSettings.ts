import type { FastifyInstance } from "fastify"
import {
  timingSafeEqual,
} from "crypto"
import {
  getDeveloperSettingsByTenantSlug,
  saveDeveloperSettingsByTenantSlug,
} from "../services/devSettingsService"
import {
  getCurrentUserFromToken,
} from "../services/authService"
import { pool } from "../db/db"

function safeEqual(
  left: string,
  right: string,
) {
  const leftBuffer =
    Buffer.from(left)

  const rightBuffer =
    Buffer.from(right)

  if (
    leftBuffer.length !==
    rightBuffer.length
  ) {
    return false
  }

  return timingSafeEqual(
    leftBuffer,
    rightBuffer,
  )
}

function requirePlatformMaintenanceSecret(
  request: any,
) {
  const expected = String(
    process.env
      .AA_ACTIVITY_GATEWAY_SECRET ||
      "",
  )

  const provided = String(
    request.headers[
      "x-aa-activity-secret"
    ] || "",
  )

  return (
    expected.length > 0 &&
    provided.length > 0 &&
    safeEqual(expected, provided)
  )
}

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
    "/platform/dev-settings/:tenantSlug",
    async (request: any, reply) => {
      if (
        !requirePlatformMaintenanceSecret(
          request,
        )
      ) {
        return reply.code(401).send({
          ok: false,
          error:
            "Platform maintenance authorization required.",
        })
      }

      const tenantSlug = String(
        request.params?.tenantSlug ||
          "",
      ).trim()

      if (!tenantSlug) {
        return reply.code(400).send({
          ok: false,
          error:
            "tenantSlug is required.",
        })
      }

      try {
        const tenantResult =
          await pool.query(
            `
              select
                id,
                slug,
                name
              from tenants
              where lower(slug) =
                lower($1)
              limit 1
            `,
            [tenantSlug],
          )

        const tenant =
          tenantResult.rows[0]

        if (!tenant) {
          return reply.code(404).send({
            ok: false,
            error:
              "Tenant was not found.",
          })
        }

        const settings =
          await getDeveloperSettingsByTenantSlug(
            tenant.slug,
          )

        return reply.send({
          ok: true,
          tenant: {
            id: Number(tenant.id),
            slug: tenant.slug,
            name: tenant.name,
          },
          settings,
        })
      } catch (error: any) {
        request.log.error(error)

        return reply.code(500).send({
          ok: false,
          error:
            "Platform AI follow-up settings could not be loaded.",
          details:
            error?.message ||
            String(error),
        })
      }
    },
  )

  app.post(
    "/platform/dev-settings/:tenantSlug",
    async (request: any, reply) => {
      if (
        !requirePlatformMaintenanceSecret(
          request,
        )
      ) {
        return reply.code(401).send({
          ok: false,
          error:
            "Platform maintenance authorization required.",
        })
      }

      const tenantSlug = String(
        request.params?.tenantSlug ||
          "",
      ).trim()

      if (!tenantSlug) {
        return reply.code(400).send({
          ok: false,
          error:
            "tenantSlug is required.",
        })
      }

      try {
        const tenantResult =
          await pool.query(
            `
              select
                id,
                slug,
                name
              from tenants
              where lower(slug) =
                lower($1)
              limit 1
            `,
            [tenantSlug],
          )

        const tenant =
          tenantResult.rows[0]

        if (!tenant) {
          return reply.code(404).send({
            ok: false,
            error:
              "Tenant was not found.",
          })
        }

        const settings =
          await saveDeveloperSettingsByTenantSlug(
            tenant.slug,
            request.body || {},
          )

        return reply.send({
          ok: true,
          tenant: {
            id: Number(tenant.id),
            slug: tenant.slug,
            name: tenant.name,
          },
          settings,
          updated_by:
            "platform-maintenance",
        })
      } catch (error: any) {
        request.log.error(error)

        return reply.code(500).send({
          ok: false,
          error:
            "Platform AI follow-up settings could not be saved.",
          details:
            error?.message ||
            String(error),
        })
      }
    },
  )

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
