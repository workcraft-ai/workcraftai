const PHONE_CHARACTERS = /^[+0-9().\-\s]*(?:\s*(?:ext\.?|x|#)\s*\d+)?$/i;

/**
 * Phone numbers are optional. When supplied, accept common international
 * formatting and extensions while requiring 7–15 actual phone-number digits.
 * @param {unknown} value
 */
export function isValidOptionalPhone(value) {
  if (typeof value !== "string") return false;
  const phone = value.trim();
  if (!phone) return true;
  if (phone.length > 80 || !PHONE_CHARACTERS.test(phone)) return false;
  const withoutExtension = phone.replace(/(?:ext\.?|x|#)\s*\d+$/i, "");
  const digits = withoutExtension.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}
