/** @typedef {{ id?: string, name: string, description?: string, trade: string, unit: string, unit_price: number, pricing_basis?: string }} PriceBookRate */
/** @typedef {{ description: string, quantity: number, unit_price: number, unit?: string, pricing_basis?: string }} DraftLine */

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

/** @param {string} unit */
function unitGroup(unit) {
  const value = normalize(unit);
  const aliases = new Map([
    ["ea","each"],["piece","each"],["pieces","each"],["unit","each"],["units","each"],
    ["sheets","sheet"],["rolls","roll"],["boxes","box"],["jobs","job"],
    ["visits","visit"],["systems","system"],["hr","hour"],["hrs","hour"],["hours","hour"],
    ["sqft","sq ft"],["sf","sq ft"],["square feet","sq ft"],["square foot","sq ft"],
    ["lf","linear ft"],["linear feet","linear ft"],["linear foot","linear ft"],
    ["roofing squares","roofing square"],["square","roofing square"],["squares","roofing square"],
  ]);
  return aliases.get(value) ?? value;
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
    const lineUnit = unitGroup(line.unit ?? "unknown");
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
    const basisKnown = line.pricing_basis && line.pricing_basis !== "unknown" && line.pricing_basis === best?.rate.pricing_basis;
    const uniqueExact = Boolean(basisKnown && best?.exact && (!second || !second.exact));
    const distinctStrongMatch = Boolean(basisKnown && best && best.overlapCount >= 2 && best.score >= 0.9 && (!second || best.score - second.score >= 0.2));
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
