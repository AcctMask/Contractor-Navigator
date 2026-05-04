export function includesAny(text: string, terms: string[]) {
  return terms.some(t => text.includes(t));
}

export function classify(row: any) {
  const name = (row.business_name || "").toLowerCase();
  const city = (row.city || "").toLowerCase();

  const westCentral = [
    "tampa","st petersburg","clearwater","largo","seminole",
    "bradenton","sarasota","new port richey","spring hill",
    "wesley chapel","lutz","riverview","lakeland","plant city"
  ];

  const far = [
    "miami","jacksonville","naples","fort myers","pensacola"
  ];

  const commercial = [
    "construction","contracting","builder","builders","group","services","development"
  ];

  const bad = [
    "handyman","kitchen","bath","window","door","floor","cabinet"
  ];

  let score = 0;

  if (includesAny(city, westCentral)) score += 30;
  if (includesAny(city, far)) score -= 50;

  if (includesAny(name, commercial)) score += 30;
  if (includesAny(name, bad)) score -= 40;

  if (row.email) score += 15;
  if (row.website) score += 10;

  let type = "unknown";
  let priority = "Needs Review";

  if (score >= 50) {
    type = "commercial_gc";
    priority = "Phase 1";
  } else if (score >= 25) {
    type = "commercial_likely";
    priority = "Phase 2";
  } else if (score < 0) {
    type = "not_fit";
    priority = "Deprioritized";
  }

  return { score, type, priority };
}
