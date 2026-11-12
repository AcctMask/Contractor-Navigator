# Navigator ↔ PashLoc IV MFA integration contract (DESIGN ONLY)

**Status:** Proposed; security assurance and owner activation pending. This branch MUST NOT alter production authentication.

## Authority and boundaries
- Navigator's existing username/password sign-in stays unchanged.
- After password validation but BEFORE granting a full authenticated Navigator session, Navigator's server must check tenant/user MFA enrollment and policy.
- Navigator's backend, not the browser and not PashLoc IV, owns MFA enrollment challenges, secret issuance, verification, replay prevention, recovery, and final session authorization.
- PashLoc IV is a separate TOTP authenticator. It may generate the six-digit code after securely enrolling an account; it never grants Navigator access.
- No production MFA activation, tenant policy change, or mandatory enrollment without independent Security Assurance acceptance and owner authorization.
- Implement English and Spanish UI using existing LanguageContext and shared workforceLanguage translations, respecting saved preferred_language.
- Existing users, roles, tenants, sessions, Navigator stages, and FOM behavior must not change during design or pilot.

## Intended UX
1. User submits existing Navigator credentials.
2. Navigator verifies credentials; creates ONLY a short-lived, restricted, server-bound MFA challenge (no application session yet).
3. If not enrolled, display:
   "Navigator now uses PashLoc IV multi-factor verification for added security."
   "Scan this QR code on another device to set up PashLoc IV, then enter the six-digit code below."
   QR includes a secure, time-limited enrollment handoff. It must not expose a reusable raw TOTP secret in a general-purpose browser navigation URL, analytics, referrer, or log.
   Offer "Using one device?" accessible alternative, plus recovery instructions.
4. PashLoc IV opens on the other device, explicitly confirms the requested Navigator account, and enrolls the protected account only after user consent and unlock.
5. Navigator verifies the six-digit code server-side, atomically marks enrollment complete, and issues the normal session.
6. Later sign-ins: after password check, display only six-digit verification (no new QR unless resetting enrollment).
7. Clear error, expiry, rate-limit, time-drift and recovery flows; never leak enrollment secrets to client-side logs.

## Security acceptance gates
- MFA cannot be bypassed by direct API calls, existing frontend routes, session refresh, or alternate login paths.
- Server challenge bound to user, tenant, session intent, expiry and attempt budget.
- TOTP secrets encrypted at rest using server-controlled keys; no shared tenant secret.
- Replay resistance: reject reused TOTP time steps per user, handle clock skew with bounded tolerance.
- Recovery uses approved, auditable, rate-limited process and does not silently disable MFA.
- Enrollment transfer must be secure across devices and cannot be claimed by another browser or user.
- Verify compatibility with Navigator existing authentication/session stack and production migrations.
- Security Assurance must explicitly approve threat model and PashLoc storage/enrollment design before any real account pilot.
- Rollout behind server-controlled disabled-by-default feature flag; limited opt-in pilot first, rollback proven.
- Tests: backend MFA bypass/replay/expiry/rate-limit, frontend English/Spanish, browser enrollment, phone camera, one-device fallback, accessibility, tenant isolation.

## Current scope
Design specification only. No implementation of Navigator sign-in hooks, backend MFA, migrations, enrollment QR, or real user pilot has been authorized as complete. PashLoc IV remains synthetic-only until acceptance.
