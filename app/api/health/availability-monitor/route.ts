import { NextResponse } from "next/server";
import { AVAILABILITY_MONITOR_HEARTBEAT_MAX_AGE_MS } from "@/lib/operational-heartbeats";

export const dynamic = "force-dynamic";

const HEALTH_TIMEOUT_MS = 3_000;

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let fresh = false;

  if (supabaseUrl && serviceKey) {
    try {
      const heartbeatUrl = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/operational_heartbeats`);
      heartbeatUrl.searchParams.set("name", "eq.availability_monitor");
      heartbeatUrl.searchParams.set("select", "last_success_at");
      heartbeatUrl.searchParams.set("limit", "1");
      const response = await fetch(heartbeatUrl, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (response.ok) {
        const rows: unknown = await response.json();
        const lastSuccess = Array.isArray(rows) ? rows[0]?.last_success_at : undefined;
        const ageMs = typeof lastSuccess === "string" ? Date.now() - Date.parse(lastSuccess) : Number.NaN;
        fresh = Number.isFinite(ageMs) && ageMs >= -60_000 && ageMs < AVAILABILITY_MONITOR_HEARTBEAT_MAX_AGE_MS;
      }
    } catch {
      // The independent uptime service will alert on a failed heartbeat lookup.
    }
  }

  return NextResponse.json(
    { status: fresh ? "ok" : "degraded", check: "availability_monitor" },
    { status: fresh ? 200 : 503, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
