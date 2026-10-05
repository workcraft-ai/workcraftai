import { calculateEstimateMoney } from "./estimate-money.mjs";

export function estimateTotalCents(estimate, lines) {
  const amount = calculateEstimateMoney(estimate, lines, estimate.selected_package).totalCents;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

export function paidCents(rows) {
  return rows.reduce((sum, row) => {
    if (!["succeeded", "partially_refunded", "refunded"].includes(row.status)) return sum;
    return sum + Math.max(0, Number(row.amount_cents) - Number(row.amount_refunded_cents));
  }, 0);
}
