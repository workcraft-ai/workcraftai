import { NextResponse } from "next/server";
import { AVAILABILITY_MONITOR_HEARTBEAT_MAX_AGE_MS } from "@/lib/operational-heartbeats";

export const dynamic = "force-dynamic";

const HEALTH_TIMEOUT_MS = 3_000;

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let supabaseAuth: "ok" | "error" = "error";
  let supabaseDatabase: "ok" | "error" = "error";
  let scheduler: "ok" | "error" | "disabled" = process.env.SCHEDULER_SECRET ? "error" : "disabled";

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

  if (process.env.SCHEDULER_SECRET && supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const heartbeatUrl = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/operational_heartbeats`);
      heartbeatUrl.searchParams.set("name", "in.(supabase_scheduler_notifications,availability_monitor)");
      heartbeatUrl.searchParams.set("select", "name,last_success_at");
      const response = await fetch(heartbeatUrl, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (response.ok) {
        const rows: unknown = await response.json();
        const entries = Array.isArray(rows) ? rows as Array<{ name?: unknown; last_success_at?: unknown }> : [];
        const notificationHeartbeat = entries.find((row) => row.name === "supabase_scheduler_notifications")?.last_success_at;
        const availabilityHeartbeat = entries.find((row) => row.name === "availability_monitor")?.last_success_at;
        const notificationsFresh = typeof notificationHeartbeat === "string" && Date.now() - Date.parse(notificationHeartbeat) < 20 * 60_000;
        // Do not fail health before the monitor has recorded its first heartbeat.
        // GitHub's 15-minute schedule is best-effort; allow one delayed interval
        // so a late check does not make this health endpoint fail itself.
        const availabilityFresh = typeof availabilityHeartbeat !== "string"
          || Date.now() - Date.parse(availabilityHeartbeat) < AVAILABILITY_MONITOR_HEARTBEAT_MAX_AGE_MS;
        if (notificationsFresh && availabilityFresh) scheduler = "ok";
      }
    } catch {
      // An independent availability monitor will alert on this degraded check.
    }
  }

  const healthy = supabaseAuth === "ok" && supabaseDatabase === "ok" && scheduler !== "error";
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: { app: "ok", supabaseAuth, supabaseDatabase, scheduler },
      checkedAt: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
