/** Explicitly gated disposable MFA acceptance execution; no HTTP endpoint.
 * All results are actual Fastify.inject responses, never synthetic successes.
 */
import type { FastifyInstance } from "fastify"
const slug="pashloc-genuine-acceptance-20261114"
const email="navigator-acceptance@example.invalid"
const origin=process.env.APP_BASE_URL!
const stages:string[]=[]
function result(stage:string,passed:boolean,detail:string){
  console.log("PASHLOC_ACCEPTANCE_STAGE",JSON.stringify({stage,result:passed?"PASS":"FAIL",detail}))
  stages.push(stage+":"+(passed?"PASS":"FAIL"))
  if(!passed)throw Error("Acceptance failed at "+stage+": "+detail)
}
export async function executeDisposableMfaAcceptance(app:FastifyInstance){
  if(process.env.PASHLOC_ACCEPTANCE_EXECUTE_PROTOCOL!=="yes"||
     process.env.PASHLOC_ACCEPTANCE_ONLY!=="yes"||
     process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME!=="pashloc_iv_disposable_mfa_isolated"||
     process.env.NODE_ENV!=="test")throw Error("Acceptance runner gate rejected")
  const password=process.env.PASHLOC_ACCEPTANCE_INITIAL_PASSWORD
  if(!password||password.length<24)throw Error("Disposable acceptance password unavailable")
  const abort=AbortSignal.timeout(45000)
  const run=async()=>{
    const headers={origin,"content-type":"application/json"}
    const denied=await app.inject({method:"POST",url:"/auth/mfa/enrollment/start",
      headers:{...headers,origin:"https://untrusted.invalid"},
      payload:{tenant_slug:slug,email,password}})
    result("unauthorized_origin_rejection",denied.statusCode===403,"HTTP "+denied.statusCode)
    const start=await app.inject({method:"POST",url:"/auth/mfa/enrollment/start",
      headers,payload:{tenant_slug:slug,email,password}})
    const body=start.json()
    result("genuine_enrollment_start",start.statusCode===200&&body.ok===true&&
      typeof body.challenge_id==="string"&&typeof body.pairing_ref==="string",
      "HTTP "+start.statusCode+"; "+(body.error||"challenge issued"))
    // This stage deliberately does not claim completion of signed phone
    // operations: those require a real cryptographic client, not mocked replies.
    console.log("PASHLOC_ACCEPTANCE_STAGE",JSON.stringify({
      stage:"signed_claim_through_returning_login",result:"NOT_RUN",
      detail:"Genuine device cryptographic client is not yet wired to this runner"}))
  }
  await Promise.race([run(),new Promise<never>((_,reject)=>{
    abort.addEventListener("abort",()=>reject(Error("Acceptance execution timed out")),{once:true})
  })])
  console.log("PASHLOC_ACCEPTANCE_RESULT",JSON.stringify({complete:false,stages}))
}
