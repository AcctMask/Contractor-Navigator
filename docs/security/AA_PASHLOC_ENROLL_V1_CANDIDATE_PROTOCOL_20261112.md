# AA-PASHLOC-ENROLL-V1 — Candidate canonical cryptographic contract
**Status:** DRAFT for joint PashLoc / Security Assurance approval. No genuine secret transfer permitted.
**Authority:** Navigator authenticates and issues sessions; PashLoc is a separate device authenticator.
**Compatibility:** This is a NEW versioned protocol, not the previously tested PASHLOC-IV-MFA-CLAIM-v1 transcript. Both applications MUST change together.

## Encoding
- All protocol strings are UTF-8, Unicode normalization is not performed; identifiers must be ASCII in the allowed alphabets.
- All binary fields are unpadded RFC4648 base64url; reject noncanonical encodings.
- P-256 public JWKs are validated on-curve and reduced to **exactly** `{"kty":"EC","crv":"P-256","x":"<43-char b64url>","y":"<43-char b64url>"}` in that fixed order. Ignore no additional JWK properties for cryptographic input: reject unrecognized properties at API validation or explicitly whitelist known WebCrypto metadata.
- A public-key fingerprint is lowercase hex SHA-256 over UTF-8 of the above fixed-order JSON bytes.
- All transcript fields below are strict ASCII with explicit length and type validation; each field is separated by one LF (0x0a), no trailing LF.
- No security-significant serialization relies on arbitrary JS object key order. Build transcript strings in the specified fixed order.

## Claim proof
The phone supplies `pairing_ref`, `proof_nonce`, `device_public_key_jwk` (signing), `device_ecdh_public_key_jwk` (agreement), `proof_signature`, `protocol_version:"AA-PASHLOC-ENROLL-V1"`.

The signature covers the exact UTF-8 bytes of:
```text
AA-PASHLOC-ENROLL-V1/CLAIM
Navigator
<pairing_ref>
<proof_nonce>
<signing_key_fingerprint_hex>
<agreement_key_fingerprint_hex>
```
No trailing newline. Signing uses ECDSA P-256 SHA-256 with raw 64-byte IEEE-P1363 (r||s) signature encoded base64url. Server verifies signature against the supplied signing JWK and atomically consumes the server-issued nonce. The browser's authenticated challenge determines application, tenant and user; never trust these from phone fields.

The server binds the approved pairing row to both immutable public keys and fingerprints. The claim nonce expires in <=60 seconds, pairing <=180 seconds. The signed proof does not itself authorize credential redemption.

## Independent browser approval
Restricted HttpOnly Secure SameSite browser cookie, session-bound challenge and CSRF; browser confirms displayed 8-digit code and approved claim ID. Session derives tenant/user/application server-side. Approval never grants a full JWT. Browser and device each independently prove their respective authorization.

## Redeem proof (candidate)
```text
AA-PASHLOC-ENROLL-V1/REDEEM
Navigator
<claim_id>
<pairing_ref>
<server_redeem_nonce>
<signing_key_fingerprint_hex>
<agreement_key_fingerprint_hex>
```
ECDSA P1363 signature with approved signing key; redeem nonce server-generated, <=60s, single-use. Atomic DB transaction checks approved browser claim, device-key fingerprints, tenant/user/application and expiry. No secret released absent all gates.

## Credential envelope (candidate)
`{version:"AA-PASHLOC-ENROLL-V1",ephemeral_public_key_jwk,nonce,ciphertext,tag,context}`. P-256 ephemeral ECDH; HKDF-SHA256 output 32 bytes; AES-256-GCM 12-byte random nonce, 16-byte tag. The precise **context** byte serialization and binding to claim/keys must be independently approved before implementing redemption. Current legacy context from Node/WebCrypto tests is **not** approved for genuine redemption. No secret, pairing reference, or private key in QR/URL/log.

## Interrupted delivery
A lost response must not permit a second recipient, second approved enrollment or a new envelope for a different device. Candidate design: persist an encrypted, time-limited identical response envelope tied to the approved claim and signing key; allow bounded same-device retry only with fresh signed proof. Storage encryption, expiration, atomic transaction, and recovery require Security Assurance approval.

## Verification / gates
1. Positive claim with both correct keys; reject changed signing key, changed ECDH key, nonce replay and expiry.
2. Browser approval cannot be invoked with arbitrary tenant/user IDs; independent CSRF and cookie proof.
3. Claim alone and approval alone never disclose credential.
4. Isolated synthetic credential encryption/decryption, context alteration and wrong-device rejection.
5. Concurrent redemption at most one authorized enrollment, safe same-device interrupted retry.
6. First TOTP and returning-login verification against server-side account enrollment, tenant/application separation.
7. Lost device recovery cannot bypass MFA.
8. Physical Mac/phone test, backend CI, deploy source evidence.
All results must be PASS, FAIL, or NOT TESTED. Genuine secret transfer and production activation require separate approvals.
