/**
 * Flag likely duplicate scope. These notes call attention to work a contractor
 * must verify; they do not alter quantities or rates.
 */

/**
 * @param {string} trade
 * @param {Array<{description: string, quantity: number, unit?: string}>} lines
 * @param {"en" | "es"} [language]
 * @returns {string[][]}
 */
export function estimateDraftReviewNotes(trade, lines, language = "en") {
  const notes = lines.map(() => []);
  if (!/(roof|techado|tejado)/i.test(trade)) return notes;

  const removalIndex = lines.findIndex((line) => /tear[ -]?off|remove.{0,35}(roof|shingle)|dispos(e|al).{0,35}(roof|shingle|debris)|debris/i.test(line.description));
  const cleanupIndex = lines.findIndex((line, index) => index !== removalIndex && /site\s+cleanup|clean\s*up|haul[- ]?away|haul[- ]?off|trash|dumpster/i.test(line.description));
  if (removalIndex >= 0 && cleanupIndex >= 0) {
    notes[cleanupIndex].push(language === "es"
      ? "Revisa que la limpieza, el acarreo y la eliminación de escombros no dupliquen lo que ya incluye la partida de retiro del techo."
      : "Check that cleanup, hauling, or debris disposal is not already included in the roof removal line.");
  }

  return notes;
}
