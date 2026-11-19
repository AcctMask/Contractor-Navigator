import assert from "node:assert/strict"
import {issueRestrictedBrowserSecrets,restrictedCookie,clearRestrictedCookie,validateRestrictedBrowserRequest,readRestrictedSessionCookie,RESTRICTED_BROWSER_COOKIE} from "../src/services/pashlocRestrictedBrowserV1"
const issued=issueRestrictedBrowserSecrets()
const origin="https://isolated.navigator.example"
const valid={origin,expectedOrigin:origin,secFetchSite:"same-origin",contentType:"application/json",cookieSession:issued.sessionId,csrfHeader:issued.csrfToken,sessionHash:issued.sessionHash,csrfHash:issued.csrfHash,expiresAtMs:Date.now()+120000}
assert.equal(validateRestrictedBrowserRequest(valid),true)
assert.equal(readRestrictedSessionCookie(RESTRICTED_BROWSER_COOKIE+"="+issued.sessionId),issued.sessionId)
assert.equal(readRestrictedSessionCookie(RESTRICTED_BROWSER_COOKIE+"="+issued.sessionId+"; "+RESTRICTED_BROWSER_COOKIE+"="+issued.sessionId),null)
assert.match(restrictedCookie(issued.sessionId),/Secure; HttpOnly; SameSite=Strict/)
assert.match(clearRestrictedCookie(),/Max-Age=0/)
for(const bad of [
 {origin:"https://evil.example"},
 {secFetchSite:"cross-site"},
 {contentType:"text/plain"},
 {cookieSession:"X".repeat(43)},
 {csrfHeader:"X".repeat(43)},
 {expiresAtMs:Date.now()-1},
 {expectedOrigin:"http://isolated.navigator.example"},
])assert.equal(validateRestrictedBrowserRequest({...valid,...bad}),false)
console.log("PASS: restricted session token, strict Secure/HttpOnly/SameSite cookie, CSRF, origin, expiry and duplicate-cookie negatives")
