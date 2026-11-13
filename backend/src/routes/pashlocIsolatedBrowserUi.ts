/** Test-only same-origin Navigator browser page. No production assets or APIs. */
import type {FastifyInstance} from "fastify"
import {toDataURL} from "qrcode"
import {createHash} from "node:crypto"
import {pool} from "../db/db"
import {authorizeRestrictedBrowserRequest} from "../services/pashlocRestrictedSessionStoreV1"

const pageEn=`<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Navigator · Isolated MFA</title>
<nav aria-label="Language"><a href="?lang=en" lang="en">English</a> · <a href="?lang=es" lang="es">Español</a></nav>
<h1>Navigator MFA acceptance test</h1>
<p>Use your disposable test account only. This page is separate from production Navigator.</p>
<form id="credentials" method="post">
 <p><label>Test tenant <input name="tenant_slug" required></label></p>
 <p><label>Email <input name="email" type="email" required></label></p>
 <p><label>Password <input name="password" type="password" required></label></p>
 <button value="enroll">Start enrollment</button>
 <button value="login">Sign in with saved account</button>
</form>
<p><img id="qr" alt="Scan this QR in PashLoc" width="256" height="256" hidden></p>
<form id="approve" method="post" hidden><label>Eight-digit approval <input name="code" inputmode="numeric" pattern="[0-9]{8}" required></label><button>Approve device</button></form>
<form id="totp" method="post" hidden><label>Six-digit code <input name="code" inputmode="numeric" pattern="[0-9]{6}" required></label><button>Verify code</button></form>
<p><button id="signout" type="button" hidden>Sign out</button></p>
<p id="status" role="status"></p>
<script src="/isolated/mfa/browser.js" defer></script></html>`

const translations: Record<string,string> = {
 "Language":"Idioma",
 "Navigator · Isolated MFA":"Navigator · MFA aislada",
 "Navigator MFA acceptance test":"Prueba de aceptación de MFA de Navigator",
 "Use your disposable test account only. This page is separate from production Navigator.":"Usa solo tu cuenta desechable de prueba. Esta página está separada de Navigator en producción.",
 "Test tenant":"Organización de prueba",
 "Email":"Correo electrónico",
 "Password":"Contraseña",
 "Start enrollment":"Iniciar registro",
 "Sign in with saved account":"Iniciar sesión con la cuenta guardada",
 "Scan this QR in PashLoc":"Escanea este QR en PashLoc",
 "Eight-digit approval":"Código de aprobación de ocho dígitos",
 "Approve device":"Aprobar dispositivo",
 "Six-digit code":"Código de seis dígitos",
 "Verify code":"Verificar código",
 "Sign out":"Cerrar sesión",
 "Too many attempts. Wait a minute and try again.":"Demasiados intentos. Espera un minuto y vuelve a intentarlo.",
 "Request declined. Check the code or start a new test.":"Solicitud rechazada. Revisa el código o inicia una nueva prueba.",
 "Scan to open your saved Navigator account, then enter its current code.":"Escanea para abrir tu cuenta guardada de Navigator e ingresa el código actual.",
 "Scan in PashLoc and enter its eight-digit code to approve this device.":"Escanea en PashLoc e ingresa su código de ocho dígitos para aprobar este dispositivo.",
 "Device approved. Finish retrieval in PashLoc, then enter its six-digit code here.":"Dispositivo aprobado. Completa la recepción en PashLoc e ingresa aquí su código de seis dígitos.",
 "Test session was not established.":"No se pudo iniciar la sesión de prueba.",
 "Signed in to the isolated test session.":"Has iniciado la sesión de prueba aislada.",
 "Enrollment confirmed. Sign in with the saved account and a fresh PashLoc code.":"Registro confirmado. Inicia sesión con la cuenta guardada y un código nuevo de PashLoc.",
 "Signed out.":"Sesión cerrada."
}
const localizePage=()=>{
 let page=pageEn.replace('<html lang="en"','<html lang="es"')
 for(const [source,translation] of Object.entries(translations))page=page.replaceAll(source,translation)
 return page
}
const pageEs=localizePage()
const script=`
const byId=id=>document.getElementById(id);
const translations=${JSON.stringify(translations)};
const message=text=>{const known=Object.hasOwn(translations,text)?text:"Request declined. Check the code or start a new test.";byId("status").textContent=document.documentElement.lang==="es"?translations[known]:known;};
let state=null,mode=null;
const hide=()=>{for(const id of ["approve","totp","qr","signout"])byId(id).hidden=true;byId("qr").removeAttribute("src");};
async function post(path,body){
 const headers={"Content-Type":"application/json"};
 if(state?.csrf_token)headers["X-Pashloc-Csrf"]=state.csrf_token;
 const response=await fetch(path,{method:"POST",headers,cache:"no-store",credentials:"same-origin",body:JSON.stringify(body)});
 if(!response.ok)throw Error(response.status===429?"Too many attempts. Wait a minute and try again.":"Request declined. Check the code or start a new test.");
 return response.json();
}
function run(id,handler){
 const node=byId(id);
 node.addEventListener(node.tagName==="FORM"?"submit":"click",async e=>{
  e.preventDefault();
  const buttons=[...node.querySelectorAll("button")];
  for(const button of buttons)button.disabled=true;
  try{await handler(e);}catch(error){message(error.message);}finally{for(const button of buttons)button.disabled=false;}
 });
}
run("credentials",async e=>{
 mode=e.submitter?.value==="login"?"login":"enroll";
 state=null;hide();
 const fields=Object.fromEntries(new FormData(e.currentTarget));
 e.currentTarget.elements.password.value="";
 state=await post(mode==="login"?"/auth/mfa/login/start":"/auth/mfa/enrollment/start",fields);
 const qr=await post("/auth/mfa/browser-qr",{mode,challenge_id:state.challenge_id,pairing_ref:state.pairing_ref,account_id:state.account_id});
 byId("qr").src=qr.image;byId("qr").hidden=false;
 byId(mode==="login"?"totp":"approve").hidden=false;
 message(mode==="login"?"Scan to open your saved Navigator account, then enter its current code.":"Scan in PashLoc and enter its eight-digit code to approve this device.");
});
run("approve",async e=>{
 const code=e.currentTarget.elements.code.value;e.currentTarget.reset();
 await post("/auth/mfa/enrollment/approve-device",{challenge_id:state.challenge_id,pairing_ref:state.pairing_ref,confirmation_code:code});
 byId("approve").hidden=true;byId("totp").hidden=false;
 message("Device approved. Finish retrieval in PashLoc, then enter its six-digit code here.");
});
run("totp",async e=>{
 const code=e.currentTarget.elements.code.value;e.currentTarget.reset();
 await post(mode==="login"?"/auth/mfa/login/verify":"/auth/mfa/enrollment/confirm",{
  challenge_id:state.challenge_id,pairing_ref:state.pairing_ref,code
 });
 hide();state=null;
 if(mode==="login"){
  const result=await fetch("/isolated/mfa/session-check",{cache:"no-store"});
  if(!result.ok)throw Error("Test session was not established.");
  byId("signout").hidden=false;
  message("Signed in to the isolated test session.");
 }else message("Enrollment confirmed. Sign in with the saved account and a fresh PashLoc code.");
});
run("signout",async()=>{await post("/auth/mfa/login/sign-out",{});state=null;hide();message("Signed out.");});
`

export function registerPashLocIsolatedBrowserUi(app:FastifyInstance){
 const navigatorOrigin=process.env.PASHLOC_ISOLATED_NAVIGATOR_ORIGIN!
 const phoneOrigin=process.env.PASHLOC_ISOLATED_PHONE_ORIGIN!
 const policy="default-src 'none'; script-src 'self'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
 const headers={"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Content-Security-Policy":policy}
 app.get("/isolated/mfa",async(req,reply)=>{
  const selected=(req.query as {lang?:string})?.lang
  const language=selected==="es"||(!selected&&/^es(?:[-,;]|$)/i.test(req.headers["accept-language"]||""))?"es":"en"
  return reply.headers(headers).header("Content-Language",language).type("text/html; charset=utf-8")
   .send(language==="es"?pageEs:pageEn)
 })
 app.get("/isolated/mfa/browser.js",async(_req,reply)=>reply.headers(headers).type("application/javascript; charset=utf-8").send(script))
 app.post("/auth/mfa/browser-qr",async(req,reply)=>{
  reply.headers(headers)
  if(req.headers.origin!==navigatorOrigin||
     (req.headers["sec-fetch-site"]!==undefined&&req.headers["sec-fetch-site"]!=="same-origin")||
     req.headers["content-type"]?.split(";")[0].trim().toLowerCase()!=="application/json")
   return reply.code(403).send({ok:false})
  const body=req.body as Record<string,unknown>|null
  const isEnroll=body?.mode==="enroll"
  const value=isEnroll?body?.pairing_ref:body?.account_id
  if((!isEnroll&&body?.mode!=="login")||typeof value!=="string"||
     !(isEnroll?/^[A-Za-z0-9_-]{43}$/:/^[A-Za-z0-9_-]{32}$/).test(value))return reply.code(400).send({ok:false})
  if(typeof body.challenge_id!=="string")return reply.code(400).send({ok:false})
  const session=await authorizeRestrictedBrowserRequest({
   cookieHeader:req.headers.cookie,csrfHeader:req.headers["x-pashloc-csrf"],
   origin:req.headers.origin,expectedOrigin:navigatorOrigin,secFetchSite:req.headers["sec-fetch-site"],
   contentType:req.headers["content-type"],challengeId:body.challenge_id,purpose:isEnroll?"enroll":"verify"
  })
  if(!session)return reply.code(403).send({ok:false})
  const hash=(s:string)=>createHash("sha256").update(s).digest("hex")
  const match=isEnroll?await pool.query(
   `select 1 from pashloc_mfa_pairings p join pashloc_mfa_challenges c on c.id=p.challenge_id
     where c.challenge_hash=$1 and p.pairing_hash=$2 and p.expires_at>now() and p.denied_at is null`,
   [hash(session.challengeId),hash(value)]
  ):await pool.query(
   `select 1 from pashloc_mfa_enrollments where account_id=$1 and tenant_id=$2 and app_user_id=$3
      and status='confirmed' and delivery_pairing_id is not null`,[value,session.tenantId,session.userId])
  if(match.rowCount!==1)return reply.code(403).send({ok:false})
  const url=new URL("/",phoneOrigin)
  url.searchParams.set("mode",isEnroll?"enroll":"open")
  url.searchParams.set("issuer","Navigator")
  url.searchParams.set(isEnroll?"pairing":"account",value)
  return {image:await toDataURL(url.toString(),{width:256,margin:2})}
 })
}
