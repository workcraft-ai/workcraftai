import { NextResponse } from "next/server";
import { DEFAULT_ESTIMATE_TRADES, parseEstimateTradeOptions } from "@/lib/estimate-trades";
import { requireTradeFlowAdmin, sameOrigin, validReason } from "@/lib/admin-support";

export async function GET() {
  const access = await requireTradeFlowAdmin("super_admin");
  if ("response" in access) return access.response;

  const { data, error } = await access.admin.from("tradeflow_app_settings")
    .select("estimate_trade_options, updated_at")
    .eq("singleton", true)
    .single();
  if (error) {
    console.error("Could not load estimate trade settings:", error.message);
    return NextResponse.json({ error: "Could not load the estimate trade list. Apply the admin trades migration." }, { status: 503 });
  }
  return NextResponse.json({ trades: parseEstimateTradeOptions(data.estimate_trade_options) ?? DEFAULT_ESTIMATE_TRADES, updated_at: data.updated_at }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await requireTradeFlowAdmin("super_admin");
  if ("response" in access) return access.response;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const trades = parseEstimateTradeOptions(body.trades);
  if (!trades) return NextResponse.json({ error: "Add 1–40 unique trades, with an English name and Spanish label of 1–60 characters each." }, { status: 400 });
  if (!validReason(body.reason)) return NextResponse.json({ error: "Provide a reason of at least 8 characters." }, { status: 400 });

  const { data, error } = await access.admin.rpc("update_workcraft_estimate_trade_options", {
    p_trade_options: trades,
    p_actor_user_id: access.user.id,
    p_actor_email: access.user.email ?? null,
    p_reason: body.reason.trim(),
  });
  if (error) {
    console.error("Could not update estimate trade options:", error.message);
    return NextResponse.json({ error: "Could not save the estimate trade list. Confirm the admin trades migration is applied and retry." }, { status: 502 });
  }
  return NextResponse.json({ success: true, trades: data?.trades ?? trades, message: "Estimate trade options saved." }, { headers: { "Cache-Control": "no-store" } });
}
