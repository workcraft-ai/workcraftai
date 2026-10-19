export type ResendUsageWindow = { used: number; limit: number | null; resets_at?: string };

function readUsageWindow(value: unknown): ResendUsageWindow | null {
  if (!value || typeof value !== "object") return null;
  const window = value as { used?: unknown; limit?: unknown; resets_at?: unknown };
  if (typeof window.used !== "number" || !Number.isFinite(window.used)) return null;
  if (window.limit !== null && (typeof window.limit !== "number" || !Number.isFinite(window.limit))) return null;
  return {
    used: window.used,
    limit: window.limit as number | null,
    ...(typeof window.resets_at === "string" ? { resets_at: window.resets_at } : {}),
  };
}

export async function getResendEmailUsage(apiKey: string | undefined) {
  if (!apiKey) return null;
  try {
    const response = await fetch("https://api.resend.com/usage", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return null;
    const emails = (payload as { emails?: unknown }).emails;
    if (!emails || typeof emails !== "object") return null;
    const daily = readUsageWindow((emails as { daily?: unknown }).daily);
    const monthly = readUsageWindow((emails as { monthly?: unknown }).monthly);
    return daily && monthly ? { daily, monthly } : null;
  } catch {
    return null;
  }
}
