import bcrypt from "bcryptjs"
import { pool } from "./db/db"

const email = "steve@g2groofing.com"
const password = "Temp1234!"

async function main() {
  const hash = await bcrypt.hash(password, 10)

  const result = await pool.query(
    `
    update public.app_users
    set password_hash = $1
    where lower(email) = lower($2)
    returning id, email
    `,
    [hash, email]
  )

  if (!result.rowCount) {
    console.log("No app_user found for:", email)
  } else {
    console.log("Password reset for:", result.rows[0])
    console.log("Login with:", email, password)
  }

  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  await pool.end()
  process.exit(1)
})
