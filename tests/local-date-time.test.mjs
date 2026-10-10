import test from "node:test";
import assert from "node:assert/strict";
import { localDateTimeToIso, toLocalDateTimeInput } from "../lib/localDateTime.mjs";

test("datetime-local values display and save in the contractor's local timezone", () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "America/Denver";
  try {
    assert.equal(toLocalDateTimeInput("2026-01-15T17:30:00.000Z"), "2026-01-15T10:30");
    assert.equal(localDateTimeToIso("2026-01-15T10:30"), "2026-01-15T17:30:00.000Z");
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("invalid and empty schedule values are handled without throwing", () => {
  assert.equal(toLocalDateTimeInput("not-a-date"), "");
  assert.equal(localDateTimeToIso(""), null);
});

test("rejects a wall-clock time that does not exist at the daylight-saving transition", () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "America/Denver";
  try {
    assert.equal(localDateTimeToIso("2026-03-08T02:30"), null);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("fall-back duplicate times require the contractor to choose another time",()=>{
 const old=process.env.TZ;process.env.TZ="America/New_York";
 try { assert.equal(localDateTimeToIso("2026-11-01T01:30"),null);assert.equal(localDateTimeToIso("2026-11-01T03:30"),"2026-11-01T08:30:00.000Z"); }
 finally {if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
