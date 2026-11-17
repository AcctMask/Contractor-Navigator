import { setToken } from "./auth"

export const signedTenant = "pashloc-genuine-acceptance-20261114"
export const signedPhoneOrigin = "https://pashloc-iv-acceptance-nu.vercel.app"
const acceptanceOrigin = "https://navigator-pashloc-iv4-acceptance.vercel.app"
const api = "https://navigator-pashloc-iv4-db-probe-gy3d.onrender.com"
export const signedEnabled = () => window.location.origin === acceptanceOrigin &&
  import.meta.env.VITE_PASHLOC_ACCEPTANCE_ONLY === "yes" && import.meta.env.VITE_API_BASE === api
export type SignedMode = "login" | "register"
export type SignedRequest = { reference:string; browserProof:string; expiresAt:string; phoneUrl:string; mode:SignedMode }

async function call(path:string,body:unknown,signal?:AbortSignal) {
  const response=await fetch(api+"/auth/mfa/signed/"+path,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
    cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer",signal
  })
  const json=await response.json()
  if(!response.ok||!json?.ok)throw new Error(json?.error||"unavailable")
  return json
}

export async function startSigned(email:string,password:string,mode:SignedMode):Promise<SignedRequest> {
  const result=await call("start",{tenantSlug:signedTenant,email,password,mode})
  const phone=new URL(result.phoneUrl)
  const key=mode==="register"?"navigator-register":"navigator-sign"
  if(phone.origin!==signedPhoneOrigin || phone.pathname!=="/" || phone.search ||
     phone.username||phone.password||phone.hash!=="#"+key+"="+result.reference ||
     !/^[A-Za-z0-9_-]{43}$/.test(result.reference)||!/^[A-Za-z0-9_-]{43}$/.test(result.browserProof)||
     !Number.isFinite(Date.parse(result.expiresAt))) throw new Error("unavailable")
  return {...result,mode}
}
export async function pollSigned(request:SignedRequest,signal:AbortSignal) {
  return call("complete",{reference:request.reference,browserProof:request.browserProof},signal)
}
export const storeSignedToken = setToken
