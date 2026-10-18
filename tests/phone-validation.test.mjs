import test from "node:test";
import assert from "node:assert/strict";
import { isValidOptionalPhone } from "../lib/phone-validation.mjs";

test("optional phone numbers accept common international formats and extensions", () => {
  for (const phone of ["", "(704) 555-0134", "+44 20 7946 0958", "+1 (704) 555-0134 ext. 22"]) {
    assert.equal(isValidOptionalPhone(phone), true, phone);
  }
});

test("phone numbers reject labels, too few digits, and values over the international limit", () => {
  for (const phone of ["Test 1", "12345", "+1234567890123456", "555-123-4567<script>"]) {
    assert.equal(isValidOptionalPhone(phone), false, phone);
  }
});
