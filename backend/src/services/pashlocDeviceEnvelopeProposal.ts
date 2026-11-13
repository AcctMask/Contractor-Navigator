/**
 * Proposed PashLoc IV MFA secret envelope v1. ISOLATED; requires joint
 * Security Assurance / PashLoc approval before use with real enrollment.
 *
 * Device MUST generate a distinct P-256 ECDH keypair (not its signing key).
 * Server generates a fresh ephemeral ECDH keypair for each redemption.
 * HKDF-SHA256 binds derived key to pairing, tenant, user and account.
 * AES-256-GCM authenticates the same context as AAD.
 * Neither the QR nor the envelope contains a plaintext TOTP secret.
 */
import { createECDH, createPublicKey, hkdfSync, randomBytes, createCipheriv } from "node:crypto"

type EcdhJwk = {kty:"EC";crv:"P-256";x:string;y:string}
export type PashLocEnvelope = {
 version:"pashloc-iv-ecdh-hkdf-aesgcm-v1"
 ephemeral_public_key_jwk:EcdhJwk
 nonce:string
 ciphertext:string
 tag:string
}
const b64=(b:Buffer)=>b.toString("base64url")
const canonical=(s:string)=>Buffer.from(s,"base64url")
function publicKey(jwk:EcdhJwk):Buffer {
 if(jwk?.kty!=="EC"||jwk.crv!=="P-256"||
 !/^[A-Za-z0-9_-]{43}$/.test(jwk.x)||!/^[A-Za-z0-9_-]{43}$/.test(jwk.y))
 throw new Error("Invalid ECDH public key")
 // Validate curve point via Node's ECDH computeSecret below.
 createPublicKey({key:jwk,format:"jwk"})
 return Buffer.concat([Buffer.from([4]),canonical(jwk.x),canonical(jwk.y)])
}
export function encryptPashLocDeviceEnvelope(input:{
  secret:string
  deviceEcdhPublicJwk:EcdhJwk
  pairingHash:string
  tenantId:number
  userId:number
  accountId:string
}):PashLocEnvelope {
 if(!/^[A-Z2-7]{16,128}$/.test(input.secret) ||
 !/^[a-f0-9]{64}$/.test(input.pairingHash) ||
 !Number.isSafeInteger(input.tenantId)||input.tenantId<=0||
 !Number.isSafeInteger(input.userId)||input.userId<=0||
 !/^[A-Za-z0-9_-]{32}$/.test(input.accountId)) throw new Error("Invalid envelope context")
 const context=Buffer.from(JSON.stringify({
  v:1,app:"Navigator",pairing:input.pairingHash,
  tenant:input.tenantId,user:input.userId,account:input.accountId
 }),"utf8")
 const ephemeral=createECDH("prime256v1")
 ephemeral.generateKeys()
 const shared=ephemeral.computeSecret(publicKey(input.deviceEcdhPublicJwk))
 const key=Buffer.from(hkdfSync("sha256",shared,Buffer.from(input.pairingHash,"hex"),context,32))
 const nonce=randomBytes(12)
 const cipher=createCipheriv("aes-256-gcm",key,nonce)
 cipher.setAAD(context)
 const ciphertext=Buffer.concat([cipher.update(input.secret,"utf8"),cipher.final()])
 const uncompressed=ephemeral.getPublicKey()
 return {
  version:"pashloc-iv-ecdh-hkdf-aesgcm-v1",
  ephemeral_public_key_jwk:{kty:"EC",crv:"P-256",
   x:b64(uncompressed.subarray(1,33)),y:b64(uncompressed.subarray(33,65))},
  nonce:b64(nonce),ciphertext:b64(ciphertext),tag:b64(cipher.getAuthTag())
 }
}
