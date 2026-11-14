/** AA-PASHLOC-ENROLL-V1 isolated synthetic-only contract primitives.
 * Security Assurance Issue #3 permits ONLY synthetic test credentials.
 * No route, real account secret, production session or database mutation here.
 */
import { createHash, createPublicKey, createECDH, hkdfSync, randomBytes, createCipheriv, verify } from "node:crypto"

const V = "AA-PASHLOC-ENROLL-V1" as const
const VERSION = V
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest()
const ascii = (name: string, value: string, allowed: RegExp): Buffer => {
  if (typeof value !== "string" || !allowed.test(value)) throw new Error("Invalid " + name)
  return Buffer.from(value, "ascii")
}
const id = /^[A-Za-z0-9_-]{1,128}$/
const b64 = /^[A-Za-z0-9_-]{43}$/
const hex64 = /^[a-f0-9]{64}$/
const base64url = (raw: string, size: number) => {
  if(typeof raw!=="string" || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error("Invalid base64url")
  const buffer=Buffer.from(raw,"base64url")
  if(buffer.length!==size || buffer.toString("base64url")!==raw) throw new Error("Noncanonical base64url")
  return buffer
}
export type DevicePublicJwk = { kty: "EC"; crv: "P-256"; x: string; y: string }
export function normalizedP256PublicKey(value: unknown): DevicePublicJwk {
  if (!value || typeof value !== "object") throw new Error("Invalid JWK")
  const k=value as Record<string,unknown>
  if(k.kty!=="EC" || k.crv!=="P-256" || typeof k.x!=="string" || typeof k.y!=="string") throw new Error("Invalid JWK")
  // WebCrypto exportKey includes metadata; reject all unapproved JWK properties.
  for(const key of Object.keys(k)) if(!["kty","crv","x","y","key_ops","ext"].includes(key)) throw new Error("Unknown JWK field")
  if(k.key_ops!==undefined && (!Array.isArray(k.key_ops) || k.key_ops.length!==0)) throw new Error("Invalid public-key operations")
  if(k.ext!==undefined && k.ext!==true) throw new Error("Invalid JWK ext")
  base64url(k.x,32);base64url(k.y,32)
  const canonical: DevicePublicJwk={kty:"EC",crv:"P-256",x:k.x,y:k.y}
  const key=createPublicKey({key:canonical,format:"jwk"})
  if(key.asymmetricKeyType!=="ec" || key.asymmetricKeyDetails?.namedCurve!=="prime256v1") throw new Error("Invalid P-256 point")
  return canonical
}
export function publicKeyFingerprint(key: unknown): string {
 const k=normalizedP256PublicKey(key)
 return sha(Buffer.from(JSON.stringify(k),"ascii")).toString("hex")
}
export function claimTranscript(input:{pairingRef:string;nonce:string;signingKey:unknown;agreementKey:unknown}):Buffer {
 const sign=normalizedP256PublicKey(input.signingKey),ecdh=normalizedP256PublicKey(input.agreementKey)
 if(sign.x===ecdh.x && sign.y===ecdh.y) throw new Error("Keys must be distinct")
 const fields=[V+"/CLAIM","Navigator",ascii("pairing",input.pairingRef,b64).toString(),ascii("nonce",input.nonce,b64).toString(),publicKeyFingerprint(sign),publicKeyFingerprint(ecdh)]
 return Buffer.from(fields.join("\n"),"ascii")
}
export function redeemTranscript(input:{claimId:string;pairingRef:string;nonce:string;signingKey:unknown;agreementKey:unknown}):Buffer {
 const sign=normalizedP256PublicKey(input.signingKey),ecdh=normalizedP256PublicKey(input.agreementKey)
 if(sign.x===ecdh.x && sign.y===ecdh.y) throw new Error("Keys must be distinct")
 return Buffer.from([V+"/REDEEM","Navigator",ascii("claim",input.claimId,b64).toString(),ascii("pairing",input.pairingRef,b64).toString(),ascii("nonce",input.nonce,b64).toString(),publicKeyFingerprint(sign),publicKeyFingerprint(ecdh)].join("\n"),"ascii")
}
export function verifyP1363Proof(key:unknown,transcript:Buffer,signature:string):boolean {
 try { const sig=base64url(signature,64);return verify("sha256",transcript,{key:createPublicKey({key:normalizedP256PublicKey(key),format:"jwk"}),dsaEncoding:"ieee-p1363"},sig) }
 catch { return false }
}
export type ContextFields = {
 version:string; environment:string; application:string; tenantId:string; userId:string; accountId:string;
 pairingRef:string; claimId:string; signingFingerprint:string; agreementFingerprint:string;
 redeemNonce:string; approvalId:string
}
const DOMAIN=Buffer.from(V+"/CONTEXT","ascii")
/** Domain + strict 12-field sequence of uint32be length || byte content. */
export function encodeCanonicalContext(c:ContextFields):Buffer {
 if(!c || Object.keys(c).sort().join(",")!==["version","environment","application","tenantId","userId","accountId","pairingRef","claimId","signingFingerprint","agreementFingerprint","redeemNonce","approvalId"].sort().join(",")) throw new Error("Context fields mismatch")
 if(c.version!==V || c.application!=="Navigator") throw new Error("Invalid context authority")
 const fields=[
  ascii("version",c.version,/^AA-PASHLOC-ENROLL-V1$/),
  ascii("environment",c.environment,/^(isolated|test|development|production)$/),
  ascii("application",c.application,/^Navigator$/),
  ascii("tenant",c.tenantId,id),ascii("user",c.userId,id),ascii("account",c.accountId,id),
  ascii("pairing",c.pairingRef,b64),ascii("claim",c.claimId,b64),
  Buffer.from(ascii("signing fingerprint",c.signingFingerprint,hex64).toString(),"hex"),
  Buffer.from(ascii("agreement fingerprint",c.agreementFingerprint,hex64).toString(),"hex"),
  ascii("redeem nonce",c.redeemNonce,b64),ascii("approval",c.approvalId,id)
 ]
 return Buffer.concat([DOMAIN,...fields.flatMap(field=>{const prefix=Buffer.alloc(4);prefix.writeUInt32BE(field.length);return [prefix,field]})])
}
const hkdfDomain=Buffer.from(V+"/HKDF-AES256GCM\0","ascii")
const aadDomain=Buffer.from(V+"/AES-GCM\0","ascii")
export type SyntheticEnvelope = { version:typeof V; salt:string; context:string; ephemeral_public_key_jwk:DevicePublicJwk; nonce:string; ciphertext:string; tag:string }
/** Encrypt a genuine Navigator TOTP secret to the approved device's ECDH key.
 * This primitive does not authorize delivery: callers must separately verify
 * the signed redeem proof, browser approval, account scope and one-use nonce.
 */
export function encryptNavigatorCredentialV1(input:{secret:string; deviceEcdhPublicJwk:unknown;context:ContextFields}):SyntheticEnvelope {
 if(input.context.environment!=="production") throw new Error("Genuine credential requires production context")
 if(!/^[A-Z2-7]{16,128}$/.test(input.secret)) throw new Error("Invalid Base32 credential")
 return encryptEnrollmentEnvelope(input.secret,input.deviceEcdhPublicJwk,input.context)
}
export function encryptSyntheticEnrollmentV1(input:{syntheticSecret:string; deviceEcdhPublicJwk:unknown;context:ContextFields}):SyntheticEnvelope {
 if(input.context.environment==="production") throw new Error("Synthetic enrollment is forbidden in production")
 if(!/^[A-Z2-7]{16,128}$/.test(input.syntheticSecret)) throw new Error("Synthetic Base32 test credential required")
 return encryptEnrollmentEnvelope(input.syntheticSecret,input.deviceEcdhPublicJwk,input.context)
}
function encryptEnrollmentEnvelope(secret:string,deviceEcdhPublicJwk:unknown,contextFields:ContextFields):SyntheticEnvelope {
 const device=normalizedP256PublicKey(deviceEcdhPublicJwk)
 if(publicKeyFingerprint(device)!==contextFields.agreementFingerprint) throw new Error("Device agreement-key mismatch")
 const context=encodeCanonicalContext(contextFields)
 const ephemeral=createECDH("prime256v1");ephemeral.generateKeys()
 const remote=Buffer.concat([Buffer.from([4]),base64url(device.x,32),base64url(device.y,32)])
 const shared=ephemeral.computeSecret(remote)
 if(shared.equals(Buffer.alloc(32))) throw new Error("Invalid shared secret")
 const salt=randomBytes(32),nonce=randomBytes(12),pub=ephemeral.getPublicKey()
 const server:DevicePublicJwk={kty:"EC",crv:"P-256",x:pub.subarray(1,33).toString("base64url"),y:pub.subarray(33,65).toString("base64url")}
 const key=Buffer.from(hkdfSync("sha256",shared,salt,Buffer.concat([hkdfDomain,context]),32))
 const cipher=createCipheriv("aes-256-gcm",key,nonce)
 cipher.setAAD(Buffer.concat([aadDomain,context,Buffer.from(publicKeyFingerprint(server),"hex")]))
 const ciphertext=Buffer.concat([cipher.update(secret,"utf8"),cipher.final()])
 key.fill(0);shared.fill(0)
 return {version:VERSION,salt:salt.toString("base64url"),context:context.toString("base64url"),ephemeral_public_key_jwk:server,nonce:nonce.toString("base64url"),ciphertext:ciphertext.toString("base64url"),tag:cipher.getAuthTag().toString("base64url")}
}
