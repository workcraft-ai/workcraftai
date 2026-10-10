export type PriceBookRate = {
  name: string;
  description?: string;
  trade: string;
  unit: string;
  unit_price: number;
};

export type DraftLine = { description: string; quantity: number; unit?: string; unit_price: number };

export function applyPriceBookRates<T extends DraftLine>(
  lines: T[],
  rates: PriceBookRate[],
  trade: string,
  zeroUnmatched?: boolean,
): { lines: T[]; matchedCount: number; unmatchedCount: number; matchedIndexes: number[] };
