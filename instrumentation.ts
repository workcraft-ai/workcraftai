import type { Instrumentation } from "next";

// Store only route-level diagnostics. Request headers, URLs, bodies, and raw
// error messages can contain customer data or credentials and are omitted.
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const errorType = error instanceof Error ? error.name : "UnknownError";
  const digest = error && typeof error === "object" && "digest" in error && typeof error.digest === "string"
    ? error.digest.slice(0, 160) : null;
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/operational_exceptions`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ route: context.routePath.slice(0, 160), error_type: errorType.slice(0, 100), digest }),
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) console.error("Operational exception could not be recorded:", context.routePath, response.status);
  } catch {
    console.error("Operational exception could not be recorded:", context.routePath);
  }
};
