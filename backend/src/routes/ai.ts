import type { FastifyInstance } from "fastify"
import {
  getAiConversationByTenantSlug,
  handleInboundMessageByTenantSlug,
  queueAiFollowupByTenantSlug,
} from "../services/followupEngine"

async function registerAiRoutes(app: FastifyInstance) {
  app.post("/ai/followup/:tenant/:jobId/run", async (req, reply) => {
    const params = (req as any).params || {}
    const tenant = String(params.tenant || "")
    const jobId = Number(params.jobId)

    const result = await queueAiFollowupByTenantSlug(tenant, jobId)
    return reply.send(result)
  })

  app.post("/ai/inbound/:tenant/:jobId", async (req, reply) => {
    const params = (req as any).params || {}
    const body = (req as any).body || {}

    const tenant = String(params.tenant || "")
    const jobId = Number(params.jobId)
    const message = String(body.message || "").trim()
    const from = body.from ? String(body.from) : null

    if (!message) {
      return reply.code(400).send({
        ok: false,
        error: "message is required",
      })
    }

    const result = await handleInboundMessageByTenantSlug(
      tenant,
      jobId,
      message,
      from
    )

    return reply.send(result)
  })

  app.get("/ai/conversation/:tenant/:jobId", async (req, reply) => {
    const params = (req as any).params || {}
    const tenant = String(params.tenant || "")
    const jobId = Number(params.jobId)

    const result = await getAiConversationByTenantSlug(tenant, jobId)
    return reply.send(result)
  })
}

export default registerAiRoutes
export { registerAiRoutes }
