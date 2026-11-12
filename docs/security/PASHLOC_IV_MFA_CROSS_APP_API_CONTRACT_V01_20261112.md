# PASHLOC IV MFA — NAVIGATOR / PHONE API CONTRACT v0.1
**Date:** 2026-11-12  
**Owner:** Navigator Authentication Engineering  
**Recipients:** PashLoc IV MFA Engineering, Atlas, Security Assurance  
**Disposition:** PROPOSED, ENGINEERING REVIEW REQUIRED — NOT DEPLOYED OR APPROVED

## 1. Scope and authorities
Navigator is the single authority for Good2Go/Navigator credentials, MFA enrollment, authentication challenges, TOTP verification, session issuance, tenant/user binding, recovery, and audit. PashLoc IV MFA is a client-side encrypted TOTP vault, **not** an identity authority. The PashLoc phone app may never issue a Navigator session or approve its own enrollment. Original PashLoc and FOM are explicitly outside the scope of this Navigator contract.

Current work: `AcctMask/Contractor-Navigator`, branch `engineering/pashloc-iv3-isolated-mfa-v2-20261112`; PashLoc `AcctMask/pashloc-iv`, branch `feature/iv2-priority2-enrollment-20261112` (as confirmed against PashLoc PR #2 at commit `9b885648a63f2e3834ba570b10ada33c108fe7f7`). These endpoints and payloads are **proposed**, not existing live routes.

## 2. Normative security invariants
1. **Password first, no full session before MFA.** Once the per-user/tenant enforcement switch is approved and ON, a correct password produces only a restricted short-lived challenge. The regular `{ok:true,user,token}` response is issued only after enrolled-user verification or verified first enrollment; no JWT, storm launch token, invitation bypass, or other full-session issuer may bypass assurance.
2. **Feature OFF means original login unchanged**, but the future ON transition must inventory and gate *all* session issuance and already-issued sessions; production activation is not authorized by this document.
3. **QR contains only an opaque 256-bit pairing reference** (`mode=enroll&issuer=Navigator&pairing=<43-character-base64url>`), never a TOTP secret, password, JWT, complete MFA challenge or private key.
4. Pairing reference possession alone may **claim**, but never approve, redeem, register, or log in. Claimant must demonstrate proof of the phone-held private key; a claimant credential is not sufficient if copied to another device.
5. Original Navigator browser must approve a specific phone claimant using a **separate user-verified confirmation**. The QR's public data alone must not count as confirmation.
6. Redeem at most once after explicit browser approval, using key possession, approved confirmation, fresh nonce, and bounded expiration. Enrollment becomes confirmed **only after a correct six-digit TOTP from the phone**, atomically consuming the challenge and recording the accepted TOTP step.
7. Server uses encryption-at-rest with separate key custody; cross-device delivery uses a key-bound authenticated envelope to the claimed phone over TLS. Do not store/send secrets in URLs, logs, analytics, browser history, or third-party QR renderers.
8. No automatic re-enrollment for an existing confirmed account; recovery/reset is separately audited, authorized, rate limited and tested.

## 3. Suggested URL and browser ↔ phone roles
- Navigator Mac browser displays an enrollment QR linking to `https://<approved-pashloc-origin>/?mode=enroll&issuer=Navigator&pairing=<pairing_ref>`.
- Returning login QR points to `?mode=open&issuer=Navigator&account=<stable_opaque_account_id>`. It selects the **existing local account** only; no secret transfer or new enrollment.
- Approved PashLoc origin and the backend API origin must be fixed through reviewed config, strict CORS and allowed Origin/Referer policies, not user-provided endpoints.
- Browser challenge proof lives in an ephemeral, HTTP-only SameSite=Strict browser-bound cookie tied to a server record; the browser does not receive the TOTP secret and must not put the restricted challenge in a URL or localStorage.
- If strict cross-origin restrictions prevent the architecture, adopt a same-site Navigator BFF/proxy endpoint reviewed by Security Assurance, not open CORS.

## 4. API contract (all endpoints NEW / PROPOSED)
All JSON responses set `Cache-Control: no-store`, `Pragma: no-cache`, `X-Content-Type-Options: nosniff`, redact sensitive inputs in application/API logs and disable analytics on enrollment endpoints. All mutation requests require `Content-Type: application/json`, strict origin verification as applicable, server-side rate limits and idempotency rules; errors expose no TOTP secret or unapproved cross-tenant identity data.

### 4.1 Password entry
`POST /auth/:tenantSlug/login` — existing route, proposed MFA-enabled response **only when enforcement is ON**.

Request: `{"email":"person@example.com","password":"..."}`.

- Existing MFA-OFF response: `{"ok":true,"user":{...},"token":"<full-jwt>"}` (must remain unchanged).
- Proposed MFA-ON response (HTTP 200): `{"ok":true,"mfa_required":true,"flow":"enroll"|"verify","expires_at":"<ISO-8601>"}`. Server sets a short-lived restricted challenge cookie bound to the specific tenant/user/browser; no `token` or full user object. The browser gets an opaque one-time CSRF token through a separate no-store channel/response if required. Never authenticate downstream services on `mfa_required`.
- Incorrect credentials: the existing generic failure (and rate limit); no enrolled/not-enrolled user enumeration before password success.
- **Dependency:** existing `authService.loginUserByTenantSlug` signs a JWT after password; this must be refactored before ON. Existing accept-invite and alternate issuers also need an explicit step-up/gate analysis.

### 4.2 Start browser pairing
`POST /auth/mfa/enroll/pair` — **restricted browser only**, challenge cookie + CSRF + active tenant-user binding.

Request: `{}`  
Response 201: `{"ok":true,"pairing_ref":"<43-char-base64url>","expires_at":"<ISO-8601>","qr_url":"<PashLoc-url>"}`.
Server creates a pending enrollment *transaction* for the correct tenant/user; session cannot be completed until first TOTP succeeds. Maximum 1 active pairing per challenge; creating a replacement revokes the prior pairing. Pairing TTL **180 seconds**, never later than browser challenge expiration **300 seconds**. Server creates or obtains a securely encrypted pending secret **only once** for this enrollment and binds it to the active challenge.

### 4.3 Phone device claim
`POST /auth/mfa/device/claim` — **PashLoc phone**, no Navigator full JWT.

Request:
```json
{"pairing_ref":"<43-char-base64url>","device_public_key_jwk":{"kty":"EC","crv":"P-256","x":"<base64url>","y":"<base64url>"},"device_label":"PashLoc IV MFA"}
```
Phone generates a fresh non-extractable P-256 key pair using WebCrypto, keeping the private key on that device during the transaction. Device public key JWK is checked for type/curve and proof-of-possession later. Server first-claim-wins atomically and records the public-key fingerprint as part of the pairing state.

Response 201:
```json
{"ok":true,"claim_id":"<opaque-id>","claimant_proof":"<one-time high-entropy credential>","confirmation_code":"<user-readable randomly generated short code>","expires_at":"<ISO-8601>","account":{"issuer":"Navigator","label":"Navigator account"}}
```
Response includes only **non-identifying generic label** until browser confirmation. Avoid returning email/tenant/user-identifiable data on possession of a stolen QR. Phone displays confirmation code; user types the same code in original Navigator browser (or performs equivalent authenticated visual comparison). `claimant_proof` is kept in phone memory, not URLs, and never presented as the sole authorization for secret release.

State after success: `PAIRING_CLAIMED`. Repeated scans are 409 `already_claimed` unless an approved re-claim or restart process occurs. Expired: 410 `expired`. Invalid/unknown: uniform 404 `unavailable`. Rate limit attempts at source + pairing + tenant boundary.

### 4.4 Browser claim review and explicit approval
`GET /auth/mfa/enroll/claim` — **restricted original browser** with challenge cookie.

Response if claimed:
```json
{"ok":true,"status":"claimed","claim_id":"<opaque-id>","device_label":"PashLoc IV MFA","expires_at":"<ISO-8601>"}
```
Never return claimant proof, private key or TOTP secret. Response before claim: `{"ok":true,"status":"waiting"}`.

`POST /auth/mfa/enroll/approve` — **restricted original browser**, CSRF protected.

Request: `{"claim_id":"<opaque-id>","confirmation_code":"<code-physically-read-from-phone>","approve":true}`.

Server verifies same browser challenge/tenant/user, compares a **hashed server-side confirmation code**, limits incorrect attempts, ensures approved device key matches original claim, enforces one-time approval and emits auditable event. If `approve:false`, revoke pairing without secret disclosure. Successful response: `{"ok":true,"status":"approved","expires_at":"<ISO-8601>"}`.

IMPORTANT: Existing isolated approval function currently requires the 43-character claimant token, *not* the short confirmation code; it must be revised before any endpoint is exposed. No phone self-approval.

### 4.5 Device possession + approved one-time redemption
`POST /auth/mfa/device/redeem-challenge` — **PashLoc phone**.

Request: `{"pairing_ref":"<43-char-base64url>","claim_id":"<opaque-id>","claimant_proof":"<opaque-credential>"}`  
Response: `{"ok":true,"nonce":"<random 256-bit base64url>","expires_at":"<short ISO-8601>"}`.

`POST /auth/mfa/device/redeem` — **PashLoc phone**.

Request:
```json
{"pairing_ref":"<43-char-base64url>","claim_id":"<opaque-id>","claimant_proof":"<opaque-credential>","nonce":"<nonce>","device_signature":"<base64url ECDSA P-256 SHA-256 signature>"}
```
The canonical signature input is exact ASCII bytes `PASHLOC-IV-MFA-REDEEM-v1\n<claim_id>\n<pairing_ref>\n<nonce>`; server validates key possession against the approved stored public key, verifies claimant proof, approved state, bounded expiry, nonce one-time-use and absence of prior redemption in one transaction. **No redemption based solely on the QR reference + claimant credential.**

After successful atomic redemption, server returns encrypted transfer data to the phone:
```json
{"ok":true,"status":"redeemed","account":{"issuer":"Navigator","account_id":"<stable tenant-scoped opaque ID>","label":"Navigator · <account>"},"credential_envelope":{"version":"v1","cipher":"<reviewed device-key-bound AEAD scheme>","payload":"<base64url ciphertext>"}}
```
**Cryptography design hold:** P-256 ECDSA signing keys must NOT be reused for ECDH key agreement. Secure envelope must use a *separate* ephemeral ECDH P-256 key pair and HKDF-SHA256-derived AES-256-GCM key, with authenticated account/tenant/claim transcript as AEAD AAD, or use HPKE (if supported). Exact JWK fields, KDF `info`, AAD, nonce, transcript encoding, envelope serialization and key erasure require joint review and test vectors before engineering implements secret delivery. The JSON above is a **logical contract placeholder**, NOT a ready-to-implement wire format. Do **not** return a plaintext secret pending that approval. No at-rest full secret should ever be exposed in phone-accessible logs.

### 4.6 First-code confirmation
`POST /auth/mfa/enroll/confirm` — **restricted original browser**, CSRF protected.

Request: `{"code":"<6 decimal digits>"}`.  
Response 200 after validated, redeemed, tenant-bound enrollment and atomic TOTP replay state update: `{"ok":true,"user":{...},"token":"<full-navigator-jwt>"}`. Navigator is the only issuer. The browser enters the authenticated CRM only after verification. On invalid code: `{"ok":false,"error":"invalid_code"}` (HTTP 401); no JWT. Five attempts per browser challenge; recovery and restart rules apply. Server resolves challenges and pairing internally using restricted cookie; never require browser to possess phone claimant token. Existing `confirmPashLocFirstCode` currently requires claimant token and cannot be mounted as this endpoint without refactoring.

### 4.7 Returning-user login
Password success with `flow:"verify"` then: `GET /auth/mfa/account-link` (restricted browser only) returns `{"ok":true,"account_id":"<stable opaque-id>","open_url":"<PashLoc URL with mode=open, issuer=Navigator, account=<id>>"}`. UI displays QR; scanning opens local saved account; no new secret generated. PashLoc user copies current six-digit code. `POST /auth/mfa/verify` request `{"code":"123456"}`, restricted browser + CSRF; uses transaction-locked challenge and enrollment replay state, then server alone issues regular JWT. Invalid/replayed code: 401 `invalid_code`; after fifth attempt challenge exhausted and new password login required.

### 4.8 Recovery and aborted flows
- `POST /auth/mfa/enroll/cancel` (restricted browser + CSRF): revoke pairing and pending challenge; if a phone secret was redeemed, server also invalidates the pending enrollment. Phone must not regard locally retained enrollment as authorized until first-code confirmation.
- `POST /auth/mfa/recovery/initiate`: route to separately approved, audited recovery; **must not** permit unauthenticated reset from pairing-ref or email alone. Loss of local browser vault requires actual identity re-verification and authorized administrative reset or tested one-time backup code.
- Device deletion within PashLoc never disables Navigator MFA. Existing confirmed enrollment must remain in server custody until explicitly revoked via audited recovery. A re-enrollment flow requires independent owner/admin authorization; do not automatically overwrite a confirmed account.
- Interrupted `redeem` requires explicit, documented idempotency/abort semantics: never issue secret to another claimant on retry; allow only same validated claimant while unexpired, with replay-safe envelope retrieval or controlled restart. The current schema cannot support this fully without additional fields.

## 5. Server state transitions
```text
PASSWORD_VALIDATED (restricted challenge, 300 s)
  ├─ enrolled account → VERIFY_CODE → MFA_SUCCESS → JWT
  └─ not enrolled → ENROLLMENT_PENDING
                      → PAIRING_ISSUED (180 s or sooner)
                      → PHONE_CLAIMED (first claimant)
                      → BROWSER_APPROVED (separate short-code confirmation)
                      → DEVICE_PROVEN (ECDSA challenge)
                      → SECRET_REDEEMED (one-time authenticated encrypted transfer)
                      → FIRST_CODE_VERIFIED (atomic, single-use)
                      → MFA_SUCCESS → JWT
```
At every step, expiry/revocation/attempt exhaustion transitions to **DENIED/CANCELLED**, never automatic password-only access. Phone can *request* claim and redeem; only Navigator authorizes.

## 6. Current implementation versus required revisions
- Present in isolated Navigator branch: short-lived hashed restricted challenge; pairing issuance; first-claimant token; approval query; encrypted pending enrollment; TOTP confirmation/returning verification and deep-link builders.
- **Not yet implemented:** these API routes; HTTP-only restricted challenge cookies; CSRF; ECDSA device proof; secure ECDH/HPKE envelope; durable nonce/idempotency; audited recovery; activation gates; multi-path JWT enforcement; Mac/phone E2E.
- Current `pashloc_mfa_pairings` schema needs additional immutable device signing public key, confirmation hash, attempt count, nonce digest/expiry/consumption, encrypted redemption replay envelope (if idempotency is chosen), status/revocation, and strict session binding. Migration is **draft only** and must be independently reviewed.
- Existing service helpers **must not be mounted directly** because a claimant proof token is not independent visual confirmation and no device cryptographic proof exists yet.
- Current backend `authService.loginUserByTenantSlug()` issues a full seven-day JWT immediately on password success. An MFA-ON code path must deliberately interpose restricted challenge *before* full-JWT issuance, including invitation acceptance and any other token issuance path. No changes to production until isolated proof, Atlas + Security Assurance approval, Chairman authorization.
- Known frontend deep-link contract uses `mode` not `type`; `pashLocReturningAccountUrl` in isolated Navigator already reflects this.

## 7. Standard error responses (proposed)
```json
{"ok":false,"error":"unavailable"}
{"ok":false,"error":"expired"}
{"ok":false,"error":"already_claimed"}
{"ok":false,"error":"not_approved"}
{"ok":false,"error":"invalid_confirmation"}
{"ok":false,"error":"invalid_device_proof"}
{"ok":false,"error":"invalid_code"}
{"ok":false,"error":"attempts_exceeded"}
{"ok":false,"error":"recovery_required"}
```
Use 400 malformed request, 401 failed independent credential, 403 forbidden state, 404 unavailable without identity leakage, 409 existing conflicting claim, 410 expired, 429 throttled. Error messages must be generic for untrusted callers and carry no identifiable tenant/user existence data.

## 8. Security acceptance and release
- **Required tests:** first registration with correct phone, fail/expire/retry, QR theft/race, claimant swapping, browser substitution, cross-tenant mixing, disclosure/URL/log checks, duplicate signup, retry after redemption, first-code incorrect and replayed, returning-account QR, vault deletion/lost device, staff/admin recovery, token issuance bypass incl. invite/storm paths, existing-session transition, feature-OFF unchanged.
- GitHub CI success and physical Mac-to-phone E2E must be demonstrated; passing earlier isolated TOTP checks alone is insufficient.
- No live merge, migration, activation or Plaid security attestation from this draft. Security Assurance reviews protocol details and implementation; Atlas reviews integration authority; Chairman approves production enforcement.
- Notice to Chad, Michelle and Kent is mandatory advance communication, **not voluntary enrollment**. Enrollment becomes mandatory for everyone upon authorized activation.

## 9. Joint handoff decisions and implementation order
**PashLoc engineering:** implement device key generation/persistence for *pending pairing only*, claim screen, separate confirmation-code display, PashLoc UI for pending redemption. Do not implement actual secret retrieval until envelope crypto wire format is approved; preserve vault and existing account behavior.

**Navigator engineering:** review existing token issuance bypasses, add draft schema for device keys, approval confirmation and redemption nonce, implement isolated restricted cookie/CSRF and claim/approval status endpoints without secret release, build tests for claiming and claimant substitution.

**Security Assurance / Atlas:** agree exact ECDH+HKDF+AES-GCM envelope format, domain allowlists, recovery, challenge-cookie strategy, throttles, key lifecycle and fallback/rollback prior to enabling cross-app secret exchange.

**Chairman:** no user action required for this contract, unless reviewing/amending protocol; final activation reserved.

**NONNEGOTIABLE:** REGISTRATION ONCE; VERIFICATION THEREAFTER. NO LOCKOUTS. NO AUTHENTICATION BYPASS. PROOF BEFORE CLAIM.
