# PashLoc IV3 — isolated Navigator login enhancement: authentication inventory and contract v1
Date: 2026-11-12
Status: ENGINEERING DESIGN ONLY; MFA OFF; no production changes
Authority: Atlas 4.2 / Security Assurance review / Chairman final activation
Baseline: 09733d495eb854d32c6915deb36969f6907d3239
Branch: engineering/pashloc-iv3-isolated-mfa-v2-20261112

## Strict change boundary
Only Navigator authentication and login-specific UI, dedicated MFA persistence, and isolated tests may change. Do not change jobs, notes, intake, SMS, voice AI, outreach, CRM, FOM, roles, permissions, or unrelated user-management functions. Do not deploy, merge to main, change live flags, or activate MFA.

## Source-reviewed authentication paths
- backend/src/services/authService.ts: signToken() issues ordinary seven-day JWT; verifyToken() validates it; getCurrentUserFromToken() resolves application user.
- loginUserByTenantSlug() verifies tenant, active user and bcrypt password, then calls signToken(). This is the primary future password-to-restricted-challenge boundary.
- acceptInvitation() creates/updates user and calls signToken(). This is a second full-session issuance path and must not bypass a future MFA policy. Invitation acceptance behavior must remain unchanged until isolated implementation and testing.
- backend/src/routes/auth.ts exposes /auth/:tenantSlug/login and /auth/accept-invite/:inviteToken, plus /auth/me, change-password, administrative password-reset and storm-launch routes. These require route-specific authorization audit before enforcement.
- dashboard/src/lib/auth.ts persists full JWT to localStorage as contractor_autopilot_token; login() and acceptInvite() currently require a token. Restricted MFA challenges must NEVER be stored as application tokens.
- dashboard/src/pages/Login.tsx currently submits credentials and navigates immediately after successful login. Add an MFA state only behind an isolated disabled-by-default server policy.
- Existing JWT_SECRET fallback string in authService.ts requires Security Assurance configuration assessment; no secret rotation or production change authorized.

## Additional inventory still REQUIRED before implementation claims
Search every backend callsite of signToken(), jwt.sign(), verifyToken(), getCurrentUserFromToken(), bearer-token middleware and alternate/refresh issuance. Inspect storm-launch, invitations, reset, account deactivation, session renewal and direct API authorization. Verify seven-day legacy-token behavior under future MFA enforcement. This file is not an assertion that the inventory is exhaustive.

## Proposed secure cross-device protocol — requires PashLoc and Security Assurance agreement
1. Password verified on Navigator backend. If MFA policy is OFF, preserve current behavior exactly.
2. If MFA policy is ON for this user, issue only a random, short-lived, server-stored restricted challenge bound to tenant, user, intent, attempt budget and expiry. No full JWT yet.
3. First enrollment: Navigator Mac displays QR encoding an HTTPS handoff containing only a one-time opaque reference, NOT a reusable TOTP secret. Never activate Mac camera for display.
4. PashLoc phone unlocks local encrypted vault, shows tenant/account identity, obtains explicit user confirmation and redeems reference through an authenticated, time-limited, one-use exchange. Security review must establish how cross-device claimant is bound to the password-verified browser and how QR theft/racing is prevented before any live enrollment.
5. Server securely supplies enrollment material only after approved claimant binding; PashLoc persists account with stable random tenant/user-mapped opaque accountId. Server stores encrypted TOTP secret. No account is marked enrolled until first TOTP is independently verified and durable confirmation committed.
6. Returning login: Navigator displays six-digit entry and a distinct QR with ONLY stable account-selection identity (no secret and no authorization). PashLoc opens existing account; missing account goes to approved recovery, never silent reenrollment. Manual app selection must work.
7. Backend verifies 6-digit 30-second TOTP with bounded skew, per-challenge limits, atomic challenge consumption and atomic last-accepted-time-step replay prevention, then issues ordinary authorized JWT.
8. Recovery: single-use hashed recovery codes or approved equivalent, protected owner/admin reset, audit, notifications, reenrollment and rollback. Lost device/browser storage must not cause permanent lockout.
9. English and Spanish, physical Mac+phone, cross-tenant, expiry, race, replay, QR theft, one-device fallback and bypass tests required.

## Session policy decision REQUIRED before enforcement
Existing seven-day JWTs may predate enrollment/enforcement. Decide and test selective revocation versus step-up versus natural expiry; never treat a password-only JWT as MFA-verified. Existing production sessions must not be invalidated during development.

## Next engineering sequence
A. Finish exhaustive token issuer and authorization middleware inventory.
B. Coordinate precise handoff/redeem and accountId protocol with PashLoc engineering.
C. Obtain Security Assurance review of QR theft/race and vault/storage threat model before real credentials.
D. Implement dedicated off-by-default MFA state and recovery in isolated branch only.
E. Complete physical-device tests, rollback, and independent security review.
F. Seek separate Atlas and Chairman production rollout authorization.

## Evidence and limitations
This document records source-reviewed authService.ts, routes/auth.ts, dashboard/src/lib/auth.ts, dashboard/src/pages/Login.tsx and existing design-branch contract. It does not claim code implementation, migration, end-to-end integration, recovery testing, deployment or production activation.
