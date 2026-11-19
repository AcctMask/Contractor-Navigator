import { createHash, createPublicKey, verify, type JsonWebKey } from "node:crypto"
import { pool } from "../db/db"
import { browserSessionDigest, sameSessionDigest } from "./pashlocSignedApprovalV1"
import { isOpaque } from "./navigatorSignedMfa"

const grantQuery = `select g.*, u.email from navigator_signed_enrollment_grants g
  join app_users u on u.id=g.app_user_id and u.tenant_id=g.tenant_id
  where g.reference=$1 and u.is_active and g.policy_epoch=u.navigator_mfa_epoch and g.used_at is null
    and g.expires_at>clock_timestamp() and g.expires_at<=clock_timestamp()+interval '10 minutes'
    and not exists (select 1 from navigator_signed_devices d
      where d.tenant_id=g.tenant_id and d.app_user_id=g.app_user_id and d.revoked_at is null)`

export async function signedRegistrationInfo(reference: string) {
  const { rows: [row] } = await pool.query(grantQuery, [reference])
  return row ? { tenantId: Number(row.tenant_id), userId: Number(row.app_user_id),
    account: row.email, application: "Navigator", environment: "production", expiresAt: row.expires_at.toISOString() } : null
}

export async function registerSignedDevice(input: Record<string, unknown>) {
  const { reference, grant, deviceId, signature, publicJwk } = input
  const j = publicJwk as JsonWebKey | null | undefined
  if (!isOpaque(reference) || !isOpaque(grant) || !isOpaque(deviceId) ||
      typeof signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(signature) ||
      !j || Object.keys(j).sort().join(",") !== "crv,kty,x,y" ||
      j.crv !== "P-256" || j.kty !== "EC" || !isOpaque(j.x) || !isOpaque(j.y)) return null

  const client = await pool.connect()
  try {
    await client.query("begin")
    await client.query(`select u.id from app_users u join navigator_signed_enrollment_grants g
      on u.id=g.app_user_id and u.tenant_id=g.tenant_id where g.reference=$1 for update of u`, [reference])
    const { rows: [row] } = await client.query(grantQuery + " for update of g", [reference])
    if (!row || !sameSessionDigest(row.grant_hash, browserSessionDigest(grant))) {
      await client.query("rollback")
      return null
    }

    const proof = Buffer.from(["AA-PASHLOC-LOGIN-V1/REGISTER", "production", row.tenant_id, row.app_user_id,
      reference, deviceId, row.expires_at.toISOString(), j.x, j.y].join("\n"))
    let verified = false
    try {
      verified = verify("sha256", proof, { key: createPublicKey({ key: j, format: "jwk" }),
        dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))
    } catch { /* Reject invalid public keys or proofs. */ }
    if (!verified) {
      await client.query("rollback")
      return null
    }
    const consumed = await client.query(`update navigator_signed_enrollment_grants set used_at=clock_timestamp()
      where reference=$1 and used_at is null and expires_at>clock_timestamp()`, [reference])
    const inserted = consumed.rowCount === 1 && await client.query(`insert into navigator_signed_devices
      (device_id, tenant_id, app_user_id, public_jwk, proof_verified_at)
      values ($1,$2,$3,$4,clock_timestamp()) on conflict do nothing`, [deviceId, row.tenant_id, row.app_user_id, j])
    if (!inserted || inserted.rowCount !== 1) {
      await client.query("rollback")
      return null
    }
    const referenceHash = createHash("sha256").update(reference).digest("hex")
    const audit = await client.query(`insert into navigator_signed_device_binding_audit
      (tenant_id, app_user_id, device_id, binding_method, enrollment_reference_hash)
      values ($1,$2,$3,'fresh_device_registration',$4) returning id`,
      [row.tenant_id, row.app_user_id, deviceId, referenceHash])
    if (audit.rowCount !== 1) {
      await client.query("rollback")
      return null
    }
    if (row.authorization_id) {
      await client.query(`update app_users u set navigator_mfa_epoch=navigator_mfa_epoch+1
        where id=$1 and tenant_id=$2 and exists (
          select 1 from tenants t where t.id=u.tenant_id and t.navigator_mfa_mandatory)`,
        [row.app_user_id, row.tenant_id])
    }
    await client.query("commit")
    return { deviceId, tenantId: Number(row.tenant_id), userId: Number(row.app_user_id) }
  } catch (err) {
    await client.query("rollback")
    throw err
  } finally { client.release() }
}
