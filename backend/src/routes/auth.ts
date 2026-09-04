import type { FastifyInstance } from "fastify"
import {
  acceptInvitation,
  getCurrentUserFromToken,
  getInvitationByToken,
  inviteUserByTenantSlug,
  listInvitationsByTenantSlug,
  listUsersByTenantSlug,
  loginUserByTenantSlug,
  changePasswordForUser,
  getTenantIdBySlug,
  updateManagedUserRoleByTenantSlug,
  updateManagedUserFinancialsAuthorizationByTenantSlug,
  resetManagedUserPasswordByTenantSlug,
  deactivateManagedUserByTenantSlug,
  recordUserInvitationEmailSent,
  markTenantSendNotified,
  getAppUserById,
  markInviteeAcceptanceNotified,
  markTenantAcceptanceNotified,
} from "../services/authService"

import {
  sendActualAssistantNavigatorEmail,
} from "../services/emailService"

import {
  getTenantConversationProfileBySlug,
} from "../services/companyDnaRuntimeService"

const APP_BASE_URL =
  process.env.APP_BASE_URL || "https://contractor-navigator.vercel.app"

function getBearerToken(request: any) {
  const auth = request.headers.authorization || ""
  return auth.startsWith("Bearer ") ? auth.slice(7) : ""
}

async function requireRole(request: any, reply: any, allowedRoles: string[]) {
  const token = getBearerToken(request)

  if (!token) {
    reply.code(401)
    return null
  }

  const user = await getCurrentUserFromToken(token)

  if (!user?.is_active) {
    reply.code(401)
    return null
  }

  if (!allowedRoles.includes(user.role)) {
    reply.code(403)
    return null
  }

  return user
}

const USER_MANAGEMENT_ROLES = [
  "platform_owner",
  "tenant_admin",
  "admin",
  "manager",
]

async function requireTenantUserManager(
  request: any,
  reply: any,
  tenantSlug: string
) {
  const actor =
    await requireRole(
      request,
      reply,
      USER_MANAGEMENT_ROLES
    )

  if (!actor) {
    return null
  }

  const tenantId =
    await getTenantIdBySlug(
      tenantSlug
    )

  if (
    String(actor.role) !==
      "platform_owner" &&
    Number(actor.tenant_id) !==
      tenantId
  ) {
    reply.code(403)

    return null
  }

  return {
    actor,
    tenantId,
  }
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/:tenantSlug/invite", async (request: any, reply) => {
    try {
      const { tenantSlug } =
        request.params

      const access =
        await requireTenantUserManager(
          request,
          reply,
          tenantSlug
        )

      if (!access) {
        return {
          ok: false,
          error: "Not authorized",
        }
      }

      const {
        actor,
        tenantId,
      } = access

      const {
        email,
        full_name,
        role,
      } = request.body || {}

      const invite =
        await inviteUserByTenantSlug(
          tenantSlug,
          {
            email,
            full_name,
            role,
            invited_by_user_id:
              Number(actor.id),
          }
        )

      const inviteUrl =
        `${APP_BASE_URL}/accept-invite/${invite.invite_token}`

      const profile =
        await getTenantConversationProfileBySlug(
          tenantSlug
        )

      const tenantName =
        profile.identity.display_name ||
        profile.identity.business_name ||
        tenantSlug

      const inviteEmailResult =
        await sendActualAssistantNavigatorEmail({
          to: invite.email,
          subject:
            `You're invited to ${tenantName} Navigator`,
          heading:
            `You're invited to ${tenantName} Navigator`,
          lines: [
            `On behalf of ${tenantName}, you have been invited to become a user of their Navigator platform from Actual Assistant.`,
            `Name: ${invite.full_name}`,
            `Role: ${invite.role}`,
            `User ID: ${invite.email}`,
            "Your invitation is valid for 30 days.",
            "Complete your invitation by creating your Navigator password.",
          ],
          buttonLabel:
            "Accept Invitation",
          buttonUrl:
            inviteUrl,
        })

      let tenantNotificationResult:
        any = null

      if (inviteEmailResult.ok) {
        await recordUserInvitationEmailSent(
          Number(invite.id),
          tenantId
        )

        tenantNotificationResult =
          await sendActualAssistantNavigatorEmail({
            to: actor.email,
            subject:
              `${invite.full_name} invited to ${tenantName} Navigator`,
            heading:
              "Navigator invitation sent",
            lines: [
              `${invite.full_name} (${invite.email}) has been invited to join the ${tenantName} Navigator as ${invite.role}.`,
              "The invitation is valid for 30 days.",
              "You will be notified when the invitation is accepted or if it expires.",
            ],
          })

        if (
          tenantNotificationResult.ok
        ) {
          await markTenantSendNotified(
            Number(invite.id),
            tenantId
          )
        }
      }

      return {
        ok: true,
        invite,
        invite_url:
          inviteUrl,
        email_sent:
          Boolean(
            inviteEmailResult.ok
          ),
        email_error:
          inviteEmailResult.ok
            ? null
            : inviteEmailResult.error ||
              "Invitation email was not sent.",
        tenant_notification_sent:
          Boolean(
            tenantNotificationResult?.ok
          ),
        tenant_notification_error:
          tenantNotificationResult &&
          !tenantNotificationResult.ok
            ? tenantNotificationResult.error ||
              "Tenant confirmation was not sent."
            : null,
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

      const accepted =
        await acceptInvitation(
          inviteToken,
          { password }
        )

      const profile =
        await getTenantConversationProfileBySlug(
          accepted.tenant_slug
        )

      const tenantName =
        profile.identity.display_name ||
        profile.identity.business_name ||
        accepted.tenant_slug

      const invitation =
        accepted.invitation

      const inviteeNotice =
        await sendActualAssistantNavigatorEmail({
          to: accepted.user.email,
          subject:
            `Your ${tenantName} Navigator account is ready`,
          heading:
            "Congratulations — your Navigator account is ready",
          lines: [
            `Your Navigator account for ${tenantName} has been created successfully.`,
            `Your User ID is ${accepted.user.email}.`,
            "You can now use Navigator.",
          ],
        })

      if (inviteeNotice.ok) {
        await markInviteeAcceptanceNotified(
          Number(invitation.id),
          Number(invitation.tenant_id)
        )
      }

      let tenantNotice:
        any = null

      const inviter =
        await getAppUserById(
          invitation.invited_by_user_id
        )

      if (inviter?.email) {
        tenantNotice =
          await sendActualAssistantNavigatorEmail({
            to: inviter.email,
            subject:
              `${invitation.full_name} accepted the ${tenantName} Navigator invitation`,
            heading:
              "Navigator invitation accepted",
            lines: [
              `${invitation.full_name} (${invitation.email}) has accepted the invitation to join ${tenantName} Navigator as ${invitation.role}.`,
            ],
          })

        if (tenantNotice.ok) {
          await markTenantAcceptanceNotified(
            Number(invitation.id),
            Number(invitation.tenant_id)
          )
        }
      }

      return {
        ok: true,
        ...accepted,
        notifications: {
          invitee:
            Boolean(
              inviteeNotice.ok
            ),
          tenant:
            Boolean(
              tenantNotice?.ok
            ),
        },
      }
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


  app.post("/auth/change-password", async (request: any, reply) => {
    try {
      const token = getBearerToken(request)

      if (!token) {
        reply.code(401)
        return { ok: false, error: "Unauthorized" }
      }

      const { currentPassword, newPassword } = request.body || {}

      const result = await changePasswordForUser(token, {
        currentPassword,
        newPassword,
      })

      return { ok: true, ...result }
    } catch (err: any) {
      reply.code(400)
      return {
        ok: false,
        error: err?.message || String(err),
      }
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
      const { tenantSlug } =
        request.params

      const access =
        await requireTenantUserManager(
          request,
          reply,
          tenantSlug
        )

      if (!access) {
        return {
          ok: false,
          error: "Not authorized",
        }
      }

      const users =
        await listUsersByTenantSlug(
          tenantSlug
        )

      return {
        ok: true,
        users,
      }
    } catch (err: any) {
      reply.code(400)
      return {
        ok: false,
        error:
          err?.message ||
          String(err),
      }
    }
  })

  app.patch(
    "/auth/:tenantSlug/users/:userId/financials-authorized",
    async (request: any, reply) => {
      try {
        const {
          tenantSlug,
          userId,
        } = request.params

        const access =
          await requireTenantUserManager(
            request,
            reply,
            tenantSlug
          )

        if (!access) {
          return {
            ok: false,
            error: "Not authorized",
          }
        }

        const user =
          await updateManagedUserFinancialsAuthorizationByTenantSlug(
            tenantSlug,
            Number(userId),
            request.body?.financials_authorized,
            access.actor
          )

        return {
          ok: true,
          user,
        }
      } catch (err: any) {
        reply.code(400)

        return {
          ok: false,
          error:
            err?.message ||
            String(err),
        }
      }
    }
  )

  app.patch(
    "/auth/:tenantSlug/users/:userId/role",
    async (request: any, reply) => {
      try {
        const {
          tenantSlug,
          userId,
        } = request.params

        const access =
          await requireTenantUserManager(
            request,
            reply,
            tenantSlug
          )

        if (!access) {
          return {
            ok: false,
            error: "Not authorized",
          }
        }

        const id =
          Number(userId)

        if (
          !Number.isFinite(id)
        ) {
          reply.code(400)

          return {
            ok: false,
            error: "Invalid user ID",
          }
        }

        const { role } =
          request.body || {}

        const user =
          await updateManagedUserRoleByTenantSlug(
            tenantSlug,
            id,
            role,
            access.actor
          )

        return {
          ok: true,
          user,
        }
      } catch (err: any) {
        reply.code(400)

        return {
          ok: false,
          error:
            err?.message ||
            String(err),
        }
      }
    }
  )

  app.post(
    "/auth/:tenantSlug/users/:userId/reset-password",
    async (request: any, reply) => {
      try {
        const {
          tenantSlug,
          userId,
        } = request.params

        const access =
          await requireTenantUserManager(
            request,
            reply,
            tenantSlug
          )

        if (!access) {
          return {
            ok: false,
            error: "Not authorized",
          }
        }

        const id =
          Number(userId)

        if (
          !Number.isFinite(id)
        ) {
          reply.code(400)

          return {
            ok: false,
            error: "Invalid user ID",
          }
        }

        const {
          newPassword,
        } =
          request.body || {}

        const user =
          await resetManagedUserPasswordByTenantSlug(
            tenantSlug,
            id,
            newPassword,
            access.actor
          )

        return {
          ok: true,
          user,
        }
      } catch (err: any) {
        reply.code(400)

        return {
          ok: false,
          error:
            err?.message ||
            String(err),
        }
      }
    }
  )

  app.post(
    "/auth/:tenantSlug/users/:userId/deactivate",
    async (request: any, reply) => {
      try {
        const {
          tenantSlug,
          userId,
        } = request.params

        const access =
          await requireTenantUserManager(
            request,
            reply,
            tenantSlug
          )

        if (!access) {
          return {
            ok: false,
            error: "Not authorized",
          }
        }

        const id =
          Number(userId)

        if (
          !Number.isFinite(id)
        ) {
          reply.code(400)

          return {
            ok: false,
            error: "Invalid user ID",
          }
        }

        const user =
          await deactivateManagedUserByTenantSlug(
            tenantSlug,
            id,
            access.actor
          )

        return {
          ok: true,
          user,
        }
      } catch (err: any) {
        reply.code(400)

        return {
          ok: false,
          error:
            err?.message ||
            String(err),
        }
      }
    }
  )

  app.get("/auth/:tenantSlug/invitations", async (request: any, reply) => {
    try {
      const { tenantSlug } =
        request.params

      const access =
        await requireTenantUserManager(
          request,
          reply,
          tenantSlug
        )

      if (!access) {
        return {
          ok: false,
          error: "Not authorized",
        }
      }

      const invitations =
        await listInvitationsByTenantSlug(
          tenantSlug
        )

      return {
        ok: true,
        invitations,
      }
    } catch (err: any) {
      reply.code(400)

      return {
        ok: false,
        error:
          err?.message ||
          String(err),
      }
    }
  })
}
