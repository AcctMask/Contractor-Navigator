/** Network-free executable smoke tests for isolated Fastify route registration.
 * No database calls, credential issuance, or production endpoints.
 */
import assert from "node:assert/strict"
import {buildPashLocIsolatedServer} from "../src/pashlocIsolatedServer"
process.env.NODE_ENV="test"
process.env.PASHLOC_ISOLATED_CLAIM_API="enabled"
process.env.PASHLOC_ISOLATED_SHARED_RATE_LIMITS_VERIFIED="yes"
process.env.PASHLOC_ISOLATED_NAVIGATOR_ORIGIN="https://navigator-isolated.example.test"
process.env.PASHLOC_ISOLATED_PHONE_ORIGIN="https://pashloc-isolated.example.test"
const app=await buildPashLocIsolatedServer()
try {
 const health=await app.inject({method:"GET",url:"/healthz"})
 assert.equal(health.statusCode,200)
 assert.equal(health.json().service,"pashloc-isolated")
 for(const path of ["/auth/demo/login","/auth/test/login","/jobs","/customers","/admin","/auth/acme/login"]){
  const r=await app.inject({method:"GET",url:path})
  assert.equal(r.statusCode,404,path+" must remain unavailable")
 }
 for(const path of ["/auth/mfa/device/claim","/auth/mfa/device/claim-challenge","/auth/mfa/device/redeem","/auth/mfa/device/redeem-challenge"]){
  const preflight=await app.inject({method:"OPTIONS",url:path,headers:{
   origin:"https://pashloc-isolated.example.test","access-control-request-method":"POST",
   "access-control-request-headers":"content-type"
  }})
  assert.equal(preflight.statusCode,204,path)
  assert.equal(preflight.headers["access-control-allow-origin"],"https://pashloc-isolated.example.test")
  const wrong=await app.inject({method:"OPTIONS",url:path,headers:{
   origin:"https://attacker.example.test","access-control-request-method":"POST",
   "access-control-request-headers":"content-type"
  }})
  assert.equal(wrong.statusCode,403,path)
  assert.notEqual(wrong.headers["access-control-allow-origin"],"*")
  const blocked=await app.inject({method:"POST",url:path,headers:{
   origin:"https://attacker.example.test","content-type":"application/json"
  },payload:{}})
  assert.equal(blocked.statusCode,403,path)
  assert.notEqual(blocked.headers["access-control-allow-origin"],"*")
 }
 const approval=await app.inject({method:"POST",url:"/auth/mfa/enrollment/approve-device",
  headers:{origin:"https://attacker.example.test","content-type":"application/json"},
  payload:{challenge_id:"wrong",claim_id:"wrong",confirmation_code:"12345678"}})
 assert.equal(approval.statusCode,403)
 console.log("PASS: isolated MFA health, operational-route isolation, exact phone CORS preflights, origin-denied POSTs, restricted browser approval")
} finally {await app.close()}
