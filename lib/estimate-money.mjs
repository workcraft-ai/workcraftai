// Exact base-10 arithmetic, matching PostgreSQL numeric ROUND (half away
// from zero). Decimal strings are converted to BigInt ratios before multiplying.
function decimal(value) {
  const text = String(value ?? 0).trim();
  if (text.length > 120) return [0n, 1n];
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || !(match[2] || match[3])) return [0n, 1n];
  const exponent = Number(match[4] || 0);
  const scale = (match[3] || "").length - exponent;
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 100) return [0n, 1n];
  const coefficient = BigInt((match[2] || "0") + (match[3] || "")) * (match[1] === "-" ? -1n : 1n);
  return scale >= 0 ? [coefficient, 10n ** BigInt(scale)] : [coefficient * 10n ** BigInt(-scale), 1n];
}
function rounded(numerator, denominator) {
  const sign = numerator < 0n ? -1n : 1n;
  const magnitude = numerator * sign;
  return sign * (magnitude / denominator + (2n * (magnitude % denominator) >= denominator ? 1n : 0n));
}
function safeCents(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError("Financial amount exceeds safe integer range.");
  return result;
}
function moneyToCents(value) {
  const [n, d] = decimal(value);
  return safeCents(rounded(n * 100n, d));
}
function percentOfCents(cents, percent, scale = null) {
  let [n, d] = decimal(percent);
  // These scales match estimates.markup_percentage numeric(6,2) and tax_rate
  // numeric(6,3). Deposit percentages in estimates have unrestricted precision.
  if (scale !== null) { const unit = 10n ** BigInt(scale); n = rounded(n * unit, d); d = unit; }
  return safeCents(rounded(BigInt(cents) * n, d * 100n));
}

/**
 * @param {{ package_options?: Array<{name: string, total: number | string}> | null, selected_package?: string | null, markup_percentage?: number | string, tax_rate?: number | string, require_deposit?: boolean, deposit_percentage?: number | string }} [estimate]
 * @param {Array<{quantity: number | string, unit_price: number | string}>} lineItems
 * @param {string | null} [selectedPackageName]
 */
export function calculateEstimateMoney(estimate = {}, lineItems = [], selectedPackageName = null) {
  const lineItemCents = lineItems.map((item) => {
    const [quantity, quantityScale] = decimal(item.quantity);
    const [price, priceScale] = decimal(item.unit_price);
    return quantity > 0n ? safeCents(rounded(quantity * price * 100n, quantityScale * priceScale)) : 0;
  });

  const packages = Array.isArray(estimate.package_options) ? estimate.package_options : [];
  const selectedPackage = selectedPackageName
    ? packages.find((option) => option && option.name === selectedPackageName)
    : null;
  const subtotalCents = selectedPackage
    ? moneyToCents(selectedPackage.total)
    : safeCents(lineItemCents.reduce((sum, amount) => sum + BigInt(amount), 0n));
  const markupCents = selectedPackage
    ? 0
    : percentOfCents(subtotalCents, estimate.markup_percentage, 2);
  const taxCents = percentOfCents(subtotalCents + markupCents, estimate.tax_rate, 3);
  const totalCents = safeCents(BigInt(subtotalCents) + BigInt(markupCents) + BigInt(taxCents));
  const depositCents = estimate.require_deposit
    ? percentOfCents(totalCents, estimate.deposit_percentage)
    : 0;

  return {
    lineItemCents,
    subtotalCents,
    markupCents,
    taxCents,
    totalCents,
    depositCents,
  };
}

export function centsToAmount(cents) {
  return cents / 100;
}

export function amountToCents(amount) {
  return moneyToCents(amount);
}

/** @param {number} cents @param {number | string} percentage */
export function percentageOfCents(cents, percentage) {
  return percentOfCents(cents, percentage);
}
