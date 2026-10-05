type Specimen = {
  name: string;
  activeWorkflow: string | null;
  crmFlowKey: string | null;
  expected: boolean;
};

function schedulerCandidate(
  activeWorkflow: string | null,
  crmFlowKey: string | null,
): boolean {
  return (
    activeWorkflow !== null ||
    (
      crmFlowKey === "weather_evidence_report" &&
      activeWorkflow === null
    )
  ) && (
    activeWorkflow !== null ||
    crmFlowKey !== "ems_tarp_email_intake"
  );
}

const specimens: Specimen[] = [
  {
    name: "active workflow with NULL crm_flow_key",
    activeWorkflow: "contract_sent",
    crmFlowKey: null,
    expected: true,
  },
  {
    name: "EMS origin with contract_sent active workflow",
    activeWorkflow: "contract_sent",
    crmFlowKey: "ems_tarp_email_intake",
    expected: true,
  },
  {
    name: "EMS origin with tarp active workflow",
    activeWorkflow: "tarp",
    crmFlowKey: "ems_tarp_email_intake",
    expected: true,
  },
  {
    name: "EMS specialized flow without active workflow",
    activeWorkflow: null,
    crmFlowKey: "ems_tarp_email_intake",
    expected: false,
  },
  {
    name: "Weather Evidence without active workflow",
    activeWorkflow: null,
    crmFlowKey: "weather_evidence_report",
    expected: true,
  },
  {
    name: "no active or specialized workflow",
    activeWorkflow: null,
    crmFlowKey: null,
    expected: false,
  },
];

let failed = false;

for (const specimen of specimens) {
  const actual = schedulerCandidate(
    specimen.activeWorkflow,
    specimen.crmFlowKey,
  );

  const status = actual === specimen.expected ? "PASS" : "FAIL";

  console.log(
    `${status}: ${specimen.name} expected=${specimen.expected} actual=${actual}`,
  );

  if (actual !== specimen.expected) failed = true;
}

if (failed) {
  console.error("AI FOLLOW-UP CANDIDATE REGRESSION CHECK FAILED");
  process.exit(1);
}

console.log("AI FOLLOW-UP CANDIDATE REGRESSION CHECK PASSED");
