import { readFile } from "node:fs/promises"
import { pool } from "./db/db"

export async function migrateSignedAcceptance() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const id = await client.query("select current_database() as db, current_user as role")
    if (id.rows[0]?.db !== "pashloc_iv_disposable_mfa_isolated" ||
        id.rows[0]?.role !== "pashloc_iv_disposable_mfa_isolated_user")
      throw new Error("Signed approval migration requires the isolated database and role")
    await client.query("select pg_advisory_xact_lock(449045)")
    for (const file of ["044_pashloc_signed_approval_acceptance.sql","045_pashloc_signed_enrollment_acceptance.sql"])
      await client.query(await readFile(new URL("../migrations/"+file,import.meta.url),"utf8"))
    const schema = await client.query(`select to_regclass('public.pashloc_signed_devices') is not null
      and to_regclass('public.pashloc_signed_challenges') is not null
      and to_regclass('public.pashloc_signed_enrollment_grants') is not null as ready`)
    if(schema.rows[0]?.ready!==true) throw new Error("Signed approval schema missing")
    await client.query("COMMIT")
    console.log("PASHLOC_SIGNED_ACCEPTANCE_MIGRATIONS_VERIFIED_044_045")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally { client.release() }
}
