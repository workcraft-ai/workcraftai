export function explicitRoofAreaSquareFeet(prompt: string, trade: string): number | null;
export function estimateDraftReviewNotes(
  prompt: string,
  trade: string,
  lines: Array<{ description: string; quantity: number; unit?: string }>,
  language?: "en" | "es",
): string[][];
