function finiteNumber(value, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function moneyToCents(value) {
  return Math.round(finiteNumber(value) * 100);
}

function percentageToBasisPoints(value) {
  return Math.round(finiteNumber(value) * 100);
}

function percentOfCents(cents, percent) {
  return Math.round((cents * percentageToBasisPoints(percent)) / 10_000);
}

/**
 * @param {{ package_options?: Array<{name: string, total: number | string}> | null, selected_package?: string | null, markup_percentage?: number | string, tax_rate?: number | string, require_deposit?: boolean, deposit_percentage?: number | string }} [estimate]
 * @param {Array<{quantity: number | string, unit_price: number | string}>} lineItems
 * @param {string | null} [selectedPackageName]
 */
export function calculateEstimateMoney(estimate = {}, lineItems = [], selectedPackageName = null) {
  const lineItemCents = lineItems.map((item) => {
    const quantity = finiteNumber(item.quantity, Number.NaN);
    const unitPriceCents = finiteNumber(item.unit_price, Number.NaN) * 100;
    return Number.isFinite(quantity) && quantity > 0
      ? Math.round(unitPriceCents * quantity)
      : 0;
  });

  const packages = Array.isArray(estimate.package_options) ? estimate.package_options : [];
  const selectedPackage = selectedPackageName
    ? packages.find((option) => option && option.name === selectedPackageName)
    : null;
  const subtotalCents = selectedPackage
    ? moneyToCents(selectedPackage.total)
    : lineItemCents.reduce((sum, amount) => sum + amount, 0);
  const markupCents = selectedPackage
    ? 0
    : percentOfCents(subtotalCents, estimate.markup_percentage);
  const taxCents = percentOfCents(subtotalCents + markupCents, estimate.tax_rate);
  const totalCents = subtotalCents + markupCents + taxCents;
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
