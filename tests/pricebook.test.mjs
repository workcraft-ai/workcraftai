import test from "node:test";
import assert from "node:assert/strict";
import { parsePriceBookCsv } from "../lib/priceBookCsv.mjs";
import { applyPriceBookRates } from "../lib/priceBookPricing.mjs";

test("CSV import supports quoted fields, header aliases, and currency values", () => {
  const rows = parsePriceBookCsv('Item,Description,Trade,UOM,Price\n"Faucet install","Kitchen, standard",Plumbing,each,"$245.50"');
  assert.deepEqual(rows, [{ name: "Faucet install", description: "Kitchen, standard", trade: "Plumbing", unit: "each", unit_price: 245.5 }]);
});

test("CSV import rejects missing prices and malformed quoting", () => {
  assert.throws(() => parsePriceBookCsv("Name,Price\nFaucet,abc"), /Row 2/);
  assert.throws(() => parsePriceBookCsv('Name,Price\n"Faucet,25'), /unclosed quotation/);
});

test("a weak single-word Price Book match is suggested instead of auto-applied", () => {
  const result = applyPriceBookRates(
    [{ description: "Faucet replacement / installation", quantity: 2, unit_price: 225 }],
    [{ name: "Faucet installation", trade: "Plumbing", unit: "each", unit_price: 310 }],
    "Plumbing",
  );
  assert.equal(result.lines[0].unit_price, 225);
  assert.equal(result.matchedCount, 0);
  assert.equal(result.suggestionsByIndex[0][0].name, "Faucet installation");
});

test("clear multi-word matches auto-apply after unit aliases are normalized", () => {
  const result = applyPriceBookRates(
    [{ description: "Install asphalt shingles", quantity: 20, unit: "roofing square", unit_price: 0 }],
    [{ name: "Asphalt shingle installation", trade: "Roofing", unit: "square", unit_price: 475 }],
    "Roofing",
  );
  assert.equal(result.lines[0].unit_price, 475);
  assert.equal(result.matchedCount, 1);
  assert.deepEqual(result.suggestionsByIndex, {});
});

test("hourly and measurement-based rates require the same units", () => {
  const result = applyPriceBookRates(
    [{ description: "Electrical panel wiring", quantity: 4, unit: "hour", unit_price: 0 }],
    [{ name: "Electrical panel wiring", trade: "Electrical", unit: "hours", unit_price: 125 }],
    "Electrical",
    true,
  );
  assert.equal(result.lines[0].unit_price, 125);
});

test("do not apply ambiguous or incompatible Price Book rates", () => {
  const lines = [{ description: "Faucet replacement / installation", quantity: 1, unit_price: 225 }];
  const result = applyPriceBookRates(lines, [
    { name: "Faucet installation", trade: "Plumbing", unit: "hour", unit_price: 310 },
    { name: "Faucet replacement", trade: "Plumbing", unit: "each", unit_price: 320 },
    { name: "Faucet service", trade: "Plumbing", unit: "each", unit_price: 330 },
  ], "Plumbing");
  assert.equal(result.lines[0].unit_price, 225);
  assert.equal(result.matchedCount, 0);
});

test("Price Book descriptions can surface compatible suggestions but never bypass unit checks", () => {
  const result = applyPriceBookRates(
    [
      { description: "Replace leaking kitchen faucet", quantity: 1, unit: "each", unit_price: 0 },
      { description: "Replace leaking kitchen faucet", quantity: 1, unit: "unknown", unit_price: 0 },
    ],
    [{ name: "Fixture service", description: "Kitchen faucet repair or replacement", trade: "Plumbing", unit: "each", unit_price: 290 }],
    "Plumbing",
  );
  assert.equal(result.matchedCount, 0);
  assert.equal(result.suggestionsByIndex[0][0].unit_price, 290);
  assert.equal(result.suggestionsByIndex[1], undefined);
});
