export type EstimateTradeOption = { value: string; label_es: string };

export const DEFAULT_ESTIMATE_TRADES: EstimateTradeOption[] = [
  { value: "Plumbing", label_es: "Plomería" },
  { value: "Electrical", label_es: "Electricidad" },
  { value: "Roofing", label_es: "Techado" },
  { value: "HVAC", label_es: "Climatización" },
  { value: "Painting", label_es: "Pintura" },
  { value: "Carpentry", label_es: "Carpintería" },
  { value: "General contracting", label_es: "Contratación general" },
  { value: "Other", label_es: "Otro" },
];

export function parseEstimateTradeOptions(input: unknown): EstimateTradeOption[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > 40) return null;
  const options: EstimateTradeOption[] = [];
  const seenValues = new Set<string>();

  for (const candidate of input) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const record = candidate as Record<string, unknown>;
    const value = typeof record.value === "string" ? record.value.trim() : "";
    const labelEs = typeof record.label_es === "string" ? record.label_es.trim() : "";
    if (!value || value.length > 60 || !labelEs || labelEs.length > 60) return null;
    if (/[\u0000-\u001f\u007f]/u.test(value) || /[\u0000-\u001f\u007f]/u.test(labelEs)) return null;
    const normalized = value.toLowerCase();
    if (seenValues.has(normalized)) return null;
    seenValues.add(normalized);
    options.push({ value, label_es: labelEs });
  }

  return options;
}
