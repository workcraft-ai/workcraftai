/**
 * Generate deterministic review flags for common quantity/unit and double-counting
 * risks. These flags call attention to work a contractor must verify; they do not
 * alter a rate or tell the contractor what to charge.
 */

/** @param {string} value */
function normalize(value) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** @param {string} prompt @param {string} trade */
export function explicitRoofAreaSquareFeet(prompt, trade) {
  if (!/(roof|techado|tejado)/i.test(trade)) return null;
  const matches = [...prompt.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|sqft|square\s+feet|square\s+foot|pies?\s+cuadrados?)\b/gi)]
    .map((match) => ({
      area: Number(match[1].replace(/,/g, "")),
      index: match.index ?? 0,
      length: match[0].length,
    }))
    .filter((match) => Number.isFinite(match.area) && match.area > 0 && match.area <= 10_000_000);
  if (matches.length === 1) return matches[0].area;
  if (!matches.length) return null;

  const ranked = matches.map((match) => {
    const context = prompt.slice(Math.max(0, match.index - 60), Math.min(prompt.length, match.index + match.length + 60));
    const score = /(?:roof|roofing|techo|tejado)\s+surface\s+area\s*:/i.test(context)
      ? 2
      : /roof|roofing|techo|tejado/i.test(context)
        ? 1
        : 0;
    return { ...match, score };
  }).sort((a, b) => b.score - a.score);
  return ranked[0].score > 0 && ranked[0].score > ranked[1].score ? ranked[0].area : null;
}

/**
 * @param {string} prompt
 * @param {string} trade
 * @param {Array<{description: string, quantity: number, unit?: string}>} lines
 * @param {"en" | "es"} [language]
 * @returns {string[][]}
 */
export function estimateDraftReviewNotes(prompt, trade, lines, language = "en") {
  const notes = lines.map(() => []);
  if (!/(roof|techado|tejado)/i.test(trade)) return notes;

  const area = explicitRoofAreaSquareFeet(prompt, trade);
  if (area) {
    const areaLabel = new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", { maximumFractionDigits: 1 }).format(area);
    for (const [index, line] of lines.entries()) {
      const unit = normalize(line.unit ?? "");
      const isRoofSquare = /\b(roofing square|roof square|square|squares)\b/.test(unit);
      const isSquareFoot = /\b(sq ft|square feet|square foot|sqft)\b/.test(unit);
      const isRoofWork = /roof|shingle|underlayment|tear[ -]?off|deck|sheath/i.test(line.description);
      if (!isRoofWork || (!isRoofSquare && !isSquareFoot)) continue;

      const expected = isRoofSquare ? area / 100 : area;
      const allowedDifference = Math.max(1.5, expected * 0.25);
      if (Math.abs(Number(line.quantity) - expected) <= allowedDifference) continue;
      const quantityLabel = new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", { maximumFractionDigits: 2 }).format(Number(line.quantity));
      notes[index].push(language === "es"
        ? `La descripción menciona ${areaLabel} pies cuadrados, pero esta partida usa ${quantityLabel} ${isRoofSquare ? "cuadros de techo" : "pies cuadrados"}. Confirma que la medida sea la superficie real del techo y revisa el desperdicio y la pendiente. Un cuadro cubre 100 pies cuadrados antes de esos ajustes.`
        : `Your description mentions ${areaLabel} sq. ft., but this line uses ${quantityLabel} ${isRoofSquare ? "roofing squares" : "sq. ft."}. Confirm the measurement is the roof surface area and account for pitch and waste. One roofing square covers 100 sq. ft. before those adjustments.`);
    }
  }

  const removalIndex = lines.findIndex((line) => /tear[ -]?off|remove.{0,35}(roof|shingle)|dispos(e|al).{0,35}(roof|shingle|debris)|debris/i.test(line.description));
  const cleanupIndex = lines.findIndex((line, index) => index !== removalIndex && /site\s+cleanup|clean\s*up|haul[- ]?away|haul[- ]?off|trash|dumpster/i.test(line.description));
  if (removalIndex >= 0 && cleanupIndex >= 0) {
    notes[cleanupIndex].push(language === "es"
      ? "Revisa que la limpieza, el acarreo y la eliminación de escombros no dupliquen lo que ya incluye la partida de retiro del techo."
      : "Check that cleanup, hauling, or debris disposal is not already included in the roof removal line.");
  }

  return notes;
}
