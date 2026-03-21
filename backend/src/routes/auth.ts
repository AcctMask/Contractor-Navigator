import type { FastifyInstance } from "fastify"
import {
  acceptInvitation,
  getCurrentUserFromToken,
  getInvitationByToken,
  inviteUserByTenantSlug,
  listInvitationsByTenantSlug,
  listUsersByTenantSlug,
  loginUserByTenantSlug,
} from "../services/authService"

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/:tenantSlug/invite", async (request: any, reply) => {
    try {
      const { tenantSlug } = request.params
      const { email, full_name, role, invited_by_user_id } = request.body || {}

      const invite = await inviteUserByTenantSlug(tenantSlug, {
        email,
        full_name,
        role,
        invited_by_user_id,
      })

      return {
        ok: true,
        invite,
        invite_url: `http://localhost:5173/accept-invite/${invite.invite_token}`,
      }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.get("/auth/invite/:inviteToken", async (request: any, reply) => {
    try {
      const { inviteToken } = request.params
      const invite = await getInvitationByToken(inviteToken)

      if (!invite) {
        reply.code(404)
        return { ok: false, error: "Invitation not found" }
      }

      return { ok: true, invite }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.post("/auth/accept-invite/:inviteToken", async (request: any, reply) => {
    try {
      const { inviteToken } = request.params
      const { password } = request.body || {}

      const accepted = await acceptInvitation(inviteToken, { password })

      return { ok: true, ...accepted }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.post("/auth/:tenantSlug/login", async (request: any, reply) => {
    try {
      const { tenantSlug } = request.params
      const { email, password } = request.body || {}

      const result = await loginUserByTenantSlug(tenantSlug, { email, password })
      return { ok: true, ...result }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.get("/auth/me", async (request: any, reply) => {
    try {
      const auth = request.headers.authorization || ""
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : ""

      if (!token) {
        reply.code(401)
        return { ok: false, error: "Missing token" }
      }

      const user = await getCurrentUserFromToken(token)
      return { ok: true, user }
    } catch (err: any) {
      reply.code(401)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.get("/auth/:tenantSlug/users", async (request: any, reply) => {
    try {
      const { tenantSlug } = request.params
      const users = await listUsersByTenantSlug(tenantSlug)
      return { ok: true, users }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })

  app.get("/auth/:tenantSlug/invitations", async (request: any, reply) => {
    try {
      const { tenantSlug } = request.params
      const invitations = await listInvitationsByTenantSlug(tenantSlug)
      return { ok: true, invitations }
    } catch (err: any) {
      reply.code(400)
      return { ok: false, error: err?.message || String(err) }
    }
  })
}
