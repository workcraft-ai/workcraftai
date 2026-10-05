import { NextResponse } from "next/server";
import { canManageFreeDailyEstimateLimit, parseFreeDailyEstimateLimit } from "@/lib/free-estimate-limit.mjs";
import { requireTradeFlowAdmin, sameOrigin, validReason } from "@/lib/admin-support";

export async function GET() {
  const access = await requireTradeFlowAdmin("billing");
  if ("response" in access) return access.response;
  if (!canManageFreeDailyEstimateLimit(access.role)) {
    return NextResponse.json({ error: "Super administrator access is required." }, { status: 403 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: settings, error: settingsError }, { data: usage, error: usageError }, { data: globalUsage, error: globalUsageError }] = await Promise.all([
    access.admin.from("tradeflow_app_settings").select("ai_drafting_enabled, ai_daily_generation_limit, ai_global_daily_generation_limit, updated_at").eq("singleton", true).single(),
    access.admin.from("tradeflow_ai_daily_usage").select("attempts_started, succeeded, failed").eq("usage_date", today),
    access.admin.from("tradeflow_ai_global_daily_usage").select("attempts_started").eq("usage_date", today).maybeSingle(),
  ]);
  if (settingsError || usageError || globalUsageError) {
    console.error("Could not read AI drafting settings:", settingsError?.message ?? usageError?.message ?? globalUsageError?.message);
    return NextResponse.json({ error: "Could not load AI drafting settings. Apply the AI cost controls migration." }, { status: 503 });
  }

  const totals = (usage ?? []).reduce((result, row) => ({
    attempts_started: result.attempts_started + row.attempts_started,
    succeeded: result.succeeded + row.succeeded,
    failed: result.failed + row.failed,
  }), { attempts_started: 0, succeeded: 0, failed: 0 });
  return NextResponse.json({ ...settings, today: { ...totals, global_attempts_started: globalUsage?.attempts_started ?? 0 } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await requireTradeFlowAdmin("billing");
  if ("response" in access) return access.response;
  if (!canManageFreeDailyEstimateLimit(access.role)) {
    return NextResponse.json({ error: "Super administrator access is required." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "The cloud drafting status must be enabled or paused." }, { status: 400 });
  const limit = parseFreeDailyEstimateLimit(body.daily_limit);
  if (limit === null || limit < 1) return NextResponse.json({ error: "The daily AI generation limit must be a whole number from 1 to 1,000." }, { status: 400 });
  const globalLimit = typeof body.global_daily_limit === "number" ? body.global_daily_limit : Number(body.global_daily_limit);
  if (!Number.isInteger(globalLimit) || globalLimit < 1 || globalLimit > 5000) return NextResponse.json({ error: "The platform-wide AI daily limit must be a whole number from 1 to 5,000." }, { status: 400 });
  if (!validReason(body.reason)) return NextResponse.json({ error: "Provide a reason of at least 8 characters." }, { status: 400 });

  const { data, error } = await access.admin.rpc("update_workcraft_ai_generation_settings", {
    p_enabled: body.enabled,
    p_daily_limit: limit,
    p_global_daily_limit: globalLimit,
    p_actor_user_id: access.user.id,
    p_actor_email: access.user.email ?? null,
    p_reason: body.reason.trim(),
  });
  if (error) {
    console.error("Could not update AI drafting settings:", error.message);
    return NextResponse.json({ error: "Could not update AI drafting settings. Confirm the database migration is applied and retry." }, { status: 502 });
  }
  return NextResponse.json({ success: true, ...data, message: `Cloud drafting ${data.enabled ? "enabled" : "paused"}; limits set to ${data.daily_limit} attempts per Pro account and ${data.global_daily_limit} across the platform per UTC day.` }, { headers: { "Cache-Control": "no-store" } });
}
