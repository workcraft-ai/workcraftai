import test from "node:test";
import assert from "node:assert/strict";
import { detectLogoContentType, MAX_LOGO_BYTES } from "../lib/logo-upload.ts";

test("logo uploads recognize only PNG, JPEG, and WebP signatures", () => {
  assert.equal(detectLogoContentType(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])), "image/png");
  assert.equal(detectLogoContentType(Uint8Array.from([255, 216, 255, 224])), "image/jpeg");
  assert.equal(detectLogoContentType(Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])), "image/webp");
  assert.equal(detectLogoContentType(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(detectLogoContentType(Uint8Array.from([0, 0, 0, 0])), null);
  assert.equal(MAX_LOGO_BYTES, 2_097_152);
});
