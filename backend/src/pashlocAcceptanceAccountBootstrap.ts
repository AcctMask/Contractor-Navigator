/** One-time, isolated acceptance-account activation. Never usable in production. */
import bcrypt from "bcryptjs"
import { Pool } from "pg"
const expectedDb = "pashloc_iv_disposable_mfa_isolated"
const expectedRole = "pashloc_iv_disposable_mfa_isolated_user"
const email = "navigator-acceptance@example.invalid"
const slug = "pashloc-genuine-acceptance-20261114"
const secret = process.env.PASHLOC_ACCEPTANCE_INITIAL_PASSWORD
if (process.env.NODE_ENV !== "test" ||
    process.env.PASHLOC_ACCEPTANCE_ONLY !== "yes" ||
    process.env.PASHLOC_ACCEPTANCE_DATABASE_NAME !== expectedDb ||
    !secret || secret.length < 24) throw Error("Acceptance credential bootstrap denied")
const url = new URL(process.env.DATABASE_URL || "")
if (!["postgres:","postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.pathname.slice(1)) !== expectedDb)
  throw Error("Acceptance database identity rejected")
const pool = new Pool({connectionString:process.env.DATABASE_URL,max:1})
try {
  const identity = await pool.query("select current_database() as db,current_user as role")
  if (identity.rows[0]?.db !== expectedDb || identity.rows[0]?.role !== expectedRole)
    throw Error("Acceptance database role rejected")
  const user = await pool.query(
    "select u.id,u.pashloc_mfa_required,u.is_active from app_users u join tenants t on t.id=u.tenant_id where t.slug=$1 and lower(u.email)=$2",
    [slug,email])
  if (user.rowCount !== 1 || user.rows[0].is_active !== true)
    throw Error("Acceptance identity unavailable")
  if (user.rows[0].pashloc_mfa_required === true) {
    console.log("PASHLOC_ACCEPTANCE_ACCOUNT_ALREADY_ACTIVATED")
  } else {
    const hash = await bcrypt.hash(secret,12)
    const updated = await pool.query(
      "update app_users set password_hash=$1,pashloc_mfa_required=true,pashloc_mfa_activated_at=now(),updated_at=now() where id=$2 and pashloc_mfa_required=false returning id",
      [hash,user.rows[0].id])
    if (updated.rowCount !== 1) throw Error("Acceptance activation race")
    console.log("PASHLOC_ACCEPTANCE_ACCOUNT_ACTIVATED")
  }
} finally {await pool.end()}
