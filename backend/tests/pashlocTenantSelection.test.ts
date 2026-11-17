import { test } from "node:test"
import assert from "node:assert/strict"
import { maySelectOwnerWorkspace } from "../../dashboard/src/lib/tenantSelection"

test("Owner switches only to a directory-authorized tenant from two distinct workspaces", () => {
  const authorized = [
    {slug:"pashloc-qa-alpha"},
    {slug:"pashloc-qa-bravo"},
  ]
  assert.equal(maySelectOwnerWorkspace("platform_owner","pashloc-qa-alpha",authorized),true)
  assert.equal(maySelectOwnerWorkspace("platform_owner","pashloc-qa-bravo",authorized),true)
  assert.equal(maySelectOwnerWorkspace("platform_owner","pashloc-qa-charlie",authorized),false)
  assert.equal(maySelectOwnerWorkspace("staff","pashloc-qa-alpha",authorized),false)
  assert.equal(maySelectOwnerWorkspace("platform_owner","../g2g-roofing",authorized),false)
  assert.equal(maySelectOwnerWorkspace("platform_owner","g2g-roofing",authorized),false)
  assert.equal(maySelectOwnerWorkspace("platform_owner","pashloc-qa-alpha",[]),false)
})
