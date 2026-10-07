import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const scriptFile = fileURLToPath(import.meta.url)
const scriptDir = path.dirname(scriptFile)

const authService = fs.readFileSync(
  path.resolve(scriptDir, "../src/services/authService.ts"),
  "utf8"
)

const authRoute = fs.readFileSync(
  path.resolve(scriptDir, "../src/routes/auth.ts"),
  "utf8"
)

const usersPage = fs.readFileSync(
  path.resolve(scriptDir, "../../dashboard/src/pages/Users.tsx"),
  "utf8"
)

function requireText(
  source: string,
  value: string,
  label: string
) {
  if (!source.includes(value)) {
    throw new Error(`FAIL: ${label}`)
  }

  console.log(`PASS: ${label}`)
}

requireText(
  authService,
  "sc.company_name as subcontractor_company_name",
  "user listing exposes subcontractor company"
)

requireText(
  authService,
  "updateManagedUserSubcontractorCompanyByTenantSlug",
  "managed subcontractor company service exists"
)

requireText(
  authService,
  'String(target.role) !== "subcontractor"',
  "backend restricts company management to subcontractors"
)

requireText(
  authService,
  "insert into subcontractor_company_users",
  "company management writes normalized membership"
)

requireText(
  authService,
  '"user_subcontractor_company_changed"',
  "company management records activity"
)

requireText(
  authRoute,
  '"/auth/:tenantSlug/users/:userId/subcontractor-company"',
  "managed company route exists"
)

requireText(
  authRoute,
  "requireTenantUserManager",
  "managed company route remains under tenant user management authority"
)

requireText(
  usersPage,
  'selectedUser.role === "subcontractor"',
  "company management UI only appears for actual subcontractor user"
)

requireText(
  usersPage,
  "saveManagedSubcontractorCompany",
  "company management UI saves through dedicated operation"
)

console.log(
  "MANAGED SUBCONTRACTOR COMPANY REGRESSION CHECK PASSED"
)
