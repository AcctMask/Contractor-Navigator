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

  // Compare the complete street portions when city/state/ZIP is
  // embedded in either address field, with or without commas.
  // Require a recognized street suffix; never use a prefix match.
  const streetSuffixes = new Set(Object.values(suffixes));
  const streetPortion = (value: string): string | null => {
    const parts = normalizeWeatherAddress(value).split(" ");
    if (!/^\d+[a-z]?$/.test(parts[0] || "")) return null;
    const suffixIndex = parts.findIndex((part, index) =>
      index >= 2 && streetSuffixes.has(part)
    );
    if (suffixIndex < 0) return null;
    const remainder = parts.slice(suffixIndex + 1);
    // Reject street extensions before treating the remainder as locality.
    if (remainder[0] === "extension" || remainder[0] === "ext") return null;
    return parts.slice(0, suffixIndex + 1).join(" ");
  };

  const enteredStreet = streetPortion(entered);
  const storedStreet = streetPortion(stored);
  if (!enteredStreet || enteredStreet !== storedStreet) return false;

  // Compare locality evidence only when supplied on both sides.
  // Do not require ZIP, city, or state for street-only submissions.
  const locality = (value: string) => {
    const normalized = normalizeWeatherAddress(value);
    const street = streetPortion(value);
    const remainder = street ? normalized.slice(street.length).trim() : "";
    const zip = remainder.match(/\b\d{5}(?:-\d{4})?\b/)?.[0]?.slice(0, 5) || null;
    const tokens = remainder.replace(/\b\d{5}(?:-\d{4})?\b/g, "").split(/\s+/).filter(Boolean);
    const states: Record<string, string> = { fl: "florida", florida: "florida", ga: "georgia", georgia: "georgia" };
    const stateToken = tokens.find(token => states[token]);
    const state = stateToken ? states[stateToken] : null;
    const city = tokens.filter(token => !states[token]).join(" ") || null;
    return { zip, state, city };
  };

  const aLocal = locality(entered);
  const bLocal = locality(stored);
  for (const key of ["zip", "state", "city"] as const) {
    if (aLocal[key] && bLocal[key] && aLocal[key] !== bLocal[key]) return false;
  }
  return true;
}
