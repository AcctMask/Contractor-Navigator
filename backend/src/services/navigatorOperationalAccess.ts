import type { FastifyReply, FastifyRequest } from "fastify"
import { getCurrentUserFromToken, isSignedOperationalToken } from "./authService"

const officeRoles = new Set(["platform_owner", "tenant_admin", "admin", "manager", "sales", "staff"])

export async function requireNavigatorOffice(request: FastifyRequest, reply: FastifyReply, platform = false) {
  reply.header("Cache-Control", "private, no-store")
  const authorization = request.headers.authorization ?? ""
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
  const actor = token ? await getCurrentUserFromToken(token).catch(() => null) : null
  if (!actor) {
    reply.code(401).send({ ok: false, error: "Navigator session required" })
    return null
  }
  if (platform ? actor.role !== "platform_owner" : !officeRoles.has(actor.role)) {
    reply.code(403).send({ ok: false, error: "Insufficient permissions" })
    return null
  }
  if (platform && !isSignedOperationalToken(token)) {
    reply.code(401).send({ ok: false, error: "Signed Navigator session required" })
    return null
  }
  return actor
}
