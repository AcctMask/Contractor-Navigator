import dotenv from "dotenv";
dotenv.config();

import pg from "pg";
const { Pool } = pg;

const connectionString =
  process.env.COMMERCIAL_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("No database connection string found");
}

export const commercialPool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
  // 👇 THIS LINE FIXES SUPABASE POOLER SSL ISSUE
  connectionTimeoutMillis: 10000,
});
