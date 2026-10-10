import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

test("AI estimate safety and pricing controls have Spanish translations", () => {
  const sourceText = fs.readFileSync("app/components/LanguageProvider.tsx", "utf8");
  const source = ts.createSourceFile("LanguageProvider.tsx", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const translationKeys = new Set();
  const collect = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name)) translationKeys.add(node.name.text);
    ts.forEachChild(node, collect);
  };
  collect(source);

  for (const key of [
    "Job scope and details",
    "Describe measurements, material or grade, access, existing conditions, and what is included or excluded.",
    "Measured roof surface area (sq. ft., optional)",
    "Enter the actual roof surface area, not the home footprint. For roofing-square items, the app calculates the base quantity; adjust for pitch, waste, and complexity.",
    "Base quantity calculated from your roof surface area. Adjust for pitch, waste, and roof complexity.",
    "AI pricing assumption to verify:",
    "Choose a recognized unit before saving this estimate.",
    "Possible Price Book matches · choose one to apply; none was applied automatically.",
    "Choose a recognized unit for every flagged line item before saving.",
    "Choose a unit in each highlighted line item. Units affect both quantities and rates.",
    "Review the flagged quantities and possible scope overlap before saving.",
    "I checked the flagged quantities, units, and included work against this job.",
    "Enter a valid roof surface area, or clear the measurement field.",
    "No. They are broad starting estimates, not live local supplier quotes. Exact or high-confidence Price Book matches can apply automatically; possible matches are shown for you to choose. Review the unit, quantity, labor, material, taxes, and final rate before sharing the estimate.",
  ]) {
    assert.ok(translationKeys.has(key), `Missing Spanish translation: ${key}`);
  }
});
