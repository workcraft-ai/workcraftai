import { createHmac, timingSafeEqual } from "node:crypto";

function header(headers, name) {
  if (headers && typeof headers.get === "function") return headers.get(name) ?? "";
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name);
  return typeof entry?.[1] === "string" ? entry[1] : "";
}

function decodeSignature(value) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) return null;
  return decoded;
}

/** Verify a Resend/Svix signature against the exact unparsed request body. */
export function verifyResendWebhook(secret, rawBody, headers, nowMs = Date.now()) {
  if (typeof secret !== "string" || !secret.startsWith("whsec_")) return false;
  const encodedKey = secret.slice("whsec_".length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey)) return false;
  const key = Buffer.from(encodedKey, "base64");
  if (key.length === 0 || key.toString("base64").replace(/=+$/, "") !== encodedKey.replace(/=+$/, "")) return false;

  const id = header(headers, "svix-id");
  const timestamp = header(headers, "svix-timestamp");
  const signature = header(headers, "svix-signature");
  if (!id || !/^\d+$/.test(timestamp) || !signature) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowMs / 1000 - timestampSeconds) > 300) return false;

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", key).update(signedContent, "utf8").digest();
  return signature.split(/\s+/).some((versionedSignature) => {
    const separator = versionedSignature.indexOf(",");
    if (separator < 0 || versionedSignature.slice(0, separator) !== "v1") return false;
    const candidate = decodeSignature(versionedSignature.slice(separator + 1));
    return candidate !== null && timingSafeEqual(expected, candidate);
  });
}
