import { randomBytes } from "node:crypto"
import type { JsonWebKey } from "node:crypto"
import { pool } from "../db/db"
import { browserSessionDigest, sameSessionDigest, verifySignedApproval, type SignedApprovalContext } from "./pashlocSignedApprovalV1"

export const isOpaque = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v)
const mint = () => randomBytes(32).toString("base64url")

function httpsOrigin(value: string | undefined) {
  try {
    const url = new URL(value || "")
    return url.protocol === "https:" && value === url.origin ? url.origin : null
  } catch { return null }
}

export function signedMfaConfig() {
  if (process.env.NAVIGATOR_MFA_SIGNED_ENABLED !== "true" || !process.env.JWT_SECRET ||
      process.env.PASHLOC_ACCEPTANCE_ONLY !== undefined) return null
  const browser = httpsOrigin(process.env.NAVIGATOR_MFA_BROWSER_ORIGIN)
  const phone = httpsOrigin(process.env.NAVIGATOR_MFA_PHONE_ORIGIN)
  return browser && phone && browser !== phone ? { browser, phone } : null
}

type Db = Pick<typeof pool, "query">
type SignedAccount = { id: number; tenant_id: number; password_hash: string; navigator_mfa_epoch: string }

export async function startSignedMfa(client: Db, account: SignedAccount, origin: string | undefined) {
  const config = signedMfaConfig()
  if (!config || origin !== config.browser) return { mfa_required: true as const, unavailable: true as const }
  const { rows: [device] } = await client.query(
    `select device_id from navigator_signed_devices
       where tenant_id=$1 and app_user_id=$2 and revoked_at is null`,
    [account.tenant_id, account.id],
  )
  if (!device) return { mfa_required: true as const, enrollment_required: true as const }
  // Login holds the account row lock, so concurrent starts share this limit.
  await client.query(`delete from navigator_signed_challenges
    where app_user_id=$1 and expires_at < clock_timestamp() - interval '10 minutes'`, [account.id])
  const { rows: [recent] } = await client.query(
    `select count(*)::int as total from navigator_signed_challenges
       where app_user_id=$1 and created_at > clock_timestamp() - interval '2 minutes'`, [account.id],
  )
  if (recent.total >= 10) return { mfa_required: true as const, unavailable: true as const }
  const reference = mint(), browserProof = mint()
  const { rows: [challenge] } = await client.query(
    `insert into navigator_signed_challenges
        (reference,browser_hash,tenant_id,app_user_id,device_id,policy_epoch,password_fingerprint,expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '110 seconds')
       returning expires_at`,
    [reference, browserSessionDigest(browserProof), account.tenant_id, account.id, device.device_id,
      account.navigator_mfa_epoch, browserSessionDigest(account.password_hash)],
  )
  const url = new URL("/", config.phone)
  url.hash = "navigator-sign=" + reference
  return { mfa_required: true as const, method: "pashloc_signed" as const, reference, browserProof,
    phoneUrl: url.href, expiresAt: challenge.expires_at.toISOString() }
}

const currentChallenge = `select c.*, d.public_jwk, u.email, u.full_name, u.mobile_phone, u.role, u.is_active,
    u.financials_authorized, u.password_hash, (c.expires_at>clock_timestamp()) as fresh
  from navigator_signed_challenges c
  join app_users u on u.id=c.app_user_id and u.tenant_id=c.tenant_id
  join navigator_signed_devices d on d.device_id=c.device_id and d.tenant_id=c.tenant_id and d.app_user_id=c.app_user_id
  where c.reference=$1 and u.is_active and u.navigator_mfa_required and c.policy_epoch=u.navigator_mfa_epoch
    and d.revoked_at is null`

type Challenge = {
  reference: string; device_id: string; tenant_id: string; app_user_id: string; browser_hash: string;
  expires_at: Date; public_jwk: JsonWebKey; decision: "approve" | "deny" | null;
  consumed_at: Date | null; fresh: boolean; password_hash: string; password_fingerprint: string;
  policy_epoch: string; email: string; full_name: string; mobile_phone: string | null; role: string;
  is_active: boolean; financials_authorized: boolean
}

function usable(row: Challenge | undefined): row is Challenge {
  return !!row && row.fresh && !row.consumed_at &&
    sameSessionDigest(row.password_fingerprint, browserSessionDigest(row.password_hash))
}

function expected(row: Challenge): Omit<SignedApprovalContext, "decision"> {
  return { version: "AA-PASHLOC-LOGIN-V1", environment: "production", tenantId: Number(row.tenant_id),
    userId: Number(row.app_user_id), deviceId: row.device_id, challengeId: row.reference,
    browserSessionHash: row.browser_hash, expiresAt: row.expires_at.toISOString() }
}

export async function getSignedChallenge(reference: string, deviceId: string) {
  const { rows: [row] } = await pool.query<Challenge>(currentChallenge + " and c.device_id=$2", [reference, deviceId])
  return usable(row) && !row.decision ? { context: expected(row), account: row.email, application: "Navigator" } : null
}

// Acquire the account lock first, in the same order as password login and policy updates.
async function withChallenge<T>(reference: string, work: (client: Db, row: Challenge | undefined) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query("begin")
    await client.query(`select u.id from app_users u join navigator_signed_challenges c
      on c.app_user_id=u.id and c.tenant_id=u.tenant_id where c.reference=$1 for update of u`, [reference])
    const { rows: [row] } = await client.query<Challenge>(currentChallenge + " for update of c,d", [reference])
    const result = await work(client, row)
    await client.query("commit")
    return result
  } catch (err) {
    await client.query("rollback")
    throw err
  } finally { client.release() }
}

export async function recordSignedDecision(context: SignedApprovalContext, signature: string) {
  return withChallenge(context.challengeId, async (client, row) => {
    if (!usable(row) || row.decision || !verifySignedApproval({
      context, signature, expected: expected(row), registeredPublicJwk: row.public_jwk, allowDeny: true,
    })) return false
    const written = await client.query(`update navigator_signed_challenges set decision=$2
      where reference=$1 and decision is null and expires_at>clock_timestamp()`, [row.reference, context.decision])
    return written.rowCount === 1
  })
}

export async function consumeSignedMfa(reference: string, browserProof: string) {
  const digest = browserSessionDigest(browserProof)
  return withChallenge(reference, async (client, row) => {
    if (!row || !sameSessionDigest(row.browser_hash, digest)) return { state: "unavailable" } as const
    if (!usable(row)) return { state: "expired" } as const
    if (!row.decision) return { state: "pending" } as const
    if (row.decision === "deny") return { state: "denied" } as const
    const consumed = await client.query(`update navigator_signed_challenges set consumed_at=clock_timestamp()
      where reference=$1 and consumed_at is null and expires_at>clock_timestamp()`, [reference])
    if (consumed.rowCount !== 1) return { state: "expired" } as const
    return { state: "approved" as const, epoch: String(row.policy_epoch), user: {
      id: Number(row.app_user_id), tenant_id: Number(row.tenant_id), email: row.email, full_name: row.full_name,
      mobile_phone: row.mobile_phone, role: row.role, is_active: row.is_active, financials_authorized: row.financials_authorized,
    } }
  })
}
