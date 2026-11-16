/** Isolated Chairman password setup. No production route, invitation acceptance, or JWT issuance. */
import type { FastifyInstance } from "fastify"
import { randomBytes, createHash } from "node:crypto"
import bcrypt from "bcryptjs"
import { pool } from "./db/db"
import { sendActualAssistantNavigatorEmail } from "./services/emailService"

const email = "steve@g2groofing.com"
const slug = "pashloc-genuine-acceptance-20261114"
const origin = "https://navigator-pashloc-iv4-acceptance.vercel.app"
const table = "pashloc_chairman_password_setup"
const hashToken = (value:string) => createHash("sha256").update(value).digest("hex")
function guard() {
 if (process.env.PASHLOC_ACCEPTANCE_ONLY !== "yes" ||
     process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME !== "pashloc_iv_disposable_mfa_isolated" ||
     new URL(process.env.DATABASE_URL || "").pathname !== "/pashloc_iv_disposable_mfa_isolated")
   throw Error("Chairman setup requires disposable acceptance database")
}
export async function ensureChairmanSetupSchema() {
 guard()
 await pool.query(`create table if not exists ${table} (id bigserial primary key, user_id bigint not null, token_hash text not null unique, expires_at timestamptz not null, consumed_at timestamptz, created_at timestamptz not null default now())`)
}
export async function issueChairmanPasswordSetup() {
 guard()
 if (process.env.PASHLOC_CHAIRMAN_SETUP_ISSUE !== "yes") throw Error("Explicit issuance gate required")
 const client = await pool.connect()
 let token = ""
 try {
  await client.query("BEGIN")
  await client.query(`create table if not exists ${table} (
   id bigserial primary key, user_id bigint not null, token_hash text not null unique,
   expires_at timestamptz not null, consumed_at timestamptz, created_at timestamptz not null default now())`)
  const tenant = await client.query("select id from tenants where slug=$1 for update",[slug])
  if (tenant.rowCount!==1) throw Error("Acceptance tenant unavailable")
  const user = await client.query("select id from app_users where tenant_id=$1 and lower(email)=$2 for update",[tenant.rows[0].id,email])
  if(user.rowCount!==1) throw Error("Chairman acceptance identity must be provisioned separately")
  const enroll = await client.query("select id from pashloc_mfa_enrollments where app_user_id=$1 and status='confirmed'",[user.rows[0].id])
  if(enroll.rowCount) throw Error("Chairman enrollment already confirmed")
  await client.query(`update ${table} set consumed_at=now() where user_id=$1 and consumed_at is null`,[user.rows[0].id])
  token = randomBytes(32).toString("hex")
  await client.query(`insert into ${table}(user_id,token_hash,expires_at) values ($1,$2,now()+interval '30 minutes')`,[user.rows[0].id,hashToken(token)])
  await client.query("COMMIT")
 } catch(e) {await client.query("ROLLBACK");throw e} finally {client.release()}
 // Never log the token or link. Email directly to the intended mailbox.
 const delivered = await sendActualAssistantNavigatorEmail({to:email,subject:"Navigator acceptance — secure password setup",heading:"Set up your Navigator acceptance password",lines:["This one-time link expires in 30 minutes.","This is an isolated acceptance account. Your production Navigator password is unchanged."],buttonLabel:"Set acceptance password",buttonUrl:origin+"/acceptance/password-setup#"+token})
 if (!delivered.ok) throw Error("Chairman setup invitation delivery failed")
 return {ok:true,recipient:email}
}
export function registerChairmanPasswordSetup(app:FastifyInstance) {
 app.post("/auth/acceptance/password-setup/validate",async(req:any,reply)=>{
  guard()
  reply.header("Cache-Control","no-store").header("Referrer-Policy","no-referrer")
  if(req.headers.origin!==origin || !String(req.headers["content-type"]||"").startsWith("application/json")) return reply.code(403).send({ok:false})
  const token=String(req.body?.token||"")
  if(!/^[a-f0-9]{64}$/.test(token)) return reply.code(404).send({ok:false})
  const result=await pool.query(`select u.email from ${table} p join app_users u on u.id=p.user_id join tenants t on t.id=u.tenant_id where p.token_hash=$1 and p.consumed_at is null and p.expires_at>now() and t.slug=$2 and lower(u.email)=$3`,[hashToken(token),slug,email])
  return result.rowCount===1?{ok:true,email}:{ok:false}
 })
 app.post("/auth/acceptance/password-setup",async(req:any,reply)=>{
  guard()
  reply.header("Cache-Control","no-store").header("Referrer-Policy","no-referrer")
  if(req.headers.origin!==origin || !String(req.headers["content-type"]||"").startsWith("application/json")) return reply.code(403).send({ok:false})
  const token=String(req.body?.token||""),password=String(req.body?.password||"")
  if(!/^[a-f0-9]{64}$/.test(token)||password.length<12||password.length>128) return reply.code(400).send({ok:false,error:"Invalid or expired setup request"})
  const passwordHash=await bcrypt.hash(password,12)
  const client=await pool.connect()
  try {
   await client.query("BEGIN")
   const record=await client.query(`select p.id,p.user_id from ${table} p join app_users u on u.id=p.user_id join tenants t on t.id=u.tenant_id where p.token_hash=$1 and p.consumed_at is null and p.expires_at>now() and t.slug=$2 and lower(u.email)=$3 for update of p`,[hashToken(token),slug,email])
   if(record.rowCount!==1) {await client.query("ROLLBACK");return reply.code(410).send({ok:false,error:"Invitation expired or already used"})}
   const user=await client.query("update app_users set password_hash=$1,pashloc_mfa_required=true,pashloc_mfa_activated_at=now(),updated_at=now() where id=$2 and is_active=true returning id",[passwordHash,record.rows[0].user_id])
   if(user.rowCount!==1) throw Error("Acceptance user unavailable")
   await client.query(`update ${table} set consumed_at=now() where id=$1`,[record.rows[0].id])
   await client.query("COMMIT")
   return {ok:true,requires_login:true,requires_mfa:true}
  } catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
 })
}
