import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"
import { getCurrentUserFromToken } from "../services/authService"
import { canInviteCrewToJob } from "../services/workforceCrewInvitationAuthorization"
import { sendJobCrewSms } from "../services/workforceSmsSend"
import { sendWorkforceInvitationSms } from "../services/workforceInvitationSms"
import { createWorkforceInvitationToken, hashWorkforceInvitationToken } from "../services/workforceInvitationTokens"
import { recordWorkforceActivity } from "../services/workforceActivityNotes"
import {
  validateCrewInvitation,
  normalizeCrewPhone,
  type CrewInvitationInput,
} from "../services/workforceCrewInvitations"

function getToken(request: any): string {
  const auth = String(request.headers.authorization || "")
  return auth.startsWith("Bearer ") ? auth.slice(7) : ""
}

export async function registerWorkforceCrewRoutes(app: FastifyInstance) {
  app.post("/workforce/crew/accept-invite", async (request: any, reply) => {
    const token = String(request.body?.token || "")

    if (!/^[a-f0-9]{64}$/.test(token)) {
      return reply.code(400).send({
        ok: false,
        error: "Invalid invitation",
      })
    }

    try {
      const tokenHash = hashWorkforceInvitationToken(token)

      const client = await pool.connect()
      try {
        await client.query("BEGIN")

        const result = await client.query(
        `
        update workforce_crew_members m
        set invitation_status = 'active',
            accepted_at = now(),
            invitation_token_hash = null,
            invitation_expires_at = null,
            updated_at = now()
        where m.invitation_token_hash = $1
          and m.invitation_expires_at > now()
          and m.invitation_status = 'invited'
          and m.is_active = true
          and exists (
            select 1
            from workforce_crew_job_assignments a
            join jobs j
              on j.id = a.job_id
             and j.tenant_id = a.tenant_id
            where a.crew_member_id = m.id
              and a.tenant_id = m.tenant_id
              and a.subcontractor_company_id =
                  m.subcontractor_company_id
              and a.status = 'active'
          )
        returning m.id, m.tenant_id, m.full_name,
          m.crew_role, m.preferred_language, m.invitation_job_id
        `,
        [tokenHash]
      )

      if (result.rowCount !== 1) {
        await client.query("ROLLBACK")
        return reply.code(400).send({
          ok: false,
          error: "Invitation expired, used, or no longer authorized",
        })
      }

        const member = result.rows[0]

        const assignment = await client.query(
          `select a.id, a.job_id
           from workforce_crew_job_assignments a
           join jobs j
             on j.id = a.job_id
            and j.tenant_id = a.tenant_id
           where a.crew_member_id = $1
             and a.tenant_id = $2
             and a.job_id = $3
             and a.status = 'active'
           order by a.assigned_at desc, a.id desc
           limit 1`,
          [Number(member.id), Number(member.tenant_id),
           Number(member.invitation_job_id)]
        )

        if (assignment.rowCount !== 1) {
          throw new Error("No active job assignment for acceptance")
        }

        await recordWorkforceActivity(client, {
          tenantId: Number(member.tenant_id),
          jobId: Number(assignment.rows[0].job_id),
          actorUserId: null,
          actorName: String(member.full_name),
          subjectName: String(member.full_name),
          subjectRole:
            member.crew_role === "lead" ? "crew_lead" : "crew_member",
          action: "accepted",
          assignmentId: Number(assignment.rows[0].id),
        })

        await client.query("COMMIT")

        return {
          ok: true,
          accepted: true,
          crew_member: member,
        }
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({
        ok: false,
        error: "Invitation acceptance failed",
      })
    }
  })

  app.post("/workforce/crew/:jobId/revoke", async (request: any, reply) => {
    try {
      const actor = await getCurrentUserFromToken(getToken(request))
      if (!actor?.is_active) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" })
      }

      const tenantId = Number(actor.tenant_id)
      const jobId = Number(request.params.jobId)
      const crewMemberId = Number(request.body?.crew_member_id)

      if (![tenantId, jobId, crewMemberId].every(
        n => Number.isSafeInteger(n) && n > 0
      )) {
        return reply.code(400).send({
          ok: false, error: "Invalid job or crew member",
        })
      }

      const management = [
        "platform_owner", "tenant_admin", "admin", "manager",
      ].includes(String(actor.role))

      if (!management && actor.role !== "subcontractor") {
        return reply.code(403).send({ ok: false, error: "Forbidden" })
      }

      const client = await pool.connect()
      try {
        await client.query("BEGIN")

        const result = await client.query(
        `
        update workforce_crew_job_assignments a
        set status = 'revoked', revoked_at = now()
        where a.tenant_id = $1
          and a.job_id = $2
          and a.crew_member_id = $3
          and a.status = 'active'
          and exists (
            select 1 from jobs j
            where j.id = a.job_id
              and j.tenant_id = a.tenant_id
          )
          and (
            $4::boolean
            or (
              $5::text = 'subcontractor'
              and exists (
                select 1
                from subcontractor_company_users scu
                join crew_assignments ca
                  on ca.app_user_id = scu.app_user_id
                 and ca.tenant_id = a.tenant_id
                 and ca.job_id = a.job_id
                 and ca.status in ('PENDING', 'active')
                where scu.app_user_id = $6
                  and scu.subcontractor_company_id =
                    a.subcontractor_company_id
              )
            )
          )
        returning a.id, a.crew_member_id,
          (
            select m.full_name
            from workforce_crew_members m
            where m.id = a.crew_member_id
              and m.tenant_id = a.tenant_id
              and m.subcontractor_company_id =
                  a.subcontractor_company_id
          ) as crew_name,
          (
            select m.crew_role
            from workforce_crew_members m
            where m.id = a.crew_member_id
              and m.tenant_id = a.tenant_id
              and m.subcontractor_company_id =
                  a.subcontractor_company_id
          ) as crew_role
        `,
        [
          tenantId, jobId, crewMemberId,
          management, String(actor.role), Number(actor.id),
        ]
      )

      if (!result.rowCount) {
        return reply.code(403).send({
          ok: false,
          error: "No authorized active crew assignment found",
        })
      }

        const revoked = result.rows[0]

        await recordWorkforceActivity(client, {
          tenantId,
          jobId,
          actorUserId: Number(actor.id),
          actorName: String(actor.full_name || actor.email || "User"),
          subjectName: String(revoked.crew_name),
          subjectRole:
            revoked.crew_role === "lead" ? "crew_lead" : "crew_member",
          action: "revoked",
          assignmentId: Number(revoked.id),
        })

        await client.query("COMMIT")
        return reply.send({ ok: true, revoked: true })
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({
        ok: false, error: "Crew revocation failed",
      })
    }
  })

  app.get("/workforce/crew/:jobId", async (request: any, reply) => {
    try {
      const actor = await getCurrentUserFromToken(getToken(request))
      if (!actor?.is_active) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" })
      }

      const tenantId = Number(actor.tenant_id)
      const jobId = Number(request.params.jobId)

      if (!Number.isSafeInteger(tenantId) || tenantId <= 0 ||
          !Number.isSafeInteger(jobId) || jobId <= 0) {
        return reply.code(400).send({ ok: false, error: "Invalid job" })
      }

      const management = [
        "platform_owner", "tenant_admin", "admin", "manager",
      ].includes(String(actor.role))

      if (!management && actor.role !== "subcontractor") {
        return reply.code(403).send({ ok: false, error: "Forbidden" })
      }

      const result = await pool.query(
        `
        select
          m.id, m.full_name, m.crew_role,
          m.preferred_language, m.invitation_status,
          a.id as assignment_id, a.status as assignment_status,
          a.assigned_at, a.subcontractor_company_id
        from workforce_crew_job_assignments a
        join workforce_crew_members m
          on m.id = a.crew_member_id
         and m.tenant_id = a.tenant_id
         and m.subcontractor_company_id = a.subcontractor_company_id
        join jobs j
          on j.id = a.job_id
         and j.tenant_id = a.tenant_id
        where a.tenant_id = $1
          and a.job_id = $2
          and a.status = 'active'
          and m.is_active = true
          and (
            $3::boolean
            or (
              $4::text = 'subcontractor'
              and exists (
                select 1
                from subcontractor_company_users scu
                join crew_assignments ca
                  on ca.app_user_id = scu.app_user_id
                 and ca.tenant_id = a.tenant_id
                 and ca.job_id = a.job_id
                 and ca.status in ('PENDING', 'active')
                where scu.app_user_id = $5
                  and scu.subcontractor_company_id =
                    a.subcontractor_company_id
              )
            )
          )
        order by m.full_name, m.id
        `,
        [tenantId, jobId, management, String(actor.role), Number(actor.id)]
      )

      return reply.send({ ok: true, crew: result.rows })
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({
        ok: false,
        error: "Could not list assigned crew",
      })
    }
  })

  app.post("/workforce/crew/:jobId/sms", async (request: any, reply) => {
    try {
      const actor = await getCurrentUserFromToken(getToken(request))

      if (!actor?.is_active) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" })
      }

      const allowedRoles = [
        "platform_owner",
        "tenant_admin",
        "admin",
        "manager",
      ]

      const isManagement = allowedRoles.includes(String(actor.role))
      const isSubcontractor = String(actor.role) === "subcontractor"

      if (!isManagement && !isSubcontractor) {
        return reply.code(403).send({
          ok: false,
          error: "Workforce messaging role required",
        })
      }

      const jobId = Number(request.params.jobId)
      const crewMemberId = Number(request.body?.crew_member_id)
      const message = String(request.body?.message || "").trim()

      if (
        !Number.isSafeInteger(jobId) || jobId <= 0 ||
        !Number.isSafeInteger(crewMemberId) || crewMemberId <= 0 ||
        !message || message.length > 1500
      ) {
        return reply.code(400).send({
          ok: false,
          error: "Valid job, crew member and message required",
        })
      }

      if (isSubcontractor) {
        const permission = await pool.query(
          `select 1
           from workforce_crew_members m
           join workforce_crew_job_assignments a
             on a.crew_member_id = m.id
            and a.tenant_id = m.tenant_id
            and a.subcontractor_company_id =
                m.subcontractor_company_id
           join subcontractor_company_users scu
             on scu.subcontractor_company_id =
                m.subcontractor_company_id
           join crew_assignments ca
             on ca.subcontractor_company_id =
                m.subcontractor_company_id
            and ca.job_id = a.job_id
           join jobs j
             on j.id = a.job_id
            and j.tenant_id = a.tenant_id
           where m.id = $1
             and m.tenant_id = $2
             and a.job_id = $3
             and a.tenant_id = $2
             and a.status = 'active'
             and m.is_active = true
             and scu.user_id = $4
             and ca.status in ('active', 'pending')
           limit 1`,
          [
            crewMemberId,
            Number(actor.tenant_id),
            jobId,
            Number(actor.id),
          ]
        )

        if (permission.rowCount !== 1) {
          return reply.code(403).send({
            ok: false,
            error: "Crew member is not assigned under your company",
          })
        }
      }

      const result = await sendJobCrewSms({
        tenantId: Number(actor.tenant_id),
        jobId,
        crewMemberId,
        senderLanguage: actor.preferred_language === "es" ? "es" : "en",
        message,
      })

      return reply.send(result)
    } catch (error: any) {
      request.log.error(error)
      return reply.code(500).send({
        ok: false,
        error: "Workforce SMS could not be sent",
      })
    }
  })

  app.post("/workforce/crew/:jobId", async (request: any, reply) => {
    try {
      const actor = await getCurrentUserFromToken(getToken(request))

      if (!actor?.is_active) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" })
      }

      const jobId = Number(request.params.jobId)

      // Resolve the company from the authenticated subcontractor.
      // Never trust a company ID supplied by the browser.
      if (actor.role !== "subcontractor") {
        return reply.code(403).send({
          ok: false,
          error: "Subcontractor account required",
        })
      }

      const companyResult = await pool.query(
        `select sc.id
         from subcontractor_company_users scu
         join subcontractor_companies sc
           on sc.id = scu.subcontractor_company_id
         where scu.app_user_id = $1
           and sc.tenant_id = $2
         limit 1`,
        [Number(actor.id), Number(actor.tenant_id)]
      )

      if (!companyResult.rowCount) {
        return reply.code(403).send({
          ok: false,
          error: "No subcontractor company assigned",
        })
      }

      const companyId = Number(companyResult.rows[0].id)

      const input: CrewInvitationInput = {
        full_name: request.body?.full_name,
        mobile_phone: request.body?.mobile_phone,
        crew_role: request.body?.crew_role,
        preferred_language: request.body?.preferred_language,
        job_id: jobId,
      }

      const error = validateCrewInvitation(input)
      if (error) {
        return reply.code(400).send({ ok: false, error })
      }

      const authorized = await canInviteCrewToJob(
        { id: Number(actor.id), tenant_id: Number(actor.tenant_id) },
        companyId,
        jobId
      )

      if (!authorized) {
        return reply.code(403).send({
          ok: false,
          error: "Not authorized for this company and job",
        })
      }

      const invitation = createWorkforceInvitationToken()
      const client = await pool.connect()
      try {
        await client.query("BEGIN")

        const member = await client.query(
          `insert into workforce_crew_members
             (tenant_id, subcontractor_company_id, full_name,
              mobile_phone, crew_role, preferred_language,
              invited_by_user_id, invited_at,
              invitation_token_hash, invitation_expires_at,
              invitation_job_id)
           values ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,$10)
           returning id, full_name, mobile_phone,
                     crew_role, preferred_language`,
          [
            Number(actor.tenant_id),
            companyId,
            input.full_name.trim(),
            normalizeCrewPhone(input.mobile_phone),
            input.crew_role,
            input.preferred_language,
            Number(actor.id),
            invitation.tokenHash,
            invitation.expiresAt,
            jobId,
          ]
        )

        const assignment = await client.query(
          `insert into workforce_crew_job_assignments
             (tenant_id, job_id, subcontractor_company_id,
              crew_member_id, assigned_by_user_id)
           values ($1,$2,$3,$4,$5)
           returning id, job_id, status`,
          [
            Number(actor.tenant_id),
            jobId,
            companyId,
            member.rows[0].id,
            Number(actor.id),
          ]
        )

        await recordWorkforceActivity(client, {
          tenantId: Number(actor.tenant_id),
          jobId,
          actorUserId: Number(actor.id),
          actorName: String(actor.full_name || actor.email || "User"),
          subjectName: String(member.rows[0].full_name),
          subjectRole:
            input.crew_role === "lead" ? "crew_lead" : "crew_member",
          action: "assigned",
          assignmentId: Number(assignment.rows[0].id),
        })

        await client.query("COMMIT")

        const appBaseUrl = (
          process.env.APP_BASE_URL ||
          "https://contractor-navigator.vercel.app"
        ).replace(/\/$/, "")

        const acceptanceUrl =
          `${appBaseUrl}/crew/accept-invite/${invitation.token}`

        let smsSent = false
        let smsError: string | undefined

        try {
          await sendWorkforceInvitationSms({
            phone: String(member.rows[0].mobile_phone),
            name: String(member.rows[0].full_name),
            jobId,
            language: input.preferred_language,
            acceptanceUrl,
          })
          smsSent = true
        } catch (sendError) {
          request.log.error(
            { err: sendError, crewMemberId: member.rows[0].id },
            "Workforce invitation SMS failed after assignment"
          )
          smsError = "Invitation SMS could not be sent"
        }

        return {
          ok: true,
          crew_member: member.rows[0],
          assignment: assignment.rows[0],
          sms_sent: smsSent,
          ...(smsError ? { sms_error: smsError } : {}),
        }
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    } catch (error: any) {
      request.log.error(error)
      return reply.code(500).send({
        ok: false,
        error: "Crew registration failed",
      })
    }
  })
}
