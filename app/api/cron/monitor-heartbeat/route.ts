import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createBoundedFetch } from "@/lib/bounded-fetch";
import { getCronCredential } from "@/lib/cron-authorization";
import { withApiFailureMetrics } from "@/lib/api-failure-metrics";

export const runtime = "nodejs";
export const maxDuration = 10;

export const POST = withApiFailureMetrics("/api/cron/monitor-heartbeat", async (request: Request) => {
  if (getCronCredential(request) !== "github") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Monitor heartbeat is not configured." }, { status: 503 });

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedFetch(3_000) },
  });
  const { error } = await admin.from("operational_heartbeats").upsert({
    name: "availability_monitor",
    last_success_at: new Date().toISOString(),
  });
  if (error) {
    console.error("Availability monitor heartbeat could not be saved.");
    return NextResponse.json({ error: "Monitor heartbeat could not be saved." }, { status: 503 });
  }
  return NextResponse.json({ recorded: true }, { headers: { "Cache-Control": "no-store" } });
});
