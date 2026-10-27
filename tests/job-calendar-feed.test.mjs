import test from "node:test";
import assert from "node:assert/strict";
import { renderJobCalendar } from "../lib/job-calendar-feed.ts";

const preferences = {
  include_estimate_jobs: true,
  include_standalone_jobs: true,
  include_completed_jobs: false,
  show_customer_name: false,
};

const job = {
  id: "80e1a01c-a2db-432c-bcad-4f6ebbd0a1b1",
  title: "Jordan's plumbing job",
  client_name: "Jordan",
  client_email: "jordan@example.com",
  job_address: "10 Main St, Durham, NC",
  notes: "Private gate code 1234",
  estimate_id: "est_123",
  scheduled_at: "2026-11-05T14:00:00.000Z",
  scheduled_end_at: "2026-11-05T16:30:00.000Z",
  schedule_timezone: "America/New_York",
  status: "scheduled",
  updated_at: "2026-10-27T12:00:00.000Z",
};

test("calendar feed omits private notes, customer email, and name by default", () => {
  const output = renderJobCalendar([job], preferences, "https://app.workcraftai.com");
  assert.match(output, /SUMMARY:WorkCraft AI job\r\n/);
  assert.match(output, /DTSTART:20261105T140000Z\r\n/);
  assert.match(output, /DTEND:20261105T163000Z\r\n/);
  assert.ok(output.includes("LOCATION:10 Main St\\, Durham\\, NC\r\n"));
  assert.doesNotMatch(output, /jordan@example\.com|Private gate code|Jordan/);
});

test("selected job categories, completed jobs, and customer name follow preferences", () => {
  const direct = { ...job, id: "direct", estimate_id: null, status: "completed" };
  const output = renderJobCalendar([job, direct], {
    ...preferences, include_estimate_jobs: false, include_completed_jobs: true,
    show_customer_name: true,
  }, "https://app.workcraftai.com");
  assert.doesNotMatch(output, new RegExp(job.id));
  assert.match(output, /UID:direct@workcraftai.com/);
  assert.match(output, /Jordan's plumbing job/);
  assert.doesNotMatch(output, /jordan@example\.com|Private gate code/);
});

test("rescheduling retains UID and changes calendar time", () => {
  const before = renderJobCalendar([job], preferences, "https://app.workcraftai.com");
  const after = renderJobCalendar([{ ...job, scheduled_at: "2026-11-06T14:00:00.000Z", scheduled_end_at: "2026-11-06T16:30:00.000Z" }], preferences, "https://app.workcraftai.com");
  assert.match(before, new RegExp(`UID:${job.id}@workcraftai.com`));
  assert.match(after, new RegExp(`UID:${job.id}@workcraftai.com`));
  assert.match(after, /DTSTART:20261106T140000Z/);
  assert.doesNotMatch(after, /DTSTART:20261105T140000Z/);
});
