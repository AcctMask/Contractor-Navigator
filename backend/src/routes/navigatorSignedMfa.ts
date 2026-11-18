import type { FastifyInstance } from "fastify"
import { registerSignedDevice, signedRegistrationInfo } from "../services/navigatorSignedEnrollment"
import { signToken } from "../services/authService"
import { consumeSignedMfa, getSignedChallenge, isOpaque, recordSignedDecision, signedMfaConfig } from "../services/navigatorSignedMfa"
import type { SignedApprovalContext } from "../services/pashlocSignedApprovalV1"

export function registerNavigatorSignedMfa(app: FastifyInstance) {
  const prefix = "/auth/mfa/signed/"
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0]
    if (!path.startsWith(prefix)) return
    const config = signedMfaConfig()
    const origin = path === prefix + "complete" ? config?.browser : config?.phone
    reply.header("Cache-Control", "no-store, private")
    if (!origin || request.headers.origin !== origin) return reply.code(403).send({ ok: false, error: "unavailable" })
  })
  const options = { bodyLimit: 4096 }
  app.post(prefix + "registration-info", options, async (request, reply) => {
    const { reference } = (request.body ?? {}) as Record<string, unknown>
    if (!isOpaque(reference)) return reply.code(400).send({ ok: false, error: "malformed" })
    const registration = await signedRegistrationInfo(reference)
    return registration ? { ok: true, ...registration } : reply.code(404).send({ ok: false, error: "unavailable" })
  })
  app.post(prefix + "register", options, async (request, reply) => {
    const registration = await registerSignedDevice((request.body ?? {}) as Record<string, unknown>)
    return registration ? { ok: true, ...registration } : reply.code(404).send({ ok: false, error: "unavailable" })
  })
  app.post(prefix + "challenge", options, async (request, reply) => {
    const { reference, deviceId } = (request.body ?? {}) as Record<string, unknown>
    if (!isOpaque(reference) || !isOpaque(deviceId)) return reply.code(400).send({ ok: false, error: "malformed" })
    const challenge = await getSignedChallenge(reference, deviceId)
    return challenge ? { ok: true, ...challenge } : reply.code(404).send({ ok: false, error: "unavailable" })
  })
  app.post(prefix + "decision", options, async (request, reply) => {
    const { context, signature } = (request.body ?? {}) as { context?: SignedApprovalContext; signature?: unknown }
    if (!isOpaque(context?.challengeId) || !isOpaque(context?.deviceId) || typeof signature !== "string")
      return reply.code(400).send({ ok: false, error: "malformed" })
    if (!(await recordSignedDecision(context!, signature)))
      return reply.code(404).send({ ok: false, error: "unavailable" })
    return { ok: true }
  })
  app.post(prefix + "complete", options, async (request, reply) => {
    const { reference, browserProof } = (request.body ?? {}) as Record<string, unknown>
    if (!isOpaque(reference) || !isOpaque(browserProof)) return reply.code(400).send({ ok: false, error: "malformed" })
    const result = await consumeSignedMfa(reference, browserProof)
    if (result.state === "approved")
      return { ok: true, state: result.state, token: signToken(result.user, { epoch: result.epoch, signedMfa: true }) }
    if (result.state === "pending") reply.code(202)
    if (result.state === "expired") reply.code(410)
    if (result.state === "unavailable") reply.code(404)
    return { ok: result.state === "pending" || result.state === "denied", state: result.state }
  })
}
