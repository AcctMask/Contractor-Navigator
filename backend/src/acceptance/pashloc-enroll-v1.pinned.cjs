// Pinned exact PashLoc IV acceptance crypto implementation, source commit ab3592f5c8d19284a0576a1eec223c57cba49187
"use strict";
/* AA-PASHLOC-ENROLL-V1: isolated SYNTHETIC-ONLY client primitives.
 * This is the counterpart of Navigator pashlocEnrollV1Crypto.ts.
 * No real secret exchange or automatic server-side account activation here.
 */
(function(root){
 const V="AA-PASHLOC-ENROLL-V1",enc=new TextEncoder(),dec=new TextDecoder();
 const id=/^[A-Za-z0-9_-]{1,128}$/, token=/^[A-Za-z0-9_-]{43}$/,hex64=/^[a-f0-9]{64}$/;
 const strict64=(s,n)=>{
  if(typeof s!=="string"||!/^[A-Za-z0-9_-]+$/.test(s))throw Error("Invalid base64url");
  const bytes=Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(s.length/4)*4,"=")),x=>x.charCodeAt(0));
  if(bytes.length!==n||base64(bytes)!==s)throw Error("Noncanonical base64url");
  return bytes;
 };
 const base64=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
 const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;};
 const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");
 const fromHex=h=>{if(!hex64.test(h))throw Error("Invalid 32-byte fingerprint");return Uint8Array.from(h.match(/../g),x=>parseInt(x,16));};
 const ascii=(label,v,re)=>{if(typeof v!=="string"||!re.test(v))throw Error("Invalid "+label);return enc.encode(v);};
 const publicJwk=j=>{
  if(!j||typeof j!=="object"||j.kty!=="EC"||j.crv!=="P-256")throw Error("Invalid P-256 JWK");
  if(Object.keys(j).some(k=>!["kty","crv","x","y","ext","key_ops"].includes(k)))throw Error("Unknown JWK property");
  if(j.ext!==undefined&&j.ext!==true)throw Error("Invalid public JWK ext");
  if(j.key_ops!==undefined&&(!Array.isArray(j.key_ops)||j.key_ops.length!==0))throw Error("Invalid public key operations");
  strict64(j.x,32);strict64(j.y,32);
  return {kty:"EC",crv:"P-256",x:j.x,y:j.y};
 };
 const fingerprint=async jwk=>{
  const normalized=publicJwk(jwk);
  // WebCrypto import rejects malformed/off-curve P-256 points before fingerprint use.
  await crypto.subtle.importKey("jwk",normalized,{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
  const digest=await crypto.subtle.digest("SHA-256",enc.encode(JSON.stringify(normalized)));
  return hex(new Uint8Array(digest));
 };
 async function keyPair(){
  const signing=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
  const agreement=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},false,["deriveBits"]);
  const exportedSigning=await crypto.subtle.exportKey("jwk",signing.publicKey);
  const exportedAgreement=await crypto.subtle.exportKey("jwk",agreement.publicKey);
  const signingPublicJwk=publicJwk({kty:exportedSigning.kty,crv:exportedSigning.crv,x:exportedSigning.x,y:exportedSigning.y});
  const agreementPublicJwk=publicJwk({kty:exportedAgreement.kty,crv:exportedAgreement.crv,x:exportedAgreement.x,y:exportedAgreement.y});
  return {signing,agreement,signingPublicJwk,agreementPublicJwk};
 }
 async function transcript(kind,values,signingKey,agreementKey){
  if(!["CLAIM","REDEEM"].includes(kind))throw Error("Invalid proof purpose");
  const sign=publicJwk(signingKey),ecdh=publicJwk(agreementKey);
  if(sign.x===ecdh.x&&sign.y===ecdh.y)throw Error("Key roles must be distinct");
  const parts=kind==="CLAIM"
   ? [ascii("pairing",values.pairingRef,token),ascii("claim nonce",values.nonce,token)]
   : [ascii("claim id",values.claimId,token),ascii("pairing",values.pairingRef,token),ascii("redeem nonce",values.nonce,token)];
  const sf=await fingerprint(sign),af=await fingerprint(ecdh);
  return concat(enc.encode([V+"/"+kind,"Navigator",...parts.map(p=>dec.decode(p)),sf,af].join("\n")));
 }
 async function sign(privateKey,kind,values,signingKey,agreementKey){
  const transcriptBytes=await transcript(kind,values,signingKey,agreementKey);
  const signature=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},privateKey,transcriptBytes));
  if(signature.length!==64)throw Error("Unexpected ECDSA signature format");
  return base64(signature);
 }
 const fields=["version","environment","application","tenantId","userId","accountId","pairingRef","claimId","signingFingerprint","agreementFingerprint","redeemNonce","approvalId"];
 function canonicalContext(c){
  if(!c||typeof c!=="object"||Object.keys(c).length!==12||fields.some(k=>!Object.hasOwn(c,k)))throw Error("Context fields mismatch");
  if(c.version!==V||c.application!=="Navigator")throw Error("Invalid context authority");
  const values=[
   ascii("version",c.version,/^AA-PASHLOC-ENROLL-V1$/),
   ascii("environment",c.environment,/^(isolated|test|development|acceptance|production)$/),
   ascii("application",c.application,/^Navigator$/),
   ascii("tenant",c.tenantId,id),ascii("user",c.userId,id),ascii("account",c.accountId,id),
   ascii("pairing",c.pairingRef,token),ascii("claim",c.claimId,token),
   fromHex(c.signingFingerprint),fromHex(c.agreementFingerprint),
   ascii("redeem nonce",c.redeemNonce,token),ascii("approval",c.approvalId,id)
  ];
  const prefix=enc.encode(V+"/CONTEXT");
  const parts=[prefix];
  for(const v of values){const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,v.length,false);parts.push(length,v);}
  return concat(...parts);
 }
 function parseCanonicalContext(encoded){
  if(typeof encoded!=="string"||!/^[A-Za-z0-9_-]+$/.test(encoded))throw Error("Invalid context transport");
  const bytes=Uint8Array.from(atob(encoded.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(encoded.length/4)*4,"=")),v=>v.charCodeAt(0));
  if(base64(bytes)!==encoded)throw Error("Noncanonical context transport");
  const domain=enc.encode(V+"/CONTEXT");
  if(bytes.length<=domain.length||!domain.every((b,i)=>bytes[i]===b))throw Error("Unknown context domain");
  let offset=domain.length;
  const values={};
  for(const name of fields){
   if(offset+4>bytes.length)throw Error("Truncated context");
   const length=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0,false);
   offset+=4;
   if(length>128||offset+length>bytes.length)throw Error("Invalid context field length");
   const raw=bytes.subarray(offset,offset+length);offset+=length;
   values[name]=(name==="signingFingerprint"||name==="agreementFingerprint")?hex(raw):dec.decode(raw);
  }
  if(offset!==bytes.length)throw Error("Unexpected context bytes");
  const expected=canonicalContext(values);
  if(!equal(expected,bytes))throw Error("Noncanonical context fields");
  return values;
 }
 function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
 async function decryptSyntheticEnvelope(envelope,agreementPrivateKey,expectedContext,expectedSigningKey,expectedAgreementKey){
  if(expectedContext.environment==="production"||expectedContext.environment==="acceptance")throw Error("Synthetic decryption cannot accept genuine credentials");
  return decryptEnrollmentEnvelope(envelope,agreementPrivateKey,expectedContext,expectedSigningKey,expectedAgreementKey);
 }
 async function decryptNavigatorEnvelope(envelope,agreementPrivateKey,expectedContext,expectedSigningKey,expectedAgreementKey,authorizedEnvironment){
  if(!["production","acceptance"].includes(authorizedEnvironment)||expectedContext.environment!==authorizedEnvironment)throw Error("Navigator genuine enrollment environment mismatch");
  return decryptEnrollmentEnvelope(envelope,agreementPrivateKey,expectedContext,expectedSigningKey,expectedAgreementKey);
 }
 async function decryptEnrollmentEnvelope(envelope,agreementPrivateKey,expectedContext,expectedSigningKey,expectedAgreementKey){
  if(!envelope||envelope.version!==V)throw Error("Unsupported enrollment protocol");
  const canonical=canonicalContext(expectedContext);
  const carried=strict64(envelope.context,canonical.length);
  if(!equal(carried,canonical))throw Error("Enrollment context mismatch");
  if(await fingerprint(expectedSigningKey)!==expectedContext.signingFingerprint||
     await fingerprint(expectedAgreementKey)!==expectedContext.agreementFingerprint)throw Error("Device public-key binding mismatch");
  const server=publicJwk(envelope.ephemeral_public_key_jwk);
  const serverImported=await crypto.subtle.importKey("jwk",server,{name:"ECDH",namedCurve:"P-256"},false,[]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:"ECDH",public:serverImported},agreementPrivateKey,256));
  if(shared.every(v=>v===0))throw Error("Invalid ECDH shared secret");
  const ikm=await crypto.subtle.importKey("raw",shared,"HKDF",false,["deriveBits"]);
  const hkdfInfo=concat(enc.encode(V+"/HKDF-AES256GCM"),new Uint8Array([0]),canonical);
  const keyBits=await crypto.subtle.deriveBits({name:"HKDF",hash:"SHA-256",salt:strict64(envelope.salt,32),info:hkdfInfo},ikm,256);
  shared.fill(0);
  const key=await crypto.subtle.importKey("raw",keyBits,{name:"AES-GCM",length:256},false,["decrypt"]);
  const ephemeralHash=fromHex(await fingerprint(server));
  const aad=concat(enc.encode(V+"/AES-GCM"),new Uint8Array([0]),canonical,ephemeralHash);
  const nonce=strict64(envelope.nonce,12),tag=strict64(envelope.tag,16);
  if(typeof envelope.ciphertext!=="string")throw Error("Invalid ciphertext");
  // Synthetic Base32 credentials have a nonempty ciphertext; authenticated decode throws on tamper.
  const ciphertext=Uint8Array.from(atob(envelope.ciphertext.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(envelope.ciphertext.length/4)*4,"=")),x=>x.charCodeAt(0));
  if(!ciphertext.length||base64(ciphertext)!==envelope.ciphertext)throw Error("Invalid ciphertext encoding");
  const raw=await crypto.subtle.decrypt({name:"AES-GCM",iv:nonce,additionalData:aad,tagLength:128},key,concat(ciphertext,tag));
  const secret=dec.decode(raw);
  if(!/^[A-Z2-7]{16,128}$/.test(secret))throw Error("Invalid synthetic credential");
  return secret;
 }
 root.PashLocEnrollV1=Object.freeze({version:V,keyPair,fingerprint,publicJwk,transcript,sign,canonicalContext,parseCanonicalContext,decryptSyntheticEnvelope,decryptNavigatorEnvelope});
})(typeof globalThis!=="undefined"?globalThis:self);
