/**
 * Add deterministic review notes for obvious duplicate/overlapping scope.
 * This never changes model quantities or prices; contractor-entered job details
 * remain the sole source of measurements.
 */
function normalize(value) {
  return String(value ?? "").normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** @param {string} _prompt @param {string} _trade @param {Array<{description: string, quantity: number, unit?: string}>} lines @param {"en" | "es"} [language] @returns {string[][]} */
export function estimateDraftReviewNotes(_prompt, _trade, lines, language = "en") {
  const notes = lines.map(() => []);
  const seen = new Map();
  for (const [index, line] of lines.entries()) {
    const normalizedDescription = normalize(line.description);
    if (normalizedDescription.length >= 12 && seen.has(normalizedDescription)) {
      notes[index].push(language === "es"
        ? "Esta descripción parece repetir otra partida. Confirma que no se esté cobrando dos veces."
        : "This description appears to repeat another line item. Confirm the work is not being charged twice.");
    } else if (normalizedDescription.length >= 12) seen.set(normalizedDescription, index);
  }

  const removalIndex = lines.findIndex((line) => /\b(remove|removal|tear off|demolition|demolish|dispose|disposal|retirada|demolicion|eliminacion)\b/.test(normalize(line.description)));
  const cleanupIndex = lines.findIndex((line, index) => index !== removalIndex && /\b(cleanup|clean up|haul away|haul off|trash|dumpster|limpieza|acarreo|basura)\b/.test(normalize(line.description)));
  if (removalIndex >= 0 && cleanupIndex >= 0) {
    notes[cleanupIndex].push(language === "es"
      ? "Confirma que la limpieza, el acarreo o la eliminación no estén incluidos también en la partida de retiro."
      : "Check that cleanup, hauling, or disposal is not already included in the removal line.");
  }
  return notes;
}
