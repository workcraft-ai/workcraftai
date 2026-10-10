/** @typedef {{ name: string, description: string, trade: string, unit: string, unit_price: number }} ImportedPriceBookItem */

/** @param {string} text @returns {string[][]} */
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") { row.push(field.trim()); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("The CSV has an unclosed quotation mark.");
  row.push(field.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

/** @param {string} text @returns {ImportedPriceBookItem[]} */
export function parsePriceBookCsv(text) {
  if (text.length > 1_000_000) throw new Error("CSV must be smaller than 1 MB.");
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one item.");

  const headers = rows[0].map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  const column = (...names) => headers.findIndex((header) => names.includes(header));
  const nameIndex = column("name", "item", "service", "item_name", "service_name");
  const priceIndex = column("unit_price", "price", "rate", "your_price", "price_per_unit");
  if (nameIndex < 0 || priceIndex < 0) throw new Error("CSV must include a Name (or Item) column and a Unit Price (or Price) column.");

  const descriptionIndex = column("description", "details");
  const tradeIndex = column("trade", "category");
  const basisIndex = column("pricing_basis", "basis");
  const unitIndex = column("unit", "uom", "unit_of_measure");
  const result = rows.slice(1).map((values, index) => {
    const name = values[nameIndex]?.trim() ?? "";
    const rawPrice = (values[priceIndex] ?? "").replace(/[\s$]/g, "").replace(/,/g, "");
    const unit_price = Number(rawPrice);
    if (!name || name.length > 160) throw new Error(`Row ${index + 2}: item name is required and must be 160 characters or less.`);
    if (!rawPrice || !Number.isFinite(unit_price) || unit_price < 0 || unit_price > 9_999_999_999.99) {
      throw new Error(`Row ${index + 2}: enter a valid non-negative unit price.`);
    }
    return {
      name,
      description: (values[descriptionIndex] ?? "").slice(0, 500),
      trade: (values[tradeIndex] ?? "General").slice(0, 80) || "General",
      unit: (values[unitIndex] ?? "each").slice(0, 40) || "each",
      unit_price,
      ...(basisIndex < 0 ? {} : { pricing_basis: ["labor","materials","installed","other"].includes(values[basisIndex]) ? values[basisIndex] : "unknown" }),
    };
  });
  if (result.length > 500) throw new Error("Import up to 500 price book items at a time.");
  return result;
}
