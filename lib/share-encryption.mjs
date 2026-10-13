import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function keyFromBase64(value) {
  if (!value) throw new Error("Share encryption is not configured.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("Invalid share encryption key.");
  return key;
}
export function encryptToken(token, encodedKey) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid share token.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromBase64(encodedKey), iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v2:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}
export function decryptToken(envelope, encodedKey, legacyCredential) {
  const modern = envelope.startsWith("v2:");
  if (!modern && !legacyCredential) throw new Error("Legacy share key is unavailable.");
  const key = modern ? keyFromBase64(encodedKey)
    : createHash("sha256").update(`workcraft-proposal-sharing-v1:${legacyCredential}`).digest();
  const value = modern ? envelope.slice(3) : envelope;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid share envelope.");
  const data = Buffer.from(value, "base64url");
  if (data.length !== 71) throw new Error("Invalid share envelope.");
  const cipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  const token = Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid share token.");
  return token;
}
