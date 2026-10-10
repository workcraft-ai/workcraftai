/** @typedef {{ name: string, description?: string, trade: string, unit: string, unit_price: number }} PriceBookRate */
/** @typedef {{ description: string, quantity: number, unit_price: number, unit?: string }} DraftLine */

const genericWords = new Set([
  "a", "an", "and", "for", "installation", "install", "labor", "material", "materials",
  "replacement", "replace", "repair", "service", "work", "allowance", "standard", "the",
]);

/** @param {string} value */
function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** @param {string} value */
function meaningfulWords(value) {
  return normalize(value).split(" ").filter((word) => word.length > 2 && !genericWords.has(word));
}

/** @param {string} unit @param {boolean} [fromDescription] */
function unitGroup(unit, fromDescription = false) {
  const parentheticalUnit = fromDescription ? unit.match(/\(([^)]+)\)/)?.[1] : undefined;
  const includesMeasurement = fromDescription && /\b(hours?|hrs?|sq\s*ft|square\s*(feet|foot)|sqft|sf|linear\s*ft|lin\s*ft|lf|feet|foot|ft|roofing\s*squares?|squares?|each|units?|pieces?|sheets?|rolls?|boxes|visits?|systems?|jobs?|items?)\b/i.test(unit);
  const describedUnit = fromDescription
    ? parentheticalUnit ?? (includesMeasurement ? unit : "each")
    : unit;
  const value = normalize(describedUnit);
  if (/\b(hours?|hrs?)\b/.test(value)) return "hour";
  if (/\b(sq\s*ft|square\s*(feet|foot)|sqft|sf)\b/.test(value)) return "area";
  if (/\b(linear\s*ft|lin\s*ft|lf|feet|foot|ft)\b/.test(value)) return "length";
  if (/\b(roofing\s*squares?|squares?)\b/.test(value)) return "roofing_square";
  if (/\b(each|unit|piece|pieces|sheet|sheets|roll|rolls|box|boxes|visit|system|job|item)\b/.test(value)) return "count";
  return value;
}

/**
 * Apply only unambiguous contractor rates with compatible units and trade.
 * @template {DraftLine} T
 * @param {T[]} lines
 * @param {PriceBookRate[]} rates
 * @param {string} trade
 * @param {boolean} [zeroUnmatched]
 * @returns {{ lines: T[], matchedCount: number, unmatchedCount: number, matchedIndexes: number[] }}
 */
export function applyPriceBookRates(lines, rates, trade, zeroUnmatched = false) {
  let matchedCount = 0;
  const matchedIndexes = [];
  const pricedLines = lines.map((line, index) => {
    const scopeWords = new Set(meaningfulWords(line.description));
    const lineUnit = line.unit ? unitGroup(line.unit) : unitGroup(line.description, true);
    const candidates = rates.flatMap((rate) => {
      if (normalize(rate.trade) !== normalize(trade)) return [];
      if (!Number.isFinite(Number(rate.unit_price)) || Number(rate.unit_price) < 0) return [];
      const rateUnit = unitGroup(rate.unit);
      if (lineUnit !== rateUnit) return [];
      const rateWords = meaningfulWords(rate.name);
      if (!rateWords.length) return [];
      const overlap = rateWords.filter((word) => scopeWords.has(word)).length;
      const score = overlap / rateWords.length;
      return score >= 0.8 ? [{ rate, score }] : [];
    }).sort((a, b) => b.score - a.score);

    const isUniqueBest = candidates.length > 0 &&
      (candidates.length === 1 || candidates[0].score > candidates[1].score);
    if (isUniqueBest) {
      matchedCount++;
      matchedIndexes.push(index);
      return { ...line, unit_price: Number(candidates[0].rate.unit_price) };
    }
    return zeroUnmatched ? { ...line, unit_price: 0 } : line;
  });

  return { lines: pricedLines, matchedCount, unmatchedCount: lines.length - matchedCount, matchedIndexes };
}
