/** Accept common phone formatting while rejecting names, notes, and short numbers. */
export function isValidOptionalBusinessPhone(value: string): boolean {
  const phone = value.trim();
  if (!phone) return true;
  if (phone.length > 40) return false;
  const match = phone.match(/^(\+?[\d\s().-]+?)(?:\s*(?:ext\.?|x)\s*\d{1,6})?$/i);
  if (!match) return false;
  const number = match[1];
  const digits = number.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && (number.match(/\+/g)?.length ?? 0) <= 1;
}
