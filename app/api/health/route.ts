import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HEALTH_TIMEOUT_MS = 3_000;

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let supabaseAuth: "ok" | "error" = "error";
  let supabaseDatabase: "ok" | "error" = "error";

  if (supabaseUrl && supabaseKey) {
    const baseUrl = supabaseUrl.replace(/\/$/, "");
    const headers = { apikey: supabaseKey };
    const [authResult, databaseResult] = await Promise.allSettled([
      fetch(`${baseUrl}/auth/v1/health`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      }),
      fetch(`${baseUrl}/rest/v1/rpc/workcraft_health_check`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      }),
    ]);
    if (authResult.status === "fulfilled" && authResult.value.ok) supabaseAuth = "ok";
    if (databaseResult.status === "fulfilled" && databaseResult.value.ok) {
      const health = await databaseResult.value.json().catch(() => false);
      if (health === true) supabaseDatabase = "ok";
    }
  }

  const healthy = supabaseAuth === "ok" && supabaseDatabase === "ok";
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: { app: "ok", supabaseAuth, supabaseDatabase },
      checkedAt: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
