import type { FastifyInstance } from "fastify"
import {
  getCurrentUserFromToken,
  getTenantIdBySlug,
} from "../services/authService"
import {
  processBusinessDevelopmentIntake,
  type BusinessDevelopmentSource,
} from "../services/businessDevelopmentIntakeService"

function clean(value: unknown): string | null {
  if (value === undefined || value === null) return null

  const result = String(value).trim()
  return result.length ? result : null
}

function getBearerToken(request: any): string {
  const authorization = String(
    request.headers.authorization || ""
  )

  return authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : ""
}

async function authorizeBusinessDevelopmentIntake(
  request: any,
  reply: any,
  tenantSlug: string
) {
  const bearerToken = getBearerToken(request)

  if (bearerToken) {
    try {
      const user =
        await getCurrentUserFromToken(bearerToken)

      if (!user?.is_active) {
        return reply.code(401).send({
          ok: false,
          error: "Authentication required",
        })
      }

      const allowedRoles = [
        "platform_owner",
        "tenant_admin",
        "admin",
        "manager",
      ]

      if (!allowedRoles.includes(String(user.role))) {
        return reply.code(403).send({
          ok: false,
          error: "Business development access denied",
        })
      }

      if (String(user.role) !== "platform_owner") {
        const requestedTenantId =
          await getTenantIdBySlug(tenantSlug)

        if (
          Number(user.tenant_id) !==
          Number(requestedTenantId)
        ) {
          return reply.code(403).send({
            ok: false,
            error: "Tenant access denied",
          })
        }
      }

      return {
        authorization_type: "user",
        user,
      }
    } catch {
      return reply.code(401).send({
        ok: false,
        error: "Authentication required",
      })
    }
  }

  const providedGatewaySecret =
    clean(request.headers["x-aa-activity-secret"]) ||
    clean(request.headers["x-aa-gateway-secret"])

  const configuredGatewaySecret =
    clean(process.env.AA_ACTIVITY_GATEWAY_SECRET)

  if (
    providedGatewaySecret &&
    configuredGatewaySecret &&
    providedGatewaySecret === configuredGatewaySecret
  ) {
    return {
      authorization_type: "system",
      user: null,
    }
  }

  return reply.code(401).send({
    ok: false,
    error: "Authentication required",
  })
}

export async function registerBusinessDevelopmentIntakeRoutes(
  app: FastifyInstance
) {
  app.post(
    "/business-development/:tenantSlug/intake",
    async (request: any, reply) => {
      try {
        const tenantSlug = String(
          request.params?.tenantSlug || ""
        ).trim()

        if (!tenantSlug) {
          return reply.code(400).send({
            ok: false,
            error: "tenantSlug required",
          })
        }

        const authorization =
          await authorizeBusinessDevelopmentIntake(
            request,
            reply,
            tenantSlug
          )

        if (!authorization) {
          return
        }

        const body: any = request.body || {}

        const source = String(
          body.source || "manual_office_entry"
        ).trim() as BusinessDevelopmentSource

        const result =
          await processBusinessDevelopmentIntake({
            tenantSlug,
            source,
            sourceDetail: clean(
              body.source_detail ??
                body.sourceDetail
            ),
            customerName: clean(
              body.customer_name ??
                body.customerName ??
                body.name
            ),
            customerPhone: clean(
              body.customer_phone ??
                body.customerPhone ??
                body.phone
            ),
            customerEmail: clean(
              body.customer_email ??
                body.customerEmail ??
                body.email
            ),
            address1: clean(
              body.address1 ?? body.address
            ),
            city: clean(body.city),
            state: clean(body.state),
            zip: clean(body.zip),
            notes: clean(body.notes),
            externalReference: clean(
              body.external_reference ??
                body.externalReference ??
                body.message_id
            ),
          })

        return reply.send(result)
      } catch (error: any) {
        request.log.error(error)

        return reply.code(500).send({
          ok: false,
          error:
            error?.message ||
            "Business Development Intake failed",
        })
      }
    }
  )
}
