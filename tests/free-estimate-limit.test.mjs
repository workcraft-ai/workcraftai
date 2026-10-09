import test from "node:test";
import assert from "node:assert/strict";
import {
  canManageFreeDailyEstimateLimit,
  isFreeEstimateLimitError,
  parseFreeDailyEstimateLimit,
} from "../lib/free-estimate-limit.mjs";

test("free estimate limit accepts bounded whole numbers, including zero", () => {
  assert.equal(parseFreeDailyEstimateLimit(0), 0);
  assert.equal(parseFreeDailyEstimateLimit(10), 10);
  assert.equal(parseFreeDailyEstimateLimit(1000), null);
  for (const value of [-1, 1001, 1.5, "10", null, undefined, Number.NaN]) {
    assert.equal(parseFreeDailyEstimateLimit(value), null);
  }
});

test("only the existing super_admin role can manage the global free limit", () => {
  assert.equal(canManageFreeDailyEstimateLimit("super_admin"), true);
  assert.equal(canManageFreeDailyEstimateLimit("billing"), false);
  assert.equal(canManageFreeDailyEstimateLimit("support"), false);
  assert.equal(canManageFreeDailyEstimateLimit(undefined), false);
});

test("quota errors are identified without masking unrelated database errors", () => {
  assert.equal(isFreeEstimateLimitError({ message: "FREE_DAILY_ESTIMATE_LIMIT" }), true);
  assert.equal(isFreeEstimateLimitError({ message: "FREE_DAILY_ESTIMATE_LIMIT_NOT_CONFIGURED" }), true);
  assert.equal(isFreeEstimateLimitError({ message: "duplicate key" }), false);
  assert.equal(isFreeEstimateLimitError(null), false);
});
