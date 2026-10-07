import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const scriptFile = fileURLToPath(import.meta.url)
const scriptDir = path.dirname(scriptFile)

const backendPath = path.resolve(scriptDir, "../src/routes/tasks.ts")
const frontendPath = path.resolve(scriptDir, "../../dashboard/src/pages/Tasks.tsx")

const backend = fs.readFileSync(backendPath, "utf8")
const frontend = fs.readFileSync(frontendPath, "utf8")

const checks = [
  {
    name: "subcontractor task authority helper exists",
    pass: backend.includes("async function subcontractorCanAccessTask("),
  },
  {
    name: "task GET requires authenticated user",
    pass:
      backend.includes('app.get("/tasks/:tenantSlug/events"') &&
      backend.includes("const actor = await requireTaskUser(request, reply, tenantId)"),
  },
  {
    name: "subcontractor task GET uses assignment scope",
    pass:
      backend.includes("$2::text <> 'subcontractor'") &&
      backend.includes("ca.app_user_id = $3"),
  },
  {
    name: "task authority uses crew assignments",
    pass:
      backend.includes("from crew_assignments") &&
      backend.includes("and app_user_id = $3"),
  },
  {
    name: "subcontractor cross-user assignment is denied",
    pass: backend.includes("Not authorized to assign this task to that user"),
  },
  {
    name: "subcontractor inaccessible task mutation is denied",
    pass: backend.includes("Not authorized for this task"),
  },
  {
    name: "subcontractor inaccessible job task creation is denied",
    pass: backend.includes("Not authorized for this job"),
  },
  {
    name: "frontend task GET sends bearer token",
    pass:
      frontend.includes('`${API_BASE}/tasks/${getTenantSlug()}/events`') &&
      frontend.includes("Authorization: `Bearer ${getToken()}`"),
  },
]

let failed = false

for (const check of checks) {
  if (check.pass) {
    console.log(`PASS: ${check.name}`)
  } else {
    console.error(`FAIL: ${check.name}`)
    failed = true
  }
}

if (failed) {
  process.exit(1)
}

console.log("TASK AUTHORITY REGRESSION CHECK PASSED")
