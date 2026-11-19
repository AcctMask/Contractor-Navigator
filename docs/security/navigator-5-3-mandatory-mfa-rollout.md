# Navigator 5.3 — mandatory MFA rollout engineering gate

Status: ENGINEERING ONLY. No production deployment or additional user activation authorized by this branch.
Protected baseline: `navigator-5.2-pashloc-iv-production-hard-save-20261119` (production commit `ea647535a5e8975e97a55ae8c6b9172184d5634c`).

## Observed Good2Go production inventory (2026-11-19)
- Tenant 1, 12 total accounts: 10 active, 2 inactive.
- Active: user 3 (platform_owner) has `navigator_mfa_required=true`, epoch 1, one proof-verified active device.
- Active and not enforced: users 1, 2, 12, 13 (admin); 7 (manager); 8, 9, 10, 11 (subcontractor). All nine have zero proof-verified active devices.
- Inactive: users 4 and 6. Do not enable access or count them as protected.
- Scope beyond Navigator/tenant 1 requires independent Security Assurance determination; do not attest enterprise-wide coverage.

## Existing source boundaries
- `backend/src/routes/auth.ts`: authenticated self-service signed enrollment currently requires `navigator_mfa_required=false`.
- `backend/src/services/navigatorSignedMfa.ts`: enforced login requires signed challenge; no device yields `enrollment_required`.
- `backend/src/routes/navigatorSignedMfa.ts`: signed registration, challenge, decision and completion.
- `backend/sql/navigator_signed_mfa_admin_recovery.psql`: Chairman-specific recovery, not a general-user recovery API.

## Implementation acceptance contract
1. Add a tenant-admin-owned required-MFA policy, with immutable policy/audit evidence. Only authorized tenant admins may change tenant policy; target tenant comes from authenticated server context, never browser-provided IDs.
2. On first login for an active, in-scope user without a verified device, issue only a restricted short-lived enrollment capability after password verification. Never issue normal Navigator session or operational API access until signed approval succeeds. Prevent indefinite bypass.
3. After cryptographically proof-verified registration, atomically enforce account MFA, increment epoch, revoke stale grants/sessions, audit actor/account/tenant/policy version. Future accounts and reactivated accounts inherit required policy before first operational access.
4. Preserve already-enforced user 3, existing iPhone binding, JWT secret, workspace switching, and all tenant isolation.
5. Implement authorized account-specific recovery/revocation with audit, limited privileges, epoch invalidation and no permanent password-only bypass. Verify backup/alternate recovery before activating additional users.
6. Test with disposable tenants/users: unregistered first login, verified enrollment, signed subsequent login, password-only rejection, replay/expiry, device revocation, recovery, inactive/reactivated, new invitation, concurrent enrollment, role checks, cross-tenant isolation, and rollback.
7. Before deployment: security review, CI evidence, explicit Chairman approval for production rollout, per-account exception log. Never bulk-enable unregistered users with the pilot SQL.

## Deployment gates
- No changes to live accounts or production infrastructure until all tests pass and Chairman approves the deployment.
- Security Assurance separately defines Plaid assessment scope and evidence expectations.
- Preserve PR #9 as pilot activation/recovery evidence; do not merge it merely to enable workforce MFA.
