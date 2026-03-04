import { pool } from "../db/db";

function normPhone(p: string): string {
  const s = String(p || "").trim();
  if (!s) return "";
  const cleaned = s.replace(/[^\d+]/g, "");
  if (!cleaned.startsWith("+")) {
    const digits = cleaned.replace(/[^\d]/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return digits ? `+${digits}` : "";
  }
  return cleaned;
}

export function classifyInboundText(text: string): {
  optOut: boolean;
  foul: boolean;
  reason?: string;
} {
  const t = String(text || "").trim().toLowerCase();

  // OPT-OUT / STOP variants (expand as needed)
  const optOutPhrases = [
    "stop",
    "unsubscribe",
    "no thanks",
    "do not contact",
    "dont contact",
    "don't contact",
    "remove me",
    "leave me alone",
    "wrong number",
    "already fixed",
    "already handled",
    "i have a new roof",
    "new roof",
    "quit",
    "cancel",
  ];

  const optOut = optOutPhrases.some((p) => t === p || t.includes(p));

  // FOUL LANGUAGE detection (lightweight for now; we can expand)
  const foulWords = ["f***", "shit", "bitch", "asshole", "fuck", "cunt"];
  const foul = foulWords.some((w) => t.includes(w));

  if (optOut) return { optOut: true, foul, reason: "opt_out" };
  if (foul) return { optOut: false, foul: true, reason: "foul_language" };

  return { optOut: false, foul: false };
}

export async function isDnc(tenantId: number, phone: string): Promise<boolean> {
  const p = normPhone(phone);
  if (!p) return false;
  const r = await pool.query(`select 1 from dnc where tenant_id=$1 and phone=$2`, [tenantId, p]);
  return !!r.rowCount;
}

export async function addDnc(params: {
  tenantId: number;
  phone: string;
  reason?: string;
  source?: string;
}): Promise<void> {
  const p = normPhone(params.phone);
  if (!p) return;

  const reason = params.reason || "opt_out";
  const source = params.source || "inbound";

  await pool.query(
    `
    insert into dnc (tenant_id, phone, reason, source)
    values ($1,$2,$3,$4)
    on conflict (tenant_id, phone)
    do update set reason=excluded.reason, source=excluded.source
    `,
    [params.tenantId, p, reason, source]
  );
}

export { normPhone };

