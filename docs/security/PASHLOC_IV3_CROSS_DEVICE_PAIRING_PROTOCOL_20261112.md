# Navigator ↔ PashLoc IV3 — cross-device enrollment protocol, security gate
2026-11-12 | isolated engineering branch | DESIGN ONLY | MFA OFF

## Verified PashLoc state
AcctMask/pashloc-iv branch feature/iv2-priority2-enrollment-20261112, app.js:
- URL handler recognizes type=open with issuer=Navigator and opaque account, then selects existing local account by accountId.
- type=enroll currently reports "Navigator account enrollment is not connected yet. No account was added."
- PashLoc uses a browser-local encrypted vault; account deletion does not disable Navigator MFA.
- Manual TOTP and otpauth URI enrollment are available but DO NOT prove secure Navigator integration.
- README calls it an isolated test authenticator. Never use production credentials during this milestone.

## Protocol v1 proposal — must be reviewed by PashLoc and Security Assurance
1. Navigator verifies password. When feature OFF, preserve existing {ok,user,token} byte-for-byte contract. When ON, server creates restricted challenge C (random >=256-bit identifier; hash at rest; tenant/user/intent/expiry/attempts; not an application JWT). Login page remains unauthenticated.
2. Browser requests enrollment pairing for C. Server generates pairing P (random >=256-bit, 2-minute TTL, one-time), and an independent short human-readable confirmation code displayed ONLY on the password-verified Navigator browser. QR contains https://<approved-pashloc-origin>/?type=enroll&pair=<opaque-P>; never TOTP secret or full-session token.
3. PashLoc on phone opens QR, unlocks vault, displays Navigator tenant/account label supplied by server with minimal disclosure, and shows the pairing confirmation code from server. User compares phone code to the browser code and confirms BOTH devices. Browser must explicitly approve this specific pending PashLoc claimant using its original restricted challenge C. A stolen QR alone cannot approve pairing. Rate-limit and invalidate competing pairings. No secrets delivered until browser approval and phone consent are proven. Security Assurance must validate binding, origin, CSRF, replay and race details.
4. On successful pairing, Navigator generates random TOTP secret, stores encrypted under dedicated server-managed key with key version and unconfirmed status; returns enrollment material only to the approved phone claimant over TLS in a no-store response, never in URL, referrer, logs, analytics or third-party assets. PashLoc persists account encrypted and verifies durable local save before claiming success.
5. Navigator browser requests first six-digit TOTP code. Backend verifies against the same pending user/tenant, 30-second timestep with bounded skew and replay guard; atomically confirms enrollment and consumes challenge, then issues normal full JWT. A phone saving the secret alone does not activate MFA.
6. Returning login: password -> restricted challenge -> TOTP entry; optional QR https://<approved-pashloc-origin>/?type=open&issuer=Navigator&account=<stable-opaque-accountId> selects an existing account ONLY. QR does not enroll or authenticate. Missing account -> recovery.
7. Independent recovery: hashed single-use recovery codes issued only after enrollment; privileged identity-verified, audited reset; clear owner recovery; recovery does not silently disable MFA. Define and test before enabling any user.
8. No deployment or user pilot until physical Mac/phone test, multi-tenant separation, 7-day JWT transition, direct backend bypass checks, rollback and Security Assurance sign-off.

## API boundary draft (nonbinding)
POST /auth/:tenantSlug/login -> existing response if OFF; restricted {ok:true,mfa_required:true,flow,challenge_id,expires_at} if ON.
POST /auth/mfa/pair/start -> QR reference + browser-only confirmation.
POST /auth/mfa/pair/claim -> phone pending claimant, no secret.
POST /auth/mfa/pair/approve -> browser authorizes bound claimant.
POST /auth/mfa/pair/redeem -> approved phone receives secret once.
POST /auth/mfa/enroll/confirm -> first code, issue full session.
POST /auth/mfa/verify -> returning code, issue full session.
POST /auth/mfa/recovery -> restricted recovery.
All routes require precise tenant/user/challenge/claimant binding, no-store responses, strict CORS/CSRF controls, rate limits, auditing and idempotent atomic consumption.

## Integration decision gates
- PashLoc must agree on phone-side claimant proof and encrypted persistence before implementing pairing.
- Security Assurance must review threat model including screenshot/QR theft, multiple scanners, compromised browser, lost phone, localStorage loss, session theft, clock skew and server key rotation.
- Existing 7-day bearer tokens and invitation-acceptance tokens require explicit enforcement transition; no production policy changes authorized.
- Full repository-wide issuer search is not proven exhaustive: GitHub code search returned no indexed matches even for verified existing symbols; do not misrepresent negative search as absence. Directly reviewed files establish two known signToken callsites and separate storm HMAC launch token.
- No executable code, migration, test or deployment in this commit.
