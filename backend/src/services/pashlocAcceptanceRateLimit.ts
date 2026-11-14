/** Shared disposable PostgreSQL rate limits for genuine MFA acceptance.
 * Enforced across service instances, not in process memory.
 */
import { createHash } from "node:crypto"
import type { FastifyInstance } from "fastify"
import { pool } from "../db/db"

export function registerPashLocAcceptanceRateLimits(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    const path = new URL(request.url, "http://localhost").pathname
    if (request.method !== "POST" ||
        !(path.startsWith("/auth/mfa/") || /^\/auth\/[^/]+\/login$/.test(path)))
      return
    const origin = String(request.headers.origin || "")
    if (origin !== process.env.APP_BASE_URL &&
        origin !== process.env.PASHLOC_PHONE_ORIGIN)
      return reply.code(403).send({ok:false,error:"Origin rejected"})
    const ipHash = createHash("sha256").update(request.ip).digest("hex")
    const buckets = [path + "|ip|" + ipHash, path + "|aggregate"]
    const result = await pool.query(
      `insert into pashloc_mfa_request_limits(bucket,window_start,hits)
       select bucket,date_trunc('minute',now()),1
       from unnest($1::text[]) as t(bucket)
       on conflict(bucket,window_start)
       do update set hits=least(pashloc_mfa_request_limits.hits+1,101)
       returning bucket,hits`, [buckets]
    )
    if (result.rowCount !== 2 ||
        result.rows.some((r:any) => Number(r.hits) > (String(r.bucket).endsWith("|aggregate") ? 100 : 20)))
      return reply.header("Retry-After","60").code(429).send({ok:false,error:"Rate limited"})
  })
}
