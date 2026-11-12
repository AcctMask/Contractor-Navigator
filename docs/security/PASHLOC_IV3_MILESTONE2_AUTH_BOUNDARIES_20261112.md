# PashLoc IV3 — milestone 2 authentication boundaries and implementation gates
Date: 2026-11-12
Branch: engineering/pashloc-iv3-isolated-mfa-v2-20261112
Status: SOURCE REVIEW / CONTRACT; NOT IMPLEMENTED; MFA OFF

## Explicit owner scope
Login enhancement ONLY. No modification to CRM, job intake, notes, messages, AI, storm integration, FOM, role/financial permissions, unrelated user administration or production deployment.

## Reviewed current source
backend/src/services/authService.ts
- signToken() at ~137 produces full 7-day JWT.
- acceptInvitation() at ~641 calls signToken() at ~747.
- loginUserByTenantSlug() at ~766 calls signToken() at ~819 after bcrypt validation.
- getCurrentUserFromToken() at ~865 verifies token and loads active tenant-bound user.
- changePasswordForUser() at ~1916 calls verifyToken(); review its entire behavior and all callsites before enforcement.
- JWT_SECRET has development fallback. Security Assurance to evaluate production configuration separately.

backend/src/routes/auth.ts
- /auth/accept-invite/:inviteToken at ~377 returns accepted token and sends existing notices. Preserve notifications and user provisioning exactly.
- /auth/:tenantSlug/login at ~471 calls loginUserByTenantSlug.
- /auth/storm-launch at ~115 requires existing bearer token, calls getCurrentUserFromToken, then issues HMAC-signed storm launch token. DO NOT alter storm-launch; verify upstream bearer token MFA assurance.
- /auth/change-password at ~484 uses bearer token.
- /auth/me at ~511 calls getCurrentUserFromToken.
- tenant user-management and password-reset endpoints require authorization review but must not be redesigned.

dashboard/src/lib/auth.ts
- login() and acceptInvite() currently persist only full JWT under contractor_autopilot_token.
- Never persist restricted pre-MFA challenge as a full JWT.
dashboard/src/pages/Login.tsx
- current password form navigates after login. Isolated MFA state will be additive, server-controlled, and off by default.

## Minimal contract proposal (requires joint PashLoc/Security Assurance approval)
- API response when policy OFF: existing {ok,user,token} unchanged.
- API response when policy ON after password: {ok:true,mfa_required:true,flow:'enroll'|'verify',challenge_id,expires_at}; NO full token.
- Challenge must be server-persisted, random, tenant/user/intent bound, short-lived, attempt-limited, single-use.
- Enrollment QR is a one-time opaque reference; PashLoc redemption must include verified device/user binding, explicit confirmation, encrypted local vault persistence, and server-side initial code proof. Mere possession of QR is not sufficient.
- Returning QR contains only stable opaque account selection identity, never enrollment material.
- Verify endpoint issues ordinary JWT only after atomic TOTP replay and challenge-consumption checks.
- Recovery and reset use separate restricted audited workflows, never permanent bypass.
- Backend standard bearer authorization must reject pre-MFA artifacts and handle legacy password-only sessions according to explicit rollout policy.
- Existing invitations must not issue full session for MFA-required users; maintain all existing invitation side effects and notifications.
- No live credentials, deployment, migration or enforcement until independent security review.

## Blocking open questions
1. Exact QR redemption device-binding protocol with PashLoc (QR capture/race threat).
2. Full repository-wide token issuer and middleware inventory, beyond the files directly inspected.
3. Session transition policy for pre-existing 7-day JWTs.
4. Recovery mechanism, administrator identity proof, and emergency rollback acceptance.
5. Cryptographic key custody and PashLoc origin stability.

## Milestone status
PASS: verified isolated source baseline and directly inspected primary token issuance and storm-launch behavior.
PASS: documented login-only scope and proposed handoff response contract.
NOT TESTED: secure QR redemption, server-side enforcement, recovery, physical-device tests, rollback.
NOT DONE: executable MFA implementation, integration with PashLoc, Security Assurance approval, production activation.
