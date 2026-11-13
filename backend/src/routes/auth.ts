import type { FastifyInstance } from "fastify"
import { createHmac, randomUUID } from "node:crypto"
import { pool } from "../db/db"
import { createPashLocLoginChallenge } from "../services/pashlocChallenge"
import { createPashLocPairing } from "../services/pashlocPairing"
import { stageRestrictedBrowserSession, authorizeRestrictedBrowserRequest } from "../services/pashlocRestrictedSessionStoreV1"
import { restrictedCookie, clearRestrictedCookie } from "../services/pashlocRestrictedBrowserV1"
import { approvePashLocDeviceClaim } from "../services/pashlocDeviceApprovalV2"
import { confirmPashLocFirstCode } from "../services/pashlocConfirmEnrollment"
import { verifyPashLocRestrictedCredentials } from "../services/pashlocRestrictedCredentialsV1"
import {
  acceptInvitation,
  getCurrentUserFromToken,
  updateOwnPreferredLanguage,
  getInvitationByToken,
  inviteUserByTenantSlug,
  listInvitationsByTenantSlug,
  listUsersByTenantSlug,
  loginUserByTenantSlug,
  completePashLocNavigatorLogin,
  changePasswordForUser,
  getTenantIdBySlug,
  updateManagedUserRoleByTenantSlug,
  updateManagedUserSubcontractorCompanyByTenantSlug,
  updateManagedUserFinancialsAuthorizationByTenantSlug,
  updateManagedUserMobilePhoneByTenantSlug,
  updateManagedUserFullNameByTenantSlug,
  updateManagedUserPreferredLanguageByTenantSlug,
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
  app.post("/auth/storm-launch", async (request: any, reply) => {
    try {
      const token = getBearerToken(request)
      if (!token) {
        return reply.code(401).send({ ok: false, error: "Login required" })
      }

      const user = await getCurrentUserFromToken(token)
      if (!user?.is_active) {
        return reply.code(401).send({ ok: false, error: "Inactive session" })
      }

      const secret = process.env.STORM_NAVIGATOR_SECRET
      if (!secret) {
        return reply.code(503).send({
          ok: false,
          error: "Storm integration is not configured"
        })
      }

      const requestedJobId = (request.body as any)?.job_id
      let stormJob: any = null

      if (requestedJobId !== undefined && requestedJobId !== null) {
        const jobId = Number(requestedJobId)
        if (!Number.isSafeInteger(jobId) || jobId <= 0) {
          return reply.code(400).send({
            ok: false, error: "Invalid job ID"
          })
        }

        if (!["platform_owner", "tenant_admin", "admin", "manager"]
            .includes(String(user.role))) {
          return reply.code(403).send({
            ok: false, error: "Staff access required"
          })
        }

        const found = await pool.query(
          `select j.id, j.address1, j.city, j.state, j.zip,
                  c.full_name as customer_name,
                  c.phone as customer_phone,
                  c.email as customer_email
           from jobs j
           left join customers c
             on c.id = j.customer_id and c.tenant_id = j.tenant_id
           where j.tenant_id = $1 and j.id = $2
           limit 1`,
          [Number(user.tenant_id), jobId]
        )

        if (!found.rowCount) {
          return reply.code(404).send({
            ok: false, error: "Job not found"
          })
        }

        const job = found.rows[0]
        if (!job.address1 || !job.customer_name ||
            !job.customer_phone || !job.customer_email) {
          return reply.code(409).send({
            ok: false,
            error: "Job requires customer name, phone, email and address"
          })
        }

        stormJob = {
          id: Number(job.id),
          name: String(job.customer_name),
          phone: String(job.customer_phone),
          email: String(job.customer_email),
          address: [job.address1, job.city, job.state, job.zip]
            .filter(Boolean).join(", ")
        }
      }

      const payload = Buffer.from(JSON.stringify({
        aud: "storm-professional",
        sub: String(user.id),
        tenant_id: String(user.tenant_id),
        jti: randomUUID(),
        iat: Math.floor(Date.now() / 1000),
        ...(stormJob ? { storm_job: stormJob } : {})
      })).toString("base64url")

      const signature = createHmac("sha256", secret)
        .update(payload)
        .digest("base64url")

      return {
        ok: true,
        launch_token: `${payload}.${signature}`
      }
    } catch {
      return reply.code(401).send({
        ok: false,
        error: "Navigator authorization failed"
      })
    }
  })

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
        mobile_phone,
        role,
        subcontractor_company_name,
      } = request.body || {}

      const invite =
        await inviteUserByTenantSlug(
          tenantSlug,
          {
            email,
            full_name,
            mobile_phone,
            role,
            subcontractor_company_name,
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


  // First-time enrollment uses password verification without a Navigator JWT.
  // The restricted session is separate from all CRM bearer-token authorities.
  app.post("/auth/mfa/enrollment/start",async(request:any,reply)=>{
    if (process.env.PASHLOC_NAVIGATOR_ENROLLMENT_ENABLED !== "yes" ||
        process.env.PASHLOC_SHARED_RATE_LIMITS_VERIFIED !== "yes")
      return reply.code(503).send({ok:false,error:"enrollment_unavailable"})
    reply.header("Cache-Control","no-store, private")
    reply.header("Referrer-Policy","no-referrer")
    const origin=process.env.APP_BASE_URL || "https://contractor-navigator.vercel.app"
    if(request.headers.origin!==origin ||
       request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase()!=="application/json")
      return reply.code(403).send({ok:false,error:"forbidden"})
    const b=request.body||{}
    if(typeof b.tenant_slug!=="string"||typeof b.email!=="string"||typeof b.password!=="string")
      return reply.code(400).send({ok:false,error:"invalid_request"})
    const account=await verifyPashLocRestrictedCredentials({tenantSlug:b.tenant_slug,email:b.email,password:b.password})
    if(!account)return reply.code(401).send({ok:false,error:"invalid_credentials"})
    const policy=await pool.query(`select pashloc_mfa_required from app_users
      where id=$1 and tenant_id=$2 and is_active=true`,[account.userId,account.tenantId])
    if(policy.rowCount!==1||policy.rows[0].pashloc_mfa_required!==true)
      return reply.code(403).send({ok:false,error:"mfa_not_enabled"})
    const enrolled=await pool.query(`select id from pashloc_mfa_enrollments
      where app_user_id=$1 and tenant_id=$2 and status='confirmed' limit 1`,[account.userId,account.tenantId])
    if(enrolled.rowCount)return reply.code(409).send({ok:false,error:"already_enrolled"})
    const challenge=await createPashLocLoginChallenge({tenantId:account.tenantId,userId:account.userId,purpose:"enroll"})
    const pairing=await createPashLocPairing({challengeId:challenge.challengeId,tenantId:account.tenantId,userId:account.userId})
    const restricted=await stageRestrictedBrowserSession({tenantId:account.tenantId,userId:account.userId,challengeId:challenge.challengeId,purpose:"enroll"})
    reply.header("Set-Cookie",restrictedCookie(restricted.sessionId))
    return {ok:true,challenge_id:challenge.challengeId,pairing_ref:pairing.pairingId,
      csrf_token:restricted.csrfToken,restricted_session:restricted.sessionId,expires_at:pairing.expiresAt}
  })

  app.post("/auth/mfa/enrollment/approve-device",async(request:any,reply)=>{
    if (process.env.PASHLOC_NAVIGATOR_ENROLLMENT_ENABLED !== "yes" ||
        process.env.PASHLOC_SHARED_RATE_LIMITS_VERIFIED !== "yes")
      return reply.code(503).send({ok:false,error:"enrollment_unavailable"})
    reply.header("Cache-Control","no-store, private")
    const b=request.body||{}
    if(typeof b.challenge_id!=="string"||typeof b.pairing_ref!=="string"||typeof b.confirmation_code!=="string")
      return reply.code(400).send({ok:false})
    const session=await authorizeRestrictedBrowserRequest({
      cookieHeader:request.headers["x-pashloc-restricted-session"] || request.headers.cookie,csrfHeader:request.headers["x-pashloc-csrf"],
      origin:request.headers.origin,expectedOrigin:process.env.APP_BASE_URL||"https://contractor-navigator.vercel.app",
      secFetchSite:request.headers["sec-fetch-site"],contentType:request.headers["content-type"],
      challengeId:b.challenge_id,purpose:"enroll"
    })
    if(!session)return reply.code(403).send({ok:false})
    const result=await approvePashLocDeviceClaim({challengeId:session.challengeId,
      pairingRef:b.pairing_ref,confirmationCode:b.confirmation_code,
      tenantId:session.tenantId,userId:session.userId})
    return result.approved?{ok:true,approved:true}:reply.code(409).send({ok:false})
  })

  app.post("/auth/mfa/enrollment/confirm",async(request:any,reply)=>{
    if (process.env.PASHLOC_NAVIGATOR_ENROLLMENT_ENABLED !== "yes" ||
        process.env.PASHLOC_SHARED_RATE_LIMITS_VERIFIED !== "yes")
      return reply.code(503).send({ok:false,error:"enrollment_unavailable"})
    reply.header("Cache-Control","no-store, private")
    const b=request.body||{}
    if(typeof b.challenge_id!=="string"||typeof b.pairing_ref!=="string"||typeof b.code!=="string")
      return reply.code(400).send({ok:false})
    const session=await authorizeRestrictedBrowserRequest({
      cookieHeader:request.headers["x-pashloc-restricted-session"] || request.headers.cookie,csrfHeader:request.headers["x-pashloc-csrf"],
      origin:request.headers.origin,expectedOrigin:process.env.APP_BASE_URL||"https://contractor-navigator.vercel.app",
      secFetchSite:request.headers["sec-fetch-site"],contentType:request.headers["content-type"],
      challengeId:b.challenge_id,purpose:"enroll"
    })
    if(!session)return reply.code(403).send({ok:false})
    // The imported first-code verifier explicitly requires a synthetic
    // disposable envelope. Never present it as production enrollment.
    if (process.env.PASHLOC_PRODUCTION_CREDENTIAL_DELIVERY_VERIFIED !== "yes")
      return reply.code(503).send({ok:false,error:"secure_credential_delivery_unavailable"})
    const confirmed=await confirmPashLocFirstCode({challengeId:session.challengeId,
      pairingId:b.pairing_ref,tenantId:session.tenantId,userId:session.userId,code:b.code})
    if(!confirmed)return reply.code(401).send({ok:false,error:"invalid_or_expired_code"})
    reply.header("Set-Cookie",clearRestrictedCookie())
    return {ok:true,enrollment_confirmed:true}
  })

  // A successful, one-time PashLoc TOTP verification is the only path
  // from a restricted challenge to a normal Navigator bearer token.
  app.post("/auth/mfa/login/verify", async (request: any, reply) => {
    reply.header("Cache-Control","no-store, private")
    const origin = String(request.headers.origin || "")
    const allowedOrigin = process.env.APP_BASE_URL || "https://contractor-navigator.vercel.app"
    if (origin !== allowedOrigin ||
        request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      return reply.code(403).send({ok:false,error:"forbidden"})
    }
    try {
      const {challenge_id,code} = request.body || {}
      const result = await completePashLocNavigatorLogin(challenge_id,code)
      return {ok:true,...result}
    } catch {
      return reply.code(401).send({ok:false,error:"invalid_or_expired_code"})
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

  app.patch("/auth/me/language", async (request: any, reply) => {
    try {
      const token = getBearerToken(request)

      if (!token) {
        reply.code(401)
        return { ok: false, error: "Missing token" }
      }

      const user = await updateOwnPreferredLanguage(
        token,
        request.body?.preferred_language
      )

      return { ok: true, user }
    } catch (err: any) {
      reply.code(400)
      return {
        ok: false,
        error: err?.message || String(err),
      }
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
    "/auth/:tenantSlug/users/:userId/language",
    async (request: any, reply) => {
      try {
        const { tenantSlug, userId } = request.params

        const access = await requireTenantUserManager(
          request,
          reply,
          tenantSlug
        )

        if (!access) {
          return { ok: false, error: "Not authorized" }
        }

        const id = Number(userId)

        if (!Number.isSafeInteger(id) || id <= 0) {
          reply.code(400)
          return { ok: false, error: "Invalid user ID" }
        }

        const user =
          await updateManagedUserPreferredLanguageByTenantSlug(
            tenantSlug,
            id,
            request.body?.preferred_language,
            access.actor
          )

        return { ok: true, user }
      } catch (err: any) {
        reply.code(400)
        return {
          ok: false,
          error: err?.message || String(err),
        }
      }
    }
  )

  app.patch(
    "/auth/:tenantSlug/users/:userId/full-name",
    async (request: any, reply) => {
      try {
        const tenantSlug =
          String(
            request.params?.tenantSlug ||
              ""
          ).trim()

        const manager =
          await requireTenantUserManager(
            request,
            reply,
            tenantSlug
          )

        if (!manager) {
          return
        }

        const userId =
          Number(
            request.params?.userId
          )

        if (
          !tenantSlug ||
          !Number.isInteger(userId) ||
          userId <= 0
        ) {
          return reply.code(400).send({
            ok: false,
            error:
              "Valid tenant and user are required",
          })
        }

        const { full_name } =
          request.body || {}

        const user =
          await updateManagedUserFullNameByTenantSlug(
            tenantSlug,
            userId,
            full_name,
            manager.actor
          )

        return {
          ok: true,
          user,
        }
      } catch (error: any) {
        request.log.error(error)

        return reply.code(400).send({
          ok: false,
          error:
            error?.message ||
            "Unable to update user name",
        })
      }
    }
  )


  app.patch(
    "/auth/:tenantSlug/users/:userId/mobile-phone",
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
          await updateManagedUserMobilePhoneByTenantSlug(
            tenantSlug,
            id,
            request.body?.mobile_phone,
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

  app.patch(
    "/auth/:tenantSlug/users/:userId/subcontractor-company",
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

        if (!Number.isFinite(id)) {
          reply.code(400)

          return {
            ok: false,
            error: "Invalid user ID",
          }
        }

        const {
          company_name,
        } = request.body || {}

        const user =
          await updateManagedUserSubcontractorCompanyByTenantSlug(
            tenantSlug,
            id,
            company_name,
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
