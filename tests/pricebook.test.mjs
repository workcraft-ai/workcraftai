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

test("CSV import rejects fractional cents and oversized fields instead of silently truncating", () => {
  assert.throws(() => parsePriceBookCsv("Name,Price\nFaucet,12.345"), /valid non-negative unit price/);
  assert.throws(() => parsePriceBookCsv(`Name,Price\n${"x".repeat(201)},12.00`), /200 characters or less/);
  assert.throws(() => parsePriceBookCsv(`Name,Description,Price\nFaucet,${"x".repeat(501)},12.00`), /description must be 500/);
});

test("a weak single-word Price Book match is suggested instead of auto-applied", () => {
  const result = applyPriceBookRates(
    [{ description: "Faucet replacement / installation", quantity: 2, unit: "each", unit_price: 225 }],
    [{ name: "Faucet installation", trade: "Plumbing", unit: "each", unit_price: 310 }],
    "Plumbing",
  );
  assert.equal(result.lines[0].unit_price, 225);
  assert.equal(result.matchedCount, 0);
  assert.equal(result.suggestionsByIndex[0][0].name, "Faucet installation");
});

test("clear multi-word matches auto-apply after unit aliases are normalized", () => {
  const result = applyPriceBookRates(
    [{ description: "Install asphalt shingles", quantity: 20, unit: "roofing square", pricing_basis: "installed", unit_price: 0 }],
    [{ name: "Asphalt shingle installation", trade: "Roofing", unit: "square", pricing_basis: "installed", unit_price: 475 }],
    "Roofing",
  );
  assert.equal(result.lines[0].unit_price, 475);
  assert.equal(result.matchedCount, 1);
  assert.deepEqual(result.suggestionsByIndex, {});
});

test("explicit contractor-provided rate is preserved even when a Price Book item matches", () => {
  const result = applyPriceBookRates(
    [{ description: "Replace water heater", quantity: 1, unit: "job", pricing_basis: "installed", unit_price: 1100, pricing_source: "contractor_provided" }],
    [{ name: "Water heater replacement", trade: "Plumbing", unit: "job", pricing_basis: "installed", unit_price: 1200 }],
    "Plumbing",
  );
  assert.equal(result.lines[0].unit_price, 1100);
  assert.equal(result.matchedCount, 0);
});

test("hourly and measurement-based rates require the same units", () => {
  const result = applyPriceBookRates(
    [{ description: "Electrical panel wiring", quantity: 4, unit: "hour", pricing_basis: "labor", unit_price: 0 }],
    [{ name: "Electrical panel wiring", trade: "Electrical", unit: "hours", pricing_basis: "labor", unit_price: 125 }],
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

for (const unit of ["job", "roll", "box", "each", "visit", "system"]) {
  test(`a ${unit} rate cannot price a sheet quantity`, () => {
    const result = applyPriceBookRates([{description:"OSB decking", quantity:10,unit:"sheet",pricing_basis:"installed",unit_price:75}], [{name:"OSB decking",trade:"Roofing",unit,pricing_basis:"installed",unit_price:750}],"Roofing");
    assert.equal(result.matchedCount,0); assert.equal(result.lines[0].unit_price,75);
  });
}
test("unknown inclusion bases can be reviewed, while conflicting bases are excluded", () => {
  for (const basis of [undefined,"unknown"]) {
    const result=applyPriceBookRates([{description:"OSB decking",quantity:10,unit:"sheet",pricing_basis:basis,unit_price:75}],[{name:"OSB decking",trade:"Roofing",unit:"sheet",pricing_basis:"installed",unit_price:150}],"Roofing");
    assert.equal(result.matchedCount,0); assert.equal(result.lines[0].unit_price,75);
    assert.equal(result.suggestionsByIndex[0][0].unit_price,150);
  }
  const incompatible=applyPriceBookRates([{description:"50 gallon water heater unit",quantity:1,unit:"each",pricing_basis:"materials",unit_price:650}],[{name:"Standard 50 gallon water heater installation",trade:"Plumbing",unit:"each",pricing_basis:"installed",unit_price:1200}],"Plumbing");
  assert.equal(incompatible.matchedCount,0);
  assert.equal(incompatible.suggestionsByIndex[0],undefined);
});
test("copper pipe footage aliases match the same unit", () => {
  const result=applyPriceBookRates([{description:"1/2 inch copper pipe",quantity:10,unit:"linear ft",pricing_basis:"materials",unit_price:5}],[{name:"1/2 inch copper pipe",trade:"Plumbing",unit:"ft",pricing_basis:"materials",unit_price:4.5}],"Plumbing");
  assert.equal(result.matchedCount,1);
  assert.equal(result.lines[0].unit_price,4.5);
  const piping=applyPriceBookRates([{description:"1/2-inch copper piping",quantity:10,unit:"linear ft",pricing_basis:"materials",unit_price:5.5}],[{name:"1/2-inch copper pipe",trade:"Plumbing",unit:"ft",pricing_basis:"materials",unit_price:4.5}],"Plumbing");
  assert.equal(piping.matchedCount,1);
  assert.equal(piping.lines[0].unit_price,4.5);
});
test("a unique diagnostic visit uses an each-priced diagnostic fee without treating all visits as each", () => {
  const rate={name:"Diagnostic service fee",trade:"Plumbing",unit:"each",pricing_basis:"labor",unit_price:95};
  for (const basis of ["labor", "other", "unknown"]) {
    const diagnostic=applyPriceBookRates([{description:"On-site diagnostic service fee",quantity:1,unit:"visit",pricing_basis:basis,unit_price:110}],[rate],"Plumbing");
    assert.equal(diagnostic.lines[0].unit_price,95);
    assert.equal(diagnostic.matchedCount,1);
  }
  const unrelated=applyPriceBookRates([{description:"Water heater service",quantity:1,unit:"visit",pricing_basis:"labor",unit_price:110}],[rate],"Plumbing");
  assert.equal(unrelated.suggestionsByIndex[0],undefined);
  const equipment=applyPriceBookRates([{description:"On-site diagnostic service fee",quantity:1,unit:"visit",pricing_basis:"materials",unit_price:110}],[rate],"Plumbing");
  assert.equal(equipment.matchedCount,0);
});
test("CSV preserves an explicitly selected pricing basis",()=>{
 assert.equal(parsePriceBookCsv("Name,Trade,Unit,Price,Pricing_basis\nOSB,Roofing,sheet,75,installed")[0].pricing_basis,"installed");
});
