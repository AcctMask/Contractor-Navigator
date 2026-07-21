import assert from "node:assert/strict"
import {
  parseUniversalIntake,
} from "../src/services/universalIntakeParser"

const freeFormResult = parseUniversalIntake(`
Boris Morris
14333 Cliff Dr
Tarpon Springs
7272154507
sales@g2groofing.com

testing auto job still
`)

assert.deepEqual(freeFormResult, {
  customerName: "Boris Morris",
  customerPhone: "7272154507",
  customerEmail: null,
  address1: "14333 Cliff Dr",
  city: "Tarpon Springs",
  state: "FL",
  zip: null,
  notes: "testing auto job still",
})

const labeledResult = parseUniversalIntake(`
Customer Name: Jane Smith
Phone: (727) 555-1212
Email: jane@example.com
Address: 100 Main St
City: Clearwater
State: FL
Zip: 33755
Request: Please schedule a roof estimate.
`)

assert.deepEqual(labeledResult, {
  customerName: "Jane Smith",
  customerPhone: "7275551212",
  customerEmail: "jane@example.com",
  address1: "100 Main St",
  city: "Clearwater",
  state: "FL",
  zip: "33755",
  notes: "Please schedule a roof estimate.",
})

const standardAddressResult = parseUniversalIntake(`
Michael Jones
500 Oak Avenue
Largo, FL 33770
813-555-9999
michael@example.com
Roof leak near rear bedroom.
`)

assert.deepEqual(standardAddressResult, {
  customerName: "Michael Jones",
  customerPhone: "8135559999",
  customerEmail: "michael@example.com",
  address1: "500 Oak Avenue",
  city: "Largo",
  state: "FL",
  zip: "33770",
  notes: "Roof leak near rear bedroom.",
})

console.log(
  JSON.stringify(
    {
      ok: true,
      tests: 3,
      free_form_result: freeFormResult,
      labeled_result: labeledResult,
      standard_address_result:
        standardAddressResult,
    },
    null,
    2
  )
)
