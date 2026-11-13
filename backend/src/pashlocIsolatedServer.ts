/** Dedicated disposable PashLoc integration service.
 * Intentionally contains NO production Navigator API routes, schedulers or JWT login.
 * Never deploy this entrypoint against a production database.
 */
import Fastify from "fastify"
import {registerPashLocIsolatedBrowserUi} from "./routes/pashlocIsolatedBrowserUi"
import {registerPashLocIsolatedRateLimits} from "./services/pashlocIsolatedRateLimit"
import {registerPashLocIsolatedFirstCode} from "./routes/pashlocIsolatedFirstCode"
import {registerPashLocIsolatedReturningLoginRoutes} from "./routes/pashlocIsolatedReturningLogin"
import {registerPashLocIsolatedClaimRoutes} from "./routes/pashlocIsolatedClaim"
import {registerPashLocIsolatedBrowserApprovalRoutes} from "./routes/pashlocIsolatedBrowserApproval"
import {registerPashLocIsolatedEnrollmentStartRoutes} from "./routes/pashlocIsolatedEnrollmentStart"
import {registerPashLocIsolatedSyntheticRedeemRoutes} from "./routes/pashlocIsolatedSyntheticRedeem"

export async function buildPashLocIsolatedServer() {
 if(!["development","test"].includes(process.env.NODE_ENV||"") ||
    process.env.PASHLOC_ISOLATED_CLAIM_API!=="enabled" ||
    process.env.PASHLOC_ISOLATED_SHARED_RATE_LIMITS_VERIFIED!=="yes")
  throw new Error("Isolated MFA prerequisites not met")
 const validOrigin=/^https:\/\/[a-z0-9.-]+(?::443)?$/i
 if(!validOrigin.test(process.env.PASHLOC_ISOLATED_PHONE_ORIGIN||"")||
    !validOrigin.test(process.env.PASHLOC_ISOLATED_NAVIGATOR_ORIGIN||"")||
    process.env.PASHLOC_ISOLATED_PHONE_ORIGIN===process.env.PASHLOC_ISOLATED_NAVIGATOR_ORIGIN)
  throw new Error("Approved isolated origin configuration is required")
 const app=Fastify({logger:true,bodyLimit:16*1024,disableRequestLogging:true})
 app.setErrorHandler((error,req,reply)=>{
  const code=(error as {statusCode?:number})?.statusCode
  const status=code && code>=400 && code<500 ? code : 500
  if(status===500) req.log.error({requestId:req.id},"Isolated MFA request failed")
  return reply.code(status).send({ok:false})
 })
 // No global wildcard CORS. Phone routes each enforce exact origin.
 registerPashLocIsolatedRateLimits(app)
 registerPashLocIsolatedBrowserUi(app)
 app.get("/healthz",async()=>({ok:true,service:"pashloc-isolated"}))
 await registerPashLocIsolatedEnrollmentStartRoutes(app)
 await registerPashLocIsolatedReturningLoginRoutes(app)
 await registerPashLocIsolatedFirstCode(app)
 await registerPashLocIsolatedClaimRoutes(app)
 await registerPashLocIsolatedBrowserApprovalRoutes(app)
 await registerPashLocIsolatedSyntheticRedeemRoutes(app)
 return app
}
if(process.argv[1]&&/pashlocIsolatedServer\.(?:ts|js)$/.test(process.argv[1])){
 if(process.env.PASHLOC_ISOLATED_SCHEMA_INIT==="explicit-one-time") {
  await import("../scripts/initializePashlocRenderIsolated")
 }
 const app=await buildPashLocIsolatedServer()
 await app.listen({host:"0.0.0.0",port:Number(process.env.PORT||8788)})
}
