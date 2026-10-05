import test from "node:test";
import assert from "node:assert/strict";
import { readLimitedJsonObject, readLimitedText } from "../lib/read-limited-body.mjs";

test("reads JSON within the configured byte limit", async () => {
  const request = new Request("https://example.test", { method: "POST", body: JSON.stringify({ description: "A valid estimate" }) });
  const result = await readLimitedJsonObject(request, 100);
  assert.deepEqual(result, { ok: true, value: { description: "A valid estimate" } });
});

test("rejects oversized content-length before parsing", async () => {
  const request = new Request("https://example.test", { method: "POST", headers: { "content-length": "101" }, body: "{}" });
  const result = await readLimitedText(request, 100);
  assert.deepEqual(result, { ok: false, reason: "too_large" });
});

test("rejects oversized streamed bodies even without content-length", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("0123456789"));
      controller.enqueue(new TextEncoder().encode("abcdefghij"));
      controller.close();
    },
  });
  const request = new Request("https://example.test", { method: "POST", body, duplex: "half" });
  const result = await readLimitedText(request, 12);
  assert.deepEqual(result, { ok: false, reason: "too_large" });
});

test("rejects malformed JSON and non-object payloads", async () => {
  const malformed = await readLimitedJsonObject(new Request("https://example.test", { method: "POST", body: "{" }), 100);
  const array = await readLimitedJsonObject(new Request("https://example.test", { method: "POST", body: "[]" }), 100);
  assert.deepEqual(malformed, { ok: false, reason: "invalid" });
  assert.deepEqual(array, { ok: false, reason: "invalid" });
});
