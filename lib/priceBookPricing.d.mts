export type PriceBookRate = {
  id?: string;
  name: string;
  description?: string;
  trade: string;
  unit: string;
  unit_price: number;
  pricing_basis?: string;
};

export type DraftLine = { description: string; quantity: number; unit?: string; unit_price: number; pricing_basis?: string };

export function applyPriceBookRates<T extends DraftLine>(
  lines: T[],
  rates: PriceBookRate[],
  trade: string,
  zeroUnmatched?: boolean,
): {
  lines: T[];
  matchedCount: number;
  unmatchedCount: number;
  matchedIndexes: number[];
  suggestionsByIndex: Record<number, Array<PriceBookRate & { match_score: number }>>;
};
