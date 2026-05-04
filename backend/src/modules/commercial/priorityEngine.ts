export function calculateCommercialPriority(target: any) {
  let score = 0;
  const reasons: string[] = [];

  const category = target.contractor_category || "";
  const email = target.email || "";
  const phone = target.telephone || "";
  const services = String(target.raw_services || "").toLowerCase();
  const city = String(target.city || "").toLowerCase();

  if (category === "general_contractor") {
    score += 30;
    reasons.push("general contractor");
  }

  if (category === "building_contractor") {
    score += 22;
    reasons.push("building contractor");
  }

  if (category === "residential_contractor") {
    score += 10;
    reasons.push("residential contractor");
  }

  if (email && email.includes("@")) {
    score += 20;
    reasons.push("has email");
  }

  if (phone) {
    score += 8;
    reasons.push("has phone");
  }

  if (
    services.includes("commercial") ||
    services.includes("building") ||
    services.includes("construction") ||
    services.includes("general")
  ) {
    score += 15;
    reasons.push("commercial/building services");
  }

  if (
    city.includes("tampa") ||
    city.includes("st petersburg") ||
    city.includes("clearwater") ||
    city.includes("lakeland") ||
    city.includes("orlando") ||
    city.includes("sarasota")
  ) {
    score += 10;
    reasons.push("priority market");
  }

  if (target.pipeline_status === "on_hook") {
    score += 50;
    reasons.push("on hook");
  }

  if (target.pipeline_status === "active") {
    score += 25;
    reasons.push("active");
  }

  if (target.do_not_contact) {
    return {
      score: 0,
      priority: "none",
      reasons: ["do not contact"],
    };
  }

  let priority = "low";

  if (score >= 70) {
    priority = "high";
  } else if (score >= 45) {
    priority = "medium";
  }

  return {
    score,
    priority,
    reasons,
  };
}
