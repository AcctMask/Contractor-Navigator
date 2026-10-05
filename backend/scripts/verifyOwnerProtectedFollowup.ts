import { createHash } from "crypto";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = resolve(__dirname, "..");

const schedulerPath = resolve(
  backendRoot,
  "src/services/followupScheduler.ts",
);

const baselinePath = resolve(
  backendRoot,
  "scripts/followupScheduler.owner.sha256",
);

const expected = readFileSync(baselinePath, "utf8").trim();

const actual = createHash("sha256")
  .update(readFileSync(schedulerPath))
  .digest("hex");

if (actual !== expected) {
  console.error("");
  console.error("OWNER-PROTECTED AI FOLLOW-UP CHECK FAILED");
  console.error("");
  console.error(
    "followupScheduler.ts differs from the Owner-approved baseline.",
  );
  console.error("");
  console.error(
    "Do not update the baseline hash unless Steve Pashoian has explicitly approved the AI Follow-Up change.",
  );
  console.error("");
  console.error(`Expected: ${expected}`);
  console.error(`Actual:   ${actual}`);
  process.exit(1);
}

console.log(
  "PASS: followupScheduler.ts matches Owner-approved baseline.",
);

const regression = spawnSync(
  "npm",
  ["run", "verify:followup-candidates"],
  {
    cwd: backendRoot,
    stdio: "inherit",
    shell: false,
  },
);

if (regression.error) {
  console.error("");
  console.error(
    "OWNER-PROTECTED AI FOLLOW-UP regression command could not execute.",
  );
  console.error(regression.error);
  process.exit(1);
}

if (regression.status !== 0) {
  console.error("");
  console.error(
    "OWNER-PROTECTED AI FOLLOW-UP behavioral verification failed.",
  );
  process.exit(regression.status ?? 1);
}

console.log("");
console.log(
  "OWNER-PROTECTED AI FOLLOW-UP CONTRACT VERIFIED",
);
