import { pool } from "../db/db"

function normalizePhone(phone: string | null | undefined) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (phone.startsWith("+")) return phone
  return digits ? `+${digits}` : null
}

async function ensureDncTable() {
  await pool.query(`
    create table if not exists customer_contact_flags (
      id bigserial primary key,
      tenant_id bigint not null references tenants(id) on delete cascade,
      customer_id bigint null,
      phone text not null,
      is_dnc boolean not null default false,
      source text null,
      note text null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (tenant_id, phone)
    )
  `)
}

export function detectDncOptOut(message: string) {
  const text = String(message || "").trim().toLowerCase()

  if (!text) return false

  const exact = [
    "stop",
    "unsubscribe",
    "end",
    "quit",
    "cancel",
    "stop all",
    "stop texts",
    "do not contact",
    "do not text",
    "dont text",
    "don't text",
    "remove me",
    "leave me alone",
  ]

  if (exact.includes(text)) return true

  return (
    text.includes("unsubscribe") ||
    text.includes("do not contact") ||
    text.includes("don't text") ||
    text.includes("dont text") ||
    text.includes("stop texting") ||
    text.includes("stop sending") ||
    text.includes("remove me")
  )
}

export function detectDncOptIn(message: string) {
  const text = String(message || "").trim().toLowerCase()
  return text === "start" || text === "unstop" || text === "resume"
}

export async function markPhoneAsDnc(
  tenantId: number,
  phone: string | null,
  options?: {
    customerId?: number | null
    source?: string | null
    note?: string | null
  }
) {
  await ensureDncTable()

  const normalized = normalizePhone(phone)
  if (!normalized) return { ok: false, reason: "missing_phone" }

  await pool.query(
    `
    insert into customer_contact_flags
      (tenant_id, customer_id, phone, is_dnc, source, note, created_at, updated_at)
    values
      ($1, $2, $3, true, $4, $5, now(), now())
    on conflict (tenant_id, phone)
    do update set
      customer_id = coalesce(excluded.customer_id, customer_contact_flags.customer_id),
      is_dnc = true,
      source = excluded.source,
      note = excluded.note,
      updated_at = now()
    `,
    [
      tenantId,
      options?.customerId || null,
      normalized,
      options?.source || null,
      options?.note || null,
    ]
  )

  return { ok: true, phone: normalized }
}

export async function clearPhoneDnc(
  tenantId: number,
  phone: string | null,
  options?: {
    customerId?: number | null
    source?: string | null
    note?: string | null
  }
) {
  await ensureDncTable()

  const normalized = normalizePhone(phone)
  if (!normalized) return { ok: false, reason: "missing_phone" }

  await pool.query(
    `
    insert into customer_contact_flags
      (tenant_id, customer_id, phone, is_dnc, source, note, created_at, updated_at)
    values
      ($1, $2, $3, false, $4, $5, now(), now())
    on conflict (tenant_id, phone)
    do update set
      customer_id = coalesce(excluded.customer_id, customer_contact_flags.customer_id),
      is_dnc = false,
      source = excluded.source,
      note = excluded.note,
      updated_at = now()
    `,
    [
      tenantId,
      options?.customerId || null,
      normalized,
      options?.source || null,
      options?.note || null,
    ]
  )

  return { ok: true, phone: normalized }
}

export async function isPhoneDnc(tenantId: number, phone: string | null) {
  await ensureDncTable()

  const normalized = normalizePhone(phone)
  if (!normalized) return false

  const result = await pool.query(
    `
    select is_dnc
    from customer_contact_flags
    where tenant_id = $1
      and phone = $2
    limit 1
    `,
    [tenantId, normalized]
  )

  if (!result.rowCount) return false
  return Boolean(result.rows[0].is_dnc)
}
