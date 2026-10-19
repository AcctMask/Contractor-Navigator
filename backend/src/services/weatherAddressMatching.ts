/**
 * Storm Verification address matching.
 * Does not alter stored addresses or existing Navigator workflows.
 */

const suffixes: Record<string, string> = {
  street: "st", st: "st",
  avenue: "ave", ave: "ave",
  road: "rd", rd: "rd",
  drive: "dr", dr: "dr",
  lane: "ln", ln: "ln",
  boulevard: "blvd", blvd: "blvd",
  court: "ct", ct: "ct",
  circle: "cir", cir: "cir",
  place: "pl", pl: "pl",
  terrace: "ter", ter: "ter",
  parkway: "pkwy", pkwy: "pkwy"
};

export function normalizeWeatherAddress(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(part => suffixes[part] || part)
    .join(" ")
    .trim();
}

export function weatherAddressesMatch(
  entered: string,
  stored: string
): boolean {
  const a = normalizeWeatherAddress(entered);
  const b = normalizeWeatherAddress(stored);

  if (!a || !b) return false;

  // Full normalized match is always acceptable.
  if (a === b) return true;

  // An entered street may omit city/state/ZIP.
  // Compare against the stored street portion only.
  const storedStreet = String(stored || "").split(",")[0];

  return a === normalizeWeatherAddress(storedStreet);
}
