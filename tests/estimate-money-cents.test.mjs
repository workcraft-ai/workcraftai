import test from "node:test";
import assert from "node:assert/strict";
import { hasAtMostTwoDecimalPlaces, calculateEstimateMoney } from "../lib/estimate-money.mjs";

test("accepts cent amounts and rejects fractions of a cent", () => {
  assert.equal(hasAtMostTwoDecimalPlaces(0), true);
  assert.equal(hasAtMostTwoDecimalPlaces(12.34), true);
  assert.equal(hasAtMostTwoDecimalPlaces(12.345), false);
  assert.equal(hasAtMostTwoDecimalPlaces(Number.NaN), false);
  assert.equal(hasAtMostTwoDecimalPlaces(Number.POSITIVE_INFINITY), false);
});

test("line totals use integer-cent rounding for fractional quantities", () => {
  const money = calculateEstimateMoney({}, [
    { quantity: 3, unit_price: 0.10 },
    { quantity: 0.5, unit_price: 0.10 },
  ]);
  assert.deepEqual(money.lineItemCents, [30, 5]);
  assert.equal(money.subtotalCents, 35);
});
