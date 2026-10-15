import test from "node:test";
import assert from "node:assert/strict";
import { estimateDraftReviewNotes } from "../lib/estimateDraftReview.mjs";

test("flags likely duplicate roof cleanup and disposal scope in Spanish", () => {
  const notes = estimateDraftReviewNotes(
    "Roofing",
    [
      { description: "Roof tear-off and debris disposal", quantity: 1, unit: "job" },
      { description: "Site cleanup and trash haul-away", quantity: 1, unit: "job" },
    ],
    "es",
  );
  assert.match(notes[1][0], /no dupliquen/);
});

test("roof cleanup check does not flag other trades", () => {
  assert.deepEqual(
    estimateDraftReviewNotes("Flooring", [
      { description: "Install flooring", quantity: 1, unit: "sq ft" },
    ]),
    [[]],
  );
});
