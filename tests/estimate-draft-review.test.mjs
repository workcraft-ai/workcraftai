import test from "node:test";
import assert from "node:assert/strict";
import { estimateDraftReviewNotes, explicitRoofAreaSquareFeet } from "../lib/estimateDraftReview.mjs";

test("reads explicit roof surface area and flags a roofing-square quantity mismatch", () => {
  const prompt = "Replace shingles across 2,000 sq. ft. of roof surface";
  assert.equal(explicitRoofAreaSquareFeet(prompt, "Roofing"), 2000);
  const notes = estimateDraftReviewNotes(prompt, "Roofing", [
    { description: "Install underlayment", quantity: 1, unit: "roofing square" },
  ]);
  assert.match(notes[0][0], /2,000 sq\. ft\./);
  assert.match(notes[0][0], /100 sq\. ft\./);
});

test("a contractor-entered roof area supports the expected base quantity", () => {
  const notes = estimateDraftReviewNotes(
    "Roof replacement",
    "Roofing",
    [{ description: "Install asphalt shingles", quantity: 20, unit: "roofing square" }],
  );
  assert.deepEqual(notes, [[]]);
});

test("flags likely duplicate roof cleanup and disposal scope in Spanish", () => {
  assert.equal(explicitRoofAreaSquareFeet("Techo de 2,000 pies cuadrados", "Techado"), 2000);
  const notes = estimateDraftReviewNotes(
    "Reemplazo de techo de 2,000 pies cuadrados",
    "Roofing",
    [
      { description: "Roof tear-off and debris disposal", quantity: 1, unit: "job" },
      { description: "Site cleanup and trash haul-away", quantity: 1, unit: "job" },
    ],
    "es",
  );
  assert.match(notes[1][0], /no dupliquen/);
});

test("roof-specific checks do not flag other trades", () => {
  assert.deepEqual(
    estimateDraftReviewNotes("Install flooring across 2,000 sq. ft.", "Flooring", [
      { description: "Install flooring", quantity: 1, unit: "sq ft" },
    ]),
    [[]],
  );
});
