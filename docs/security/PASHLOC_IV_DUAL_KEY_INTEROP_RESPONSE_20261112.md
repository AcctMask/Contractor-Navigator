# Navigator 4.3 / PashLoc IV — Dual-key interoperability response (2026-11-12)

**Status:** Isolated engineering interoperability; NOT security approval, end-to-end success, or production activation.

## Verified inputs
PashLoc branch `feature/iv2-priority2-enrollment-20261112`, commit `06e3e14f5dfc8e50d3a6877c34ed54674dfeab22` reports completed GitHub Action #43306642451. Navigator inspected the source files `device-crypto.js`, `app.js`, `tests/device-crypto.cjs`, and `tests/phone-claim.cjs`. PashLoc's crypto unit test demonstrates Node/WebCrypto interoperability; phone-claim test uses a mock server and is **not** a live Navigator exchange.

## Accepted engineering corrections
1. Device claim accepts **both** `device_public_key_jwk` (P-256 ECDSA) and `device_ecdh_public_key_jwk` (separate P-256 ECDH). Each is validated as a public point; immutable first-claim database update stores both JSON JWKs and their canonical field fingerprints.
2. The envelope returned by future redemption is exactly `{version,ephemeral_public_key_jwk,nonce,ciphertext,tag}`, with version `pashloc-iv-ecdh-hkdf-aesgcm-v1`. No `cipher/payload` placeholder.
3. The current v1 derivation context is the UTF-8 bytes of JSON.stringify in key order `{v:1,app:"Navigator",pairing:<sha256-hex>,tenant:<integer>,user:<integer>,account:<stable-id>}`. HKDF salt is raw bytes of pairing SHA-256 digest; HKDF info and AES-GCM AAD are those identical JSON bytes. These details are **interop confirmed, not security approved**.
4. The phone sends P1363-encoded ECDSA-SHA256, base64url. Claim signing transcript is `PASHLOC-IV-MFA-CLAIM-v1\n<pairing_ref>\n<proof_nonce>`, redeem signing transcript is `PASHLOC-IV-MFA-REDEEM-v1\n<claim_id>\n<pairing_ref>\n<nonce>`.
5. PashLoc holds its ECDSA signing and ECDH keypairs separately as non-extractable private keys.

## CRITICAL security decision — key-substitution at claim
The current v1 **claim** transcript does not include a hash of the ECDH public key. A signed claim proof can be paired with a different agreement key if a threat actor can alter the request before the atomic server write. First-claim immutability prevents **later** substitution but alone does not authenticate the originally submitted ECDH key.

**Recommended v2 resolution (joint approval required):** Sign a canonically serialized transcript binding *both* public JWK coordinates, pairing_ref and proof_nonce under a domain-separated versioned prefix. Include signed-key and ECDH-key fingerprints in redeem context and delivery AAD. Update PashLoc's phone signing implementation, Navigator signature verifier, test vectors, and envelope version **together**. Do not silently switch the v1 signature transcript without PashLoc coordination. No genuine credential redemption authorized until Security Assurance decides this issue.

## Wire/API alignment
Phone:
- POST /auth/mfa/device/claim-challenge `{pairing_ref}` -> `{ok,proof_nonce,expires_at}`
- POST /auth/mfa/device/claim `{pairing_ref,proof_nonce,proof_signature,device_public_key_jwk,device_ecdh_public_key_jwk}` -> `{ok,claim_id,claimant_proof,confirmation_code,expires_at}`
- POST /auth/mfa/device/redeem-challenge — NOT YET IMPLEMENTED
- POST /auth/mfa/device/redeem — NOT YET IMPLEMENTED; encrypted envelope only, pending approved key binding, idempotency and retry rules

Restricted original Navigator browser:
- POST /auth/mfa/enroll/pair — NOT YET CONNECTED
- GET /auth/mfa/enroll/claim — NOT YET CONNECTED
- POST /auth/mfa/enroll/approve — NOT YET CONNECTED
- POST /auth/mfa/enroll/confirm — NOT YET CONNECTED
- GET /auth/mfa/account-link — NOT YET CONNECTED
- POST /auth/mfa/verify — NOT YET CONNECTED

### Important browser-session boundary
Any browser approval must derive challenge, tenant, user and pairing from a restricted HttpOnly browser-bound session and verify CSRF. It **must not** trust `tenantId`, `userId`, `challengeId` or caller-supplied headers as authentication. No full Navigator JWT before completed first-code confirmation. Preserve MFA-OFF existing production behavior, and audit invite/storm/alternate token paths before ON.

## Redemption idempotency decision needed
If an approved device redeems but the HTTPS response is lost, repeated delivery may occur only after proving the **same signing key and claimant** and receiving **the exact same encrypted envelope**, with bounded expiry and replay audit. A fresh envelope or substitute ECDH key without a new transaction is prohibited. An interrupted or expired claim must follow controlled restart/recovery. Proposed replay ciphertext storage requires protected encryption at rest; not yet approved or implemented.

## Deployment and acceptance blockers
- Isolated database migration **not applied**, isolated backend HTTPS origin **not established** or tested.
- Original-browser restricted session not implemented. Claim endpoints are gated in nonproduction by runtime flags and approved phone origin, but not yet live.
- Existing phone claim endpoint requires separate PashLoc origin and per-process preliminary rate guard; shared network throttles, CORS and explicit backend authorization remain to be reviewed.
- Security Assurance has **not** approved real secret delivery.
- No real Mac → phone → browser approved enrollment or returning-login test has passed.
- Not merged into main; mandatory production MFA remains off.

**Required next joint response:** Security Assurance approval or amendment of v2 dual-key proof, context and retry rules; then Navigator restricted browser login route and isolated HTTPS backend, followed by phone redemption code and physical-device acceptance.
