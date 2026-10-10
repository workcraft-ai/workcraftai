/** @typedef {{ id?: string, name: string, description?: string, trade: string, unit: string, unit_price: number }} PriceBookRate */
/** @typedef {{ description: string, quantity: number, unit_price: number, unit?: string }} DraftLine */

const genericWords = new Set([
  "a", "an", "and", "for", "installation", "install", "labor", "labour", "material", "materials",
  "replacement", "replace", "repair", "service", "work", "allowance", "standard", "the", "of", "to",
]);

const wordAliases = new Map([
  ["shingles", "shingle"], ["panels", "panel"], ["sheets", "sheet"],
  ["fixtures", "fixture"], ["valves", "valve"], ["fans", "fan"],
]);

/** @param {string} value */
function normalize(value) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** @param {string} value */
function meaningfulWords(value) {
  return [...new Set(normalize(value).split(" ")
    .map((word) => wordAliases.get(word) ?? word)
    .filter((word) => word.length > 2 && !genericWords.has(word)))];
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

/** @param {DraftLine} line @param {PriceBookRate} rate */
function isExactDescriptionMatch(line, rate) {
  const lineDescription = normalize(line.description);
  return lineDescription.length >= 5 && (
    lineDescription === normalize(rate.name) ||
    (typeof rate.description === "string" && lineDescription === normalize(rate.description))
  );
}

/** @param {Set<string>} left @param {Set<string>} right */
function f1Score(left, right) {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const word of left) if (right.has(word)) overlap++;
  if (!overlap) return 0;
  const precision = overlap / right.size;
  const recall = overlap / left.size;
  return (2 * precision * recall) / (precision + recall);
}

/** @param {DraftLine} line @param {PriceBookRate} rate */
function scoreRate(line, rate) {
  const lineWords = new Set(meaningfulWords(line.description));
  const nameWords = new Set(meaningfulWords(rate.name));
  const descriptionWords = new Set(meaningfulWords(rate.description ?? ""));
  const allRateWords = new Set([...nameWords, ...descriptionWords]);
  const overlapCount = [...lineWords].filter((word) => allRateWords.has(word)).length;
  const exact = isExactDescriptionMatch(line, rate);
  return {
    exact,
    overlapCount,
    score: exact ? 1 : Math.max(f1Score(lineWords, nameWords), f1Score(lineWords, descriptionWords), f1Score(lineWords, allRateWords)),
  };
}

/**
 * Apply only a strong, distinct contractor rate. Return weaker compatible options
 * as suggestions so the contractor can choose instead of silently inheriting a price.
 * @template {DraftLine} T
 * @param {T[]} lines
 * @param {PriceBookRate[]} rates
 * @param {string} trade
 * @param {boolean} [zeroUnmatched]
 * @returns {{ lines: T[], matchedCount: number, unmatchedCount: number, matchedIndexes: number[], suggestionsByIndex: Record<number, Array<PriceBookRate & { match_score: number }>> }}
 */
export function applyPriceBookRates(lines, rates, trade, zeroUnmatched = false) {
  let matchedCount = 0;
  const matchedIndexes = [];
  const suggestionsByIndex = {};
  const pricedLines = lines.map((line, index) => {
    const lineUnit = line.unit ? unitGroup(line.unit) : unitGroup(line.description, true);
    const candidates = rates.flatMap((rate) => {
      if (normalize(rate.trade) !== normalize(trade)) return [];
      if (!Number.isFinite(Number(rate.unit_price)) || Number(rate.unit_price) < 0) return [];
      if (/^(unknown|unspecified|n a|na)$/i.test(normalize(line.unit ?? "")) || /^(unknown|unspecified|n a|na)$/i.test(normalize(rate.unit))) return [];
      if (lineUnit !== unitGroup(rate.unit)) return [];
      const scored = scoreRate(line, rate);
      if (!scored.overlapCount || (!scored.exact && scored.score < 0.25)) return [];
      return [{ rate, ...scored }];
    }).sort((a, b) => b.score - a.score || a.rate.name.localeCompare(b.rate.name));

    const best = candidates[0];
    const second = candidates[1];
    const uniqueExact = Boolean(best?.exact && (!second || !second.exact));
    const distinctStrongMatch = Boolean(best && best.overlapCount >= 2 && best.score >= 0.9 && (!second || best.score - second.score >= 0.2));
    if (best && (uniqueExact || distinctStrongMatch)) {
      matchedCount++;
      matchedIndexes.push(index);
      return { ...line, unit_price: Number(best.rate.unit_price) };
    }

    if (candidates.length) {
      suggestionsByIndex[index] = candidates.slice(0, 3).map(({ rate, score }) => ({ ...rate, match_score: Math.round(score * 100) }));
    }
    return zeroUnmatched ? { ...line, unit_price: 0 } : line;
  });

  return { lines: pricedLines, matchedCount, unmatchedCount: lines.length - matchedCount, matchedIndexes, suggestionsByIndex };
}
