/**
 * Supabase Postgres requires SSL.
 * On some environments, Node may throw:
 *   SELF_SIGNED_CERT_IN_CHAIN
 * We explicitly enable SSL and allow the chain by setting rejectUnauthorized:false.
 * (This is common for managed Postgres services behind poolers.)
 */
export declare const pool: import("pg").Pool;
//# sourceMappingURL=db.d.ts.map