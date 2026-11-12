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
6. Later sign-ins: after password check, display a six-digit verification field AND a returning-account QR. This QR opens the previously enrolled PashLoc account on the other device. It contains NO reusable TOTP secret, does not create a new enrollment, and does not authorize a session. Direct manual opening of PashLoc must also work.
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

## ATLAS 4.2 correction — mandatory acceptance scope (2026-11-12)
- First enrollment: Navigator displays the enrollment QR on the computer after password verification, before full-session issuance. The other device scans and opens PashLoc. Secure short-lived one-time handoff must never place reusable TOTP secrets in ordinary URL query strings, navigation logs, analytics or referrers. Enroll only with explicit account confirmation and server-side first-code verification.
- Returning login: display a different QR at EVERY MFA-protected login. It only identifies an already registered account for PashLoc to open. Missing local account must enter approved recovery, not silently enroll or disable MFA.
- Single-device enrollment requires a separate secure handoff. Never auto-approve based only on opening a QR/link.
- Real acceptance must include the physical phone and desktop, code rejection, expiry, replay prevention, limited retries, tenant isolation, account deletion, recovery, English/Spanish, and bypass prevention.
- All MFA enforcement remains disabled in production until independent Security Assurance approval and Chairman authorization.
