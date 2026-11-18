import assert from "node:assert/strict"
import { generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"
import { resolve } from "node:path"
import bcrypt from "bcryptjs"

const db = "pashloc_iv_disposable_mfa_isolated"
const dbRole = db + "_user"
const navigator = "https://navigator-acceptance.example.test"
const phone = "https://phone-acceptance.example.test"

test("disposable Good2Go password, signed approval, and operational data", { skip: !process.env.NAVI51_LOCAL_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.NAVI51_LOCAL_TEST_DATABASE_URL || "")
  assert.equal(url.protocol, "postgresql:")
  assert.equal(url.hostname, "127.0.0.1", "fixture writes are loopback only")
  assert.equal(url.pathname, "/" + db)
  assert.equal(url.username, dbRole)
  Object.assign(process.env, {
    DATABASE_URL: url.href, NODE_ENV: "test", PASHLOC_DISPOSABLE_DB_TEST: "yes",
    PASHLOC_ACCEPTANCE_ONLY: "yes", PASHLOC_ACCEPTANCE_DATABASE_CONFIRMED: "yes",
    PASHLOC_ACCEPTANCE_DATABASE_NAME: db, PASHLOC_NAVIGATOR_ENROLLMENT_ENABLED: "yes",
    PASHLOC_PHONE_CLAIM_ENABLED: "yes", PASHLOC_SHARED_RATE_LIMITS_VERIFIED: "yes",
    APP_BASE_URL: navigator, PASHLOC_PHONE_ORIGIN: phone,
    PASHLOC_SIGNED_TEST_TENANTS: "g2g-roofing, second-test-company",
    JWT_SECRET: randomBytes(32).toString("base64url"),
  })
  const { pool } = await import("../src/db/db")
  const { buildMfaAcceptanceServer } = await import("../src/pashlocAcceptanceServer")
  const { canonicalSignedApproval } = await import("../src/services/pashlocSignedApprovalV1")
  const { verifyToken } = await import("../src/services/authService")
  let app: Awaited<ReturnType<typeof buildMfaAcceptanceServer>> | undefined
  try {
    assert.deepEqual((await pool.query("select current_database() as db, current_user as role")).rows[0], { db, role: dbRole })
    assert.equal((await pool.query("select to_regclass('public.tenants') as tenants")).rows[0].tenants,null,"requires an empty local database")
    await pool.query(`
      create table tenants (id bigserial primary key, slug text not null unique, name text not null, created_at timestamptz default now());
      create table app_users (id bigserial primary key, tenant_id bigint references tenants(id), email text not null, full_name text not null,
        mobile_phone text, role text not null, is_active boolean not null default true, password_hash text not null,
        financials_authorized boolean not null default false, preferred_language text not null default 'en');
      insert into tenants (id,slug,name) values (101,'g2g-roofing','Disposable Good2Go'), (202,'second-test-company','Disposable Other Company');
    `)
    await pool.query(readFileSync(new URL("../sql/pashloc_mfa_acceptance_private_disposable.sql",import.meta.url),"utf8"))
    await import("../src/pashlocAcceptanceCrmSchema")
    const password = randomBytes(18).toString("base64url")
    await pool.query(`
      insert into app_users (id,tenant_id,email,full_name,role,password_hash,pashloc_mfa_required,pashloc_mfa_activated_at)
      values (11,101,'signed@example.invalid','Disposable Signed User','admin',$1,true,now()-interval '5 seconds'),
             (12,101,'plain@example.invalid','Disposable Password User','staff',$1,false,null),
             (22,202,'other@example.invalid','Disposable Other User','admin',$1,false,null)
    `, [await bcrypt.hash(password, 4)])
    await pool.query(`
      insert into customers (id,tenant_id,full_name) values (1,101,'Good2Go Fixture Customer'),(2,202,'Other Fixture Customer');
      insert into jobs (id,tenant_id,customer_id,stage) values (1,101,1,'lead'),(2,202,2,'lead');
      insert into calendar_events (tenant_id,job_id,title,start_time) values (101,1,'Good2Go Fixture Appointment',now()),(202,2,'Other Fixture Appointment',now());
      insert into timeline_events (tenant_id,job_id,kind,message) values (101,1,'manual_note','Good2Go Fixture Note'),(202,2,'manual_note','Other Fixture Note');
    `)
    app = await buildMfaAcceptanceServer()
    const target = app
    const keys = generateKeyPairSync("ec",{namedCurve:"prime256v1"})
    const deviceId = randomBytes(32).toString("base64url")
    await pool.query("insert into pashloc_signed_devices (tenant_id,app_user_id,device_id,public_jwk,proof_verified_at) values (101,11,$1,$2,now())",
      [deviceId, keys.publicKey.export({format:"jwk"})])
    const post = (url:string,payload:Record<string,unknown>,origin=navigator) =>
      target.inject({method:"POST",url,payload,headers:{origin}})
    const get = (url:string,token?:string) =>
      target.inject({method:"GET",url,headers:{origin:navigator,...(token?{authorization:"Bearer "+token}:{})}})
    const login = (email:string,slug="g2g-roofing") => post("/auth/"+slug+"/login",{email,password})
    const start = async () => {
      const response = await login("signed@example.invalid")
      assert.equal(response.statusCode,200,response.body)
      const r = response.json()
      assert.equal(r.tenantSlug,"g2g-roofing")
      assert.equal(r.mfa_required,true)
      assert.equal(r.method,"pashloc_signed")
      assert.equal(r.token,null)
      return {reference:r.reference,browserProof:r.browserProof}
    }
    const complete = (challenge: Awaited<ReturnType<typeof start>>) => post("/auth/mfa/signed/complete",challenge)
    const decide = async (challenge: Awaited<ReturnType<typeof start>>, decision: "approve" | "deny") => {
      const response = await post("/auth/mfa/signed/challenge",{reference:challenge.reference,deviceId},phone)
      assert.equal(response.statusCode,200,response.body)
      const context = {...response.json().context,decision}
      assert.equal(context.tenantId,101)
      assert.equal(context.userId,11)
      const signature = sign("sha256",canonicalSignedApproval(context),{key:keys.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url")
      assert.equal((await post("/auth/mfa/signed/decision",{context,signature},phone)).statusCode,200)
    }
    const wrongTenant = await login("signed@example.invalid","second-test-company")
    assert.ok(wrongTenant.statusCode >= 400)
    assert.equal(wrongTenant.json().token,undefined)
    assert.equal((await post("/auth/g2g-roofing/login",{email:"signed@example.invalid",password},"https://wrong.example.test")).statusCode,403)
    assert.equal((await get("/admin/jobs/g2g-roofing")).statusCode,401)

    const denied = await start()
    assert.equal((await complete(denied)).statusCode,202)
    await decide(denied,"deny")
    assert.deepEqual((await complete(denied)).json(),{ok:true,state:"denied"})

    const approved = await start()
    await decide(approved,"approve")
    const completion = await complete(approved)
    assert.equal(completion.statusCode,200,completion.body)
    const {token,tenantSlug} = completion.json()
    assert.equal(tenantSlug,"g2g-roofing")
    const claims = verifyToken(token)
    assert.equal(Number(claims.sub),11)
    assert.equal(Number(claims.tenant_id),101)
    assert.equal(claims.mfa_verified,true)
    const replay = await complete(approved)
    assert.equal(replay.statusCode,410)
    assert.equal(replay.json().token,undefined)

    const me = await get("/auth/me",token)
    assert.equal(me.statusCode,200,me.body)
    assert.equal(Number(me.json().user.id),11)
    assert.equal(me.json().user.role,"admin")
    for (const [path, expected] of [
      ["/admin/jobs/SLUG","Good2Go Fixture Customer"],
      ["/admin/recent-activity/SLUG","Good2Go Fixture Note"],
      ["/calendar/SLUG/events","Good2Go Fixture Appointment"],
      ["/platform/company-dna-runtime/SLUG","Disposable Good2Go"],
    ]) {
      const result = await get(path.replace("SLUG","g2g-roofing"),token)
      assert.equal(result.statusCode,200,result.body)
      assert.ok(result.body.includes(expected),result.body)
      assert.ok(!result.body.includes("Other Fixture"))
      assert.equal((await get(path.replace("SLUG","second-test-company"),token)).statusCode,403)
    }
    const plain = await login("plain@example.invalid")
    assert.equal(plain.statusCode,200,plain.body)
    const plainToken = plain.json().token
    assert.equal(verifyToken(plainToken).mfa_verified,false)
    assert.equal((await get("/admin/jobs/g2g-roofing",plainToken)).statusCode,200)
    assert.equal((await get("/admin/jobs/second-test-company",plainToken)).statusCode,403)
    const domDriver = process.env.NAVI51_LOCAL_DOM_DRIVER
    if (domDriver) {
      const api = "https://nav51-local-fixture.onrender.com"
      const dist = resolve(process.cwd(),"../dashboard/dist")
      const { JSDOM } = await import(domDriver)
      const dom = new JSDOM(readFileSync(dist+"/index.html","utf8"),{
        url:navigator+"/login?tenant=g2g-roofing",runScripts:"outside-only",pretendToBeVisual:true,
      })
      try {
        const win = dom.window
        const reads = new Map<string,string>()
        win.AbortSignal = AbortSignal
        win.AbortController = AbortController
        win.fetch = async (address: string, options: RequestInit = {}) => {
          const url = new URL(address,navigator)
          if (url.origin !== api) throw new Error("Unexpected fixture API origin")
          const headers = new Headers(options.headers)
          headers.set("origin",navigator)
          const method = options.method || "GET"
          assert.ok(method==="GET" || method==="POST")
          const response = await target.inject({method,url:url.pathname+url.search,headers:Object.fromEntries(headers),
            ...(typeof options.body==="string" ? {payload:options.body} : {})})
          if (response.statusCode===200) reads.set(url.pathname,response.body)
          return new Response(response.body,{status:response.statusCode})
        }
        const main = readdirSync(dist+"/assets").find(name=>/^index-.*\.js$/.test(name))
        assert.ok(main)
        win.eval(readFileSync(dist+"/assets/"+main,"utf8"))
        async function until<T>(probe:()=>T | null | undefined) {
          for(let i=0;i<120;i++) {
            const result = probe()
            if(result) return result
            await new Promise(resolve=>setTimeout(resolve,50))
          }
          throw new Error("Expected Navigator screen did not render: "+win.document.body.textContent?.slice(0,500))
        }
        const emailInput = await until(()=>win.document.querySelector('input[placeholder="you@yourcompany.com"]'))
        const passwordInput = win.document.querySelector('input[type="password"]')
        const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,"value")!.set!
        setter.call(emailInput,"signed@example.invalid")
        emailInput.dispatchEvent(new win.Event("input",{bubbles:true}))
        setter.call(passwordInput,password)
        passwordInput.dispatchEvent(new win.Event("input",{bubbles:true}))
        const form = win.document.querySelector("form")
        form.dispatchEvent(new win.Event("submit",{bubbles:true,cancelable:true}))
        const link = await until(()=>win.document.querySelector('a[href*="#navigator-sign="]'))
        const href = new URL(link.href)
        assert.equal(href.origin,phone)
        await decide({reference:href.hash.split("=")[1],browserProof:""},"approve")
        await until(()=>reads.has("/admin/jobs/g2g-roofing") && win.document.body.textContent?.includes("Good2Go Roofing"))
        const jobResponse = reads.get("/admin/jobs/g2g-roofing")!
        assert.ok(jobResponse.includes("Good2Go Fixture Customer"))
        assert.ok(!jobResponse.includes("Other Fixture Customer"))
        assert.equal(win.location.pathname,"/")
        assert.equal(win.localStorage.getItem("contractor_navigator_tenant_slug"),"g2g-roofing")
        assert.ok(win.document.body.textContent.includes("Command Center"))
        assert.ok(!win.document.body.textContent.includes("Other Fixture Customer"))
        console.log("NAVIGATOR_REACT_SCREEN_RENDERED_DISPOSABLE_G2G_ROOFING")
      } finally {
        dom.window.close()
      }
    }

    // Shared rate-limit proof: independent Fastify instances, one PostgreSQL counter.
    // All fixtures and destructive fault injection remain inside the disposable loopback DB.
    {
      const { default: Fastify } = await import("fastify")
      const { registerPashLocAcceptanceRateLimits } = await import("../src/services/pashlocAcceptanceRateLimit")
      const one = Fastify({logger:false}), two = Fastify({logger:false})
      for (const instance of [one,two]) {
        registerPashLocAcceptanceRateLimits(instance)
        for (const route of ["/auth/g2g-roofing/login","/auth/mfa/enrollment/start",
          "/auth/mfa/signed/decision","/auth/mfa/device/claim"]) {
          instance.post(route,async()=>({ok:true}))
        }
      }
      try {
        await pool.query("delete from pashloc_mfa_request_limits")
        const path="/auth/mfa/signed/decision"
        const requests=Array.from({length:25},(_,i)=>(i%2?two:one).inject({
          method:"POST",url:path,payload:{},remoteAddress:"192.0.2.10",
          headers:{origin:phone,"x-forwarded-for":"203.0.113."+i,"x-real-ip":"198.51.100."+i}
        }))
        const results=await Promise.all(requests)
        assert.equal(results.filter(r=>r.statusCode===200).length,20,"atomic shared limit across instances")
        assert.equal(results.filter(r=>r.statusCode===429).length,5)
        await pool.query("delete from pashloc_mfa_request_limits")
        const aggregate=await Promise.all(Array.from({length:105},(_,i)=>(i%2?two:one).inject({
          method:"POST",url:path,payload:{},remoteAddress:"198.51.100."+i,
          headers:{origin:phone}
        })))
        assert.equal(aggregate.filter(r=>r.statusCode===200).length,100,"shared aggregate cap")
        assert.equal(aggregate.filter(r=>r.statusCode===429).length,5)
        await pool.query("delete from pashloc_mfa_request_limits")
        for (const route of ["/auth/g2g-roofing/login","/auth/mfa/enrollment/start",
          "/auth/mfa/signed/decision","/auth/mfa/device/claim"]) {
          const response=await one.inject({method:"POST",url:route,payload:{},headers:{origin:phone}})
          assert.equal(response.statusCode,200,route)
          const record=await pool.query("select count(*)::int as count from pashloc_mfa_request_limits where bucket like $1",[route+"|%"])
          assert.equal(record.rows[0].count,2,"rate limit buckets required for "+route)
        }
        assert.equal((await one.inject({method:"POST",url:path,payload:{},headers:{origin:"https://untrusted.invalid"}})).statusCode,403)
        await pool.query("alter table pashloc_mfa_request_limits rename to pashloc_mfa_request_limits_fault")
        try {
          const unavailable=await one.inject({method:"POST",url:path,payload:{},headers:{origin:phone}})
          assert.notEqual(unavailable.statusCode,200,"DB outage must fail closed")
        } finally {
          await pool.query("alter table pashloc_mfa_request_limits_fault rename to pashloc_mfa_request_limits")
        }
        console.log("PASHLOC_SHARED_RATE_LIMITS_ATOMIC_MULTI_INSTANCE_SPOOF_AGGREGATE_COVERAGE_FAIL_CLOSED_PASS")
      } finally {await one.close();await two.close()}
    }
  } finally {
    await app?.close()
    await pool.end()
  }
})
