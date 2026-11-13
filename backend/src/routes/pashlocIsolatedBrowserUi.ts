/** Test-only same-origin Navigator browser page. No production assets or APIs. */
import type {FastifyInstance} from "fastify"
import {toDataURL} from "qrcode"
import {createHash} from "node:crypto"
import {pool} from "../db/db"
import {authorizeRestrictedBrowserRequest} from "../services/pashlocRestrictedSessionStoreV1"

const pageEn=`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Navigator · Secure Sign In</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0b1424;color:#edf4ff}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at top,#182d4b 0%,#0b1424 58%);line-height:1.5}
header{border-bottom:1px solid #30445e;padding:18px max(24px,calc((100vw - 960px)/2));display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{font-size:20px;font-weight:800;letter-spacing:.01em}.brand span{color:#79b7ff}
nav{font-size:13px}a{color:#9ccaff}main{width:min(100% - 32px,540px);margin:54px auto 64px}
.eyebrow{font-size:12px;font-weight:750;letter-spacing:.12em;color:#9ccaff;text-transform:uppercase}
h1{font-size:30px;line-height:1.2;margin:10px 0 10px}h2{font-size:20px;margin:0 0 12px}
.sub{color:#b5c7df;margin:0 0 22px}.panel{border:1px solid #30445e;border-radius:16px;padding:28px;background:#192c46;box-shadow:0 18px 55px #0004}
label{display:block;font-size:14px;font-weight:600;margin:16px 0 6px}input{display:block;width:100%;border:1px solid #637791;border-radius:8px;padding:12px 13px;background:#0d1b2e;color:#fff;font:inherit;margin-top:6px}
input:focus{outline:2px solid #73b5ff;outline-offset:1px}button{font:inherit;font-weight:700;cursor:pointer;border:1px solid #56759a;border-radius:9px;padding:12px 17px;background:#263d5a;color:#f4f8ff}
button.primary{background:#367bd5;border-color:#367bd5}button:disabled{opacity:.5;cursor:not-allowed}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}.muted{font-size:13px;color:#b5c7df}
details{margin-top:22px;color:#b5c7df;font-size:13px}summary{cursor:pointer}
.notice{margin-top:20px;border:1px solid #58769b;border-radius:10px;padding:14px;background:#11233a}
#qr{display:block;margin:20px auto;background:white;padding:10px;border-radius:12px;max-width:100%}
#status:not(:empty){margin-top:20px;border-left:3px solid #7abaff;padding:12px 14px;background:#10233b;border-radius:5px}
[hidden]{display:none!important}@media(max-width:600px){main{margin:28px auto}.panel{padding:20px}h1{font-size:26px}header{padding:16px}}
</style></head><body>
<header><div class="brand">Actual <span>Assistant</span> · Navigator</div><nav aria-label="Language"><a href="?lang=en" lang="en">English</a> · <a href="?lang=es" lang="es">Español</a></nav></header>
<main><div class="eyebrow">Secure access · Test environment</div><h1>Sign in to Navigator</h1>
<p class="sub">This is a safe demonstration of PashLoc verification. Your live Navigator account is not affected.</p>
<section class="panel">
<form id="credentials" method="post">
 <label>Email address<input name="email" type="email" autocomplete="username" required></label>
 <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
 <details><summary>Test account settings</summary><label>Test organization<input name="tenant_slug" required autocomplete="off"></label><p class="muted">Only disposable engineering accounts work here.</p></details>
 <div class="actions"><button class="primary" value="enroll">Set up PashLoc</button><button value="login">Sign in with PashLoc</button></div>
</form>
<p id="desktopOnly" class="notice" hidden role="alert">For security, first-time enrollment must be started on a Mac or PC. Open Navigator on your computer, then scan its QR with your phone.</p>
<p id="enrollmentHint" class="notice" hidden>First-time setup: scan this QR using the phone where you want PashLoc.</p><img id="qr" alt="Scan this QR in PashLoc" width="256" height="256" hidden>
<p id="loginHint" class="notice" hidden><strong>PashLoc IV MFA required</strong> Open PashLoc on your enrolled device, read your six-digit code, and enter it below. No QR is needed. <a href="__PHONE_ORIGIN__/" target="_blank" rel="noopener noreferrer">Open PashLoc IV to get code</a></p>
<form id="approve" method="post" hidden><label>Eight-digit approval<input name="code" inputmode="numeric" pattern="[0-9]{8}" required></label><button class="primary">Approve device</button></form>
<form id="totp" method="post" hidden><label>Six-digit code<input name="code" inputmode="numeric" pattern="[0-9]{6}" required></label><button class="primary">Verify code</button></form>
<p><button id="signout" type="button" hidden>Sign out</button></p>
<p id="status" role="status" aria-live="polite"></p>
</section><p class="muted" style="text-align:center;margin-top:18px">Isolated acceptance environment · No production customer data</p></main>
<script src="/isolated/mfa/browser.js" defer></script></body></html>`

const translations: Record<string,string> = {
 "Language":"Idioma",
 "Navigator · Secure Sign In":"Navigator · Acceso seguro",
 "Sign in to Navigator":"Iniciar sesión en Navigator",
 "Secure access · Test environment":"Acceso seguro · Entorno de prueba",
 "This is a safe demonstration of PashLoc verification. Your live Navigator account is not affected.":"Esta es una demostración segura de PashLoc. Tu cuenta real de Navigator no se ve afectada.",
 "Email address":"Correo electrónico",
 "Test account settings":"Configuración de cuenta de prueba",
 "Test organization":"Organización de prueba",
 "Only disposable engineering accounts work here.":"Solo funcionan cuentas de ingeniería temporales.",
 "Set up PashLoc":"Configurar PashLoc",
 "Sign in with PashLoc":"Entrar con PashLoc",
 "Isolated acceptance environment · No production customer data":"Entorno de prueba aislado · Sin datos de clientes reales",
 "Open PashLoc IV on your enrolled device, then enter its current six-digit code. No QR is needed.":"Abre PashLoc IV en tu dispositivo registrado e introduce el código actual de seis dígitos. No necesitas un QR.",
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
 "Open PashLoc IV on your enrolled device, then enter its current six-digit code. No QR is needed.":"Escanea para abrir tu cuenta guardada de Navigator e ingresa el código actual.",
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
const message=text=>{const known=Object.hasOwn(translations,text)?text:(text==="First-time enrollment requires a Mac or PC."?text:"Request declined. Check the code or start a new test.");byId("status").textContent=document.documentElement.lang==="es"?translations[known]:known;};
let state=null,mode=null;
const hide=()=>{for(const id of ["approve","totp","qr","signout","loginHint","enrollmentHint"])byId(id).hidden=true;byId("qr").removeAttribute("src");};
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
  try{await handler(e);}catch(error){message(error.message);}finally{for(const button of buttons)button.disabled=false;updateEnrollmentAvailability();}
 });
}
const isPhoneSized=()=>window.matchMedia("(max-width: 767px) and (pointer: coarse)").matches;
const enrollButton=document.querySelector('#credentials button[value="enroll"]');
function updateEnrollmentAvailability(){const blocked=isPhoneSized();enrollButton.disabled=blocked;byId("desktopOnly").hidden=!blocked;}
updateEnrollmentAvailability();window.addEventListener("resize",updateEnrollmentAvailability);
run("credentials",async e=>{
 if(e.submitter?.value!=="login"&&isPhoneSized()){byId("desktopOnly").hidden=false;message("First-time enrollment requires a Mac or PC.");return;}
 mode=e.submitter?.value==="login"?"login":"enroll";
 state=null;hide();
 const fields=Object.fromEntries(new FormData(e.currentTarget));
 e.currentTarget.elements.password.value="";
 state=await post(mode==="login"?"/auth/mfa/login/start":"/auth/mfa/enrollment/start",fields);
 if(mode==="enroll"){
  const qr=await post("/auth/mfa/browser-qr",{mode,challenge_id:state.challenge_id,pairing_ref:state.pairing_ref,account_id:state.account_id});
  byId("qr").src=qr.image;byId("qr").hidden=false;byId("enrollmentHint").hidden=false;
 }else byId("loginHint").hidden=false;
 byId(mode==="login"?"totp":"approve").hidden=false;
 message(mode==="login"?"Open PashLoc IV on your enrolled device, then enter its current six-digit code. No QR is needed.":"Scan in PashLoc and enter its eight-digit code to approve this device.");
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
   .send((language==="es"?pageEs:pageEn).replace("__PHONE_ORIGIN__",phoneOrigin))
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
