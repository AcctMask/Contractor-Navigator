# NAVIGATOR 4.3 — PASHLOC IV MFA PER-LOGIN ENFORCEMENT ACCEPTANCE GATE
**Date:** 2026-11-12
**Status:** ISOLATED ENGINEERING REQUIREMENT — NOT PRODUCTION AUTHORIZATION
**Related contract:** docs/security/PASHLOC_IV_MFA_CROSS_APP_API_CONTRACT_V01_20261112.md

## Product naming and authority
The product is **PashLoc IV MFA**. The suffix IV3 refers to engineering handoff count, not a separate product. Original PashLoc is out of scope. Navigator 4.3 is the authentication authority for Navigator. FOM must independently implement its own server-side MFA gate.

## Non-negotiable invariant
**Registration once per (application, tenant, user) enrollment; verification on every new login, every user, every tenant.** No voluntary enrollment or remembered-browser MFA bypass after activation. Advance notification to Chad, Michelle and Kent is instructional only.

### First login
Password validated → no full JWT → restricted enrollment challenge → browser QR with opaque pairing ref → phone PashLoc IV MFA claims → original browser approves phone with independent confirmation → device proves possession of approved private key → reviewed one-time encrypted secret delivery → phone stores in encrypted vault → user enters six-digit TOTP into Navigator → Navigator atomically confirms enrollment and issues session.

### Every subsequent login
Password validated → no full JWT → new restricted verification challenge → browser displays QR `?mode=open&issuer=Navigator&account=<opaque account id>` → phone opens previously saved account (no pairing, no secret exchange, no reenrollment) → user copies current six-digit TOTP → Navigator verifies code against the *server-side* enrollment scoped to the exact app/tenant/user → challenge consumed atomically → only then issue JWT.

The QR never authenticates. If the phone cannot scan, manual account selection is permitted but the six-digit code is still required.

## Server-side acceptance requirements
1. Every full-session issuance path, including standard login, invitation acceptance, password reset flows, alternate JWT creation, storm launch dependencies, existing-session transition, and API routes, must be inventoried and gated appropriately when MFA enforcement is ON. Do not alter storm functionality or existing production flows during isolated work.
2. Existing MFA-OFF login behavior remains unchanged. No deployment, migration, policy flip or merge without Atlas, Security Assurance and Chairman authorization.
3. Use the enrollment key **(application_id, tenant_id, app_user_id)**. The existing draft schema uses only (tenant_id, app_user_id) and MUST be amended or its Navigator-only application scope explicitly proven and documented before FOM/multi-app reuse. Do not reuse one tenant's account identifier for another.
4. Stable opaque account_id is issued at enrollment and stored in PashLoc; returning QR uses exactly that account_id. Do not generate a fresh account_id or TOTP secret for returning logins.
5. Returning challenge TTL <=300 s, maximum 5 failed code attempts per challenge plus rate limits; accepted TOTP time step cannot be reused, including concurrent requests. Correct code cannot authenticate another tenant or another user.
6. Browser challenge cookie must be restricted, HttpOnly, Secure, SameSite as reviewed, scoped to origin and bound to transaction. Do not store restricted challenges as full JWTs or in localStorage.
7. Enrollment pairing TTL <=180 s; QR ref alone never permits secret redemption. Device private-key proof and independent browser approval required. Cryptographic envelope wire format must be reviewed before secret delivery.
8. Recovery/reset is independently authenticated, authorized and audited. Phone-side Delete Account does not revoke Navigator MFA. No unaudited fallback or bypass.
9. Error responses do not leak whether a user, tenant or enrollment exists to an unauthenticated caller. No secret in QR, URL, logs, analytics or third-party QR renderer.
10. Existing authenticated sessions must follow an explicitly approved transition strategy; no silent MFA-bypass continuation and no uncontrolled mass lockout.

## Required executable tests before release
- New user enrollment, first TOTP confirmation and full JWT only afterward.
- Same user logs out and logs in three times: fresh challenge and TOTP each time; no reenrollment.
- Returning QR opens correct saved PashLoc account; Copy Code and manual selection work.
- Two users in same tenant; same user across two tenants; cross-tenant and cross-user code substitution denied.
- Same person has Navigator and FOM enrollment: distinct application-scoped accounts and server verification.
- Invalid, expired and replayed codes; concurrent replay; attempts exhausted; expired QR; duplicate device claim; stolen pairing QR; browser substitution.
- Device lost, vault deleted, authorized recovery, interrupted enrollment, restart, and rollback.
- All session issuance paths, invitation acceptance, storm launch and existing-session transition: no MFA bypass.
- MFA feature OFF unchanged; CRM, Notes, parser, SMS, voice AI, FOM integrations and permissions unaffected.
- Actual Mac/browser → phone PashLoc IV MFA → code entry demonstration, plus CI typecheck and tests.

## Current implementation reality
Isolated helpers for challenge issuance, pairing, claim, approval, pending encrypted enrollment, first-code confirmation, returning-code verification and QR URL construction exist on this branch. These are **not wired to live login routes**, the approved phone secret envelope is not implemented, the draft schema is not applied, CI evidence is incomplete, and end-to-end testing is not complete. No production MFA activation is authorized.

## Next engineering order
1. Amend isolated schema/account key and review session issuance inventory.
2. Implement restricted browser challenge and returning-login server route on isolated branch, without activating it.
3. Implement QR rendering and returning account selection, keeping existing password login unchanged when feature OFF.
4. Coordinate PashLoc phone-side claim/confirmation with agreed API contract.
5. Finalize cryptographic envelope and recovery with Security Assurance; run automated and physical tests.
6. Submit evidence to Atlas, Security Assurance and Chairman for activation decision.

**REGISTRATION ONCE. VERIFICATION EVERY LOGIN. EVERY USER. EVERY TENANT. NO LOCKOUTS. NO BYPASS. PROOF BEFORE CLAIM.**
