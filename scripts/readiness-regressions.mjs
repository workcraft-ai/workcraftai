#!/usr/bin/env node
// Audit probes: intentionally separate from the normal test suite. No network,
// database writes, emails, charges, or credentials. Exit 1 means an open defect.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { applyPriceBookRates } from "../lib/priceBookPricing.mjs";
import { calculateEstimateMoney } from "../lib/estimate-money.mjs";

let failed = 0;
function check(name, run) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.log(`FAIL ${name}: ${error.message}`); }
}
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
check("Price Book does not apply a job rate to a sheet quantity", () => {
  const result = applyPriceBookRates([
    { description: "OSB roof decking replacement", unit: "sheet", quantity: 10, unit_price: 75 },
  ], [{ name: "OSB roof decking replacement", trade: "Roofing", unit: "job", unit_price: 750 }], "Roofing");
  assert.equal(result.matchedCount, 0, "job and sheet were treated as interchangeable");
});
check("Public package totals retain the package_options input", () => {
  const text = source("app/api/proposals/[id]/route.ts");
  const ast = ts.createSourceFile("route.ts", text, ts.ScriptTarget.Latest, true);
  let unsafe = false;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "calculateEstimateMoney") {
      const first = node.arguments[0];
      if (first && ts.isObjectLiteralExpression(first)
          && !first.properties.some((property) => property.name?.getText(ast) === "package_options")) unsafe = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(unsafe, false, "route passes a tax-only object; a $1,000 package becomes $0");
  assert.equal(calculateEstimateMoney({ package_options: [{ name: "Best", total: 1000 }], tax_rate: 10 }, [], "Best").totalCents, 110000);
});
check("Cron declares the GET handler used by Vercel", () => {
  assert.match(source("app/api/cron/followups/route.ts"), /export\s+(?:async\s+function\s+GET\b|(?:const|\{)\s*GET\b)/,
    "follow-up route only declares POST");
});
check("Refund handler does not overwrite totals from an event snapshot", () => {
  const text = source("app/api/webhooks/stripe/route.ts");
  assert.doesNotMatch(text, /amount_refunded_cents:\s*refunded[\s\S]{0,300}\.eq\("id", payment\.id\)/,
    "unconditional refund update can replace a newer full refund with an older partial refund");
});
check("Upload accounting does not trust the browser's success flag", () => {
  const files = source("supabase/migrations/20261010181731_production_readiness_security_and_accounting.sql");
  // Check the corrective definition; transactional database tests also cover this.
  assert.doesNotMatch(files, /if p_uploaded and exists/,
    "original finalizer releases successful uploads when the client sends false; inspect the latest DB definition");
});
console.log(`${5 - failed}/5 audit probes passed. Source probes require regression tests after refactoring.`);
process.exitCode = failed ? 1 : 0;
