export type ImportedPriceBookItem = {
  name: string;
  description: string;
  trade: string;
  unit: string;
  unit_price: number;
  pricing_basis?: string;
};

export function parsePriceBookCsv(text: string): ImportedPriceBookItem[];
