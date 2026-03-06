import dotenv from "dotenv";
dotenv.config();
import pg from "pg";
const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error("DATABASE_URL is required (check backend/.env)");
}
/**
 * Supabase Postgres requires SSL.
 * On some environments, Node may throw:
 *   SELF_SIGNED_CERT_IN_CHAIN
 * We explicitly enable SSL and allow the chain by setting rejectUnauthorized:false.
 * (This is common for managed Postgres services behind poolers.)
 */
export const pool = new Pool({
    connectionString,
    ssl: {
        rejectUnauthorized: false,
    },
});
//# sourceMappingURL=db.js.map