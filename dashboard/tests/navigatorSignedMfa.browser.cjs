const assert = require("node:assert/strict")
const { chromium } = require("playwright")
;(async () => {
  const browser = await chromium.launch({channel:"chrome",headless:true})
  try {
    for (const mode of ["denied", "expired", "enrollment", "unavailable", "approved", "spanish"]) {
      const spanish = mode === "spanish"
      const page = await browser.newPage({ locale: spanish ? "es-ES" : "en-US" })
      const reference = "a".repeat(43), browserProof = "b".repeat(43)
      let shouldComplete = false
      let observedSession = false
      await page.route("**/*", async route => {
        const req = route.request(), url = new URL(req.url())
        if (url.origin !== "http://127.0.0.1:5179" || !/^(\/auth\/|\/platform\/|\/admin\/|\/calendar\/)/.test(url.pathname)) return route.continue()
        const send = (json,status=200)=>route.fulfill({status,json})
        if (url.pathname.endsWith("/login")) {
          if (mode === "enrollment") return send({ok:true,mfa_required:true,enrollment_required:true})
          return send({ok:true,mfa_required:true,method:"pashloc_signed",reference,browserProof,expiresAt:new Date(Date.now()+110000).toISOString(),phoneUrl:"https://pashloc.example.invalid/#navigator-sign="+reference})
        }
        if (url.pathname === "/auth/mfa/signed/complete") {
          assert.deepEqual(req.postDataJSON(), {reference, browserProof})
          if (!shouldComplete) return send({ok:true,state:"pending"},202)
          if (mode === "unavailable") return send({ok:false},503)
          if (mode === "expired") return send({ok:false,state:"expired"},410)
          return send({ok:true,state:spanish ? "denied" : mode,...(mode === "approved" ? {token:"synthetic-navigator-browser-token"} : {})})
        }
        const authorized = req.headers().authorization === "Bearer synthetic-navigator-browser-token"
        if (authorized) observedSession = true
        if (url.pathname === "/auth/me") return send({ok:true,user:{id:1,tenant_id:1,role:"staff",is_active:true}},authorized ? 200 : 401)
        return send({ok:true,jobs:[],events:[],rows:[],tenants:[]})
      })
      await page.goto("http://127.0.0.1:5179/login")
      await page.getByPlaceholder("you@yourcompany.com").fill("signed@example.invalid")
      await page.getByPlaceholder("Enter password").fill("synthetic-browser-test")
      await page.getByRole("button",{name:"Login",exact:true}).click()
      if (mode !== "enrollment") {
        await page.getByRole("heading",{name:spanish ? "Aprueba el acceso con PashLoc" : "Approve sign-in with PashLoc"}).waitFor()
        await page.locator('[role="img"] canvas, [role="img"] img').first().waitFor({state:"attached"})
        assert.equal(await page.getByRole("link",{name:spanish ? "Abrir enlace de aprobación de PashLoc" : "Open PashLoc approval link"}).getAttribute("href"),"https://pashloc.example.invalid/#navigator-sign="+reference)
        assert.equal(await page.locator('input[autocomplete="one-time-code"]').count(),0)
        assert.equal(await page.evaluate(()=>localStorage.getItem("contractor_autopilot_token")),null)
        shouldComplete = true
      }
      if (mode === "approved") {
        await page.waitForURL("http://127.0.0.1:5179/")
        await page.waitForFunction(() => localStorage.getItem("contractor_autopilot_token")==="synthetic-navigator-browser-token")
        for(let i=0;i<20 && !observedSession;i++) await new Promise(r=>setTimeout(r,50))
        assert.equal(observedSession,true)
      } else {
        const text = {spanish:/Se rechazó el acceso/,denied:/Sign-in was denied/, expired:/This request expired/, enrollment:/needs a registered PashLoc device/, unavailable:/PashLoc could not finish sign-in/}[mode]
        await page.getByRole("alert").filter({hasText:text}).waitFor()
        assert.equal(await page.evaluate(()=>localStorage.getItem("contractor_autopilot_token")),null)
      }
      console.log("browser UI PASS",mode)
      await page.close()
    }
  } finally { await browser.close() }
})().catch(error=>{ console.error(error); process.exitCode=1 })
