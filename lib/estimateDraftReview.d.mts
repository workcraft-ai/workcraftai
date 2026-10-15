export function estimateDraftReviewNotes(
  trade: string,
  lines: Array<{ description: string; quantity: number; unit?: string }>,
  language?: "en" | "es",
): string[][];
