import { NextResponse } from "next/server";
import { canManageFreeDailyEstimateLimit, parseFreeDailyEstimateLimit } from "@/lib/free-estimate-limit.mjs";
import { requireTradeFlowAdmin, sameOrigin, validReason } from "@/lib/admin-support";

export async function GET() {
  const access = await requireTradeFlowAdmin("billing");
  if ("response" in access) return access.response;
  if (!canManageFreeDailyEstimateLimit(access.role)) {
    return NextResponse.json({ error: "Super administrator access is required." }, { status: 403 });
  }

  const { data, error } = await access.admin.from("tradeflow_app_settings")
    .select("free_daily_estimate_limit, updated_at")
    .eq("singleton", true)
    .single();
  if (error) {
    console.error("Could not read free estimate limit:", error.message);
    return NextResponse.json({ error: "Could not load the free estimate limit. Apply the daily limit migration." }, { status: 503 });
  }
  return NextResponse.json({ limit: data.free_daily_estimate_limit, updated_at: data.updated_at }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await requireTradeFlowAdmin("billing");
  if ("response" in access) return access.response;
  if (!canManageFreeDailyEstimateLimit(access.role)) {
    return NextResponse.json({ error: "Super administrator access is required." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const limit = parseFreeDailyEstimateLimit(body.limit);
  if (limit === null) return NextResponse.json({ error: "Limit must be a whole number from 0 to 10." }, { status: 400 });
  if (!validReason(body.reason)) return NextResponse.json({ error: "Provide a reason of at least 8 characters." }, { status: 400 });

  const { data, error } = await access.admin.rpc("update_free_daily_estimate_limit", {
    p_limit: limit,
    p_actor_user_id: access.user.id,
    p_actor_email: access.user.email ?? null,
    p_reason: body.reason.trim(),
  });
  if (error) {
    console.error("Could not update free estimate limit:", error.message);
    return NextResponse.json({ error: "Could not update the limit. Confirm the database migration is applied and retry." }, { status: 502 });
  }
  return NextResponse.json({ success: true, limit: data, message: `Free-tier daily limit updated to ${data} estimates.` }, { headers: { "Cache-Control": "no-store" } });
}
