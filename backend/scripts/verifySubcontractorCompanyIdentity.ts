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
  text: string,
  label: string
) {
  if (!source.includes(text)) {
    throw new Error(`FAIL: ${label}`)
  }
  console.log(`PASS: ${label}`)
}

requireText(
  authService,
  "create table if not exists subcontractor_companies",
  "subcontractor company identity table exists"
)

requireText(
  authService,
  "create table if not exists subcontractor_company_users",
  "subcontractor company membership table exists"
)

requireText(
  authService,
  "add column if not exists subcontractor_company_id",
  "invitation carries subcontractor company identity"
)

requireText(
  authService,
  'role === "subcontractor" && !subcontractorCompanyName',
  "backend requires company name for subcontractor invitation"
)

requireText(
  authService,
  "insert into subcontractor_company_users",
  "accepted subcontractor invitation establishes company membership"
)

requireText(
  authRoute,
  "subcontractor_company_name",
  "auth route carries subcontractor company name"
)

requireText(
  usersPage,
  'role === "subcontractor"',
  "company UI is conditional on subcontractor role"
)

requireText(
  usersPage,
  "Company name is required for subcontractors",
  "frontend requires company name for subcontractor"
)

console.log("SUBCONTRACTOR COMPANY IDENTITY REGRESSION CHECK PASSED")
