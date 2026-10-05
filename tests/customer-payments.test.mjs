import test from "node:test";
import assert from "node:assert/strict";
import { estimateTotalCents, paidCents } from "../lib/customer-payment-calculations.mjs";
import { calculateEstimateMoney } from "../lib/estimate-money.mjs";

test("calculates estimate total from line items, markup, and tax in cents", () => {
  assert.equal(estimateTotalCents({ markup_percentage: 10, tax_rate: 5 }, [
    { quantity: 2, unit_price: 100.25 },
  ]), 23158);
});

test("uses the selected package total without applying markup a second time", () => {
  assert.equal(estimateTotalCents({
    package_options: [{ name: "Standard", total: 250 }],
    selected_package: "Standard",
    markup_percentage: 25,
    tax_rate: 8,
  }, [{ quantity: 1, unit_price: 400 }]), 27000);
});

test("rejects non-finite, zero, or negative totals", () => {
  assert.equal(estimateTotalCents({ tax_rate: 0 }, [{ quantity: 1, unit_price: Number.NaN }]), 0);
  assert.equal(estimateTotalCents({ tax_rate: 0 }, [{ quantity: 1, unit_price: -2 }]), 0);
});

test("rounds line totals and percentage amounts to cents consistently", () => {
  const result = calculateEstimateMoney({ markup_percentage: 10, tax_rate: 5 }, [
    { quantity: 3, unit_price: 0.335 },
    { quantity: 1, unit_price: 0.1 },
  ]);
  assert.deepEqual(result, {
    lineItemCents: [101, 10],
    subtotalCents: 111,
    markupCents: 11,
    taxCents: 6,
    totalCents: 128,
    depositCents: 0,
  });
});

test("deposit amount is calculated from the same rounded total", () => {
  assert.equal(calculateEstimateMoney({ require_deposit: true, deposit_percentage: 33.33 }, [
    { quantity: 1, unit_price: 10.01 },
  ]).depositCents, 334);
});

test("paid amount excludes open and failed checkouts and subtracts refunds", () => {
  assert.equal(paidCents([
    { status: "pending", amount_cents: 5000, amount_refunded_cents: 0 },
    { status: "failed", amount_cents: 3000, amount_refunded_cents: 0 },
    { status: "succeeded", amount_cents: 10000, amount_refunded_cents: 0 },
    { status: "partially_refunded", amount_cents: 4000, amount_refunded_cents: 1500 },
    { status: "refunded", amount_cents: 2000, amount_refunded_cents: 2000 },
  ]), 12500);
});
