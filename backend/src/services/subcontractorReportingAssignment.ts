/**
 * Reporting-only current assignment predicate.
 * Historical attribution and authorization remain separate.
 */
export const CURRENT_REPORTING_ASSIGNMENT_STATUS_SQL =
  "ca.status in ('PENDING', 'active')"
