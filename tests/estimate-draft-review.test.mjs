import test from "node:test";
import assert from "node:assert/strict";
import { estimateDraftReviewNotes } from "../lib/estimateDraftReview.mjs";

test("AI review never rewrites quantities based on a trade-specific measurement", () => {
  const lines = [{ description: "Install asphalt shingles", quantity: 20, unit: "roofing square" }];
  assert.deepEqual(estimateDraftReviewNotes("Roof replacement, 2,000 sq ft", "Roofing", lines), [[]]);
  assert.equal(lines[0].quantity, 20);
});

test("flags an exact duplicate line item for the contractor to review", () => {
  const notes = estimateDraftReviewNotes("Install two outlets", "Electrical", [
    { description: "Install two standard electrical outlets", quantity: 2, unit: "each" },
    { description: "Install two standard electrical outlets", quantity: 2, unit: "each" },
  ]);
  assert.match(notes[1][0], /charged twice/);
});

test("flags possible removal and cleanup overlap for any trade in Spanish", () => {
  const notes = estimateDraftReviewNotes("Remove old cabinets and clean up", "Carpentry", [
    { description: "Removal and disposal of old cabinets", quantity: 1, unit: "job" },
    { description: "Site cleanup and trash haul-away", quantity: 1, unit: "job" },
  ], "es");
  assert.match(notes[1][0], /incluidos también/);
});
