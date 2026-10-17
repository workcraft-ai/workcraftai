import { NextResponse } from "next/server";
import { requireTradeFlowAdmin, sameOrigin, validReason } from "@/lib/admin-support";

const fields = ["free_email_daily_limit", "free_email_monthly_limit", "pro_email_daily_limit", "pro_email_monthly_limit"] as const;

export async function GET() {
  const access = await requireTradeFlowAdmin("billing");
  if ("response" in access) return access.response;
  if (access.role !== "super_admin") return NextResponse.json({ error: "Super administrator access is required." }, { status: 403 });
  const { data, error } = await access.admin.from("tradeflow_app_settings").select(fields.join(",")).eq("singleton", true).single();
  if (error || !data) return NextResponse.json({ error: "Could not load account email allowances. Apply the account email quota migration." }, { status: 503 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await requireTradeFlowAdmin("billing");
  if ("response" in access) return access.response;
  if (access.role !== "super_admin") return NextResponse.json({ error: "Super administrator access is required." }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const freeDaily = Number(body.free_daily);
  const freeMonthly = Number(body.free_monthly);
  const proDaily = Number(body.pro_daily);
  const proMonthly = Number(body.pro_monthly);
  if (!Number.isInteger(freeDaily) || freeDaily < 0 || freeDaily > 10 ||
    !Number.isInteger(freeMonthly) || freeMonthly < 0 || freeMonthly > 100 ||
    !Number.isInteger(proDaily) || proDaily < 1 || proDaily > 50 ||
    !Number.isInteger(proMonthly) || proMonthly < 1 || proMonthly > 1000 ||
    (freeDaily === 0 && freeMonthly !== 0) || (freeDaily > 0 && freeMonthly < freeDaily) ||
    proMonthly < proDaily) {
    return NextResponse.json({ error: "Enter valid whole-number daily and monthly allowances. Monthly must be at least daily; Free 0/day requires 0/month." }, { status: 400 });
  }
  if (!validReason(body.reason)) return NextResponse.json({ error: "Provide a reason of at least 8 characters." }, { status: 400 });
  const { data, error } = await access.admin.rpc("update_workcraft_account_email_limits", {
    p_free_daily: freeDaily, p_free_monthly: freeMonthly, p_pro_daily: proDaily, p_pro_monthly: proMonthly,
    p_actor_user_id: access.user.id, p_actor_email: access.user.email ?? null, p_reason: body.reason.trim(),
  });
  if (error) {
    console.error("Could not update account email allowances:", error.message);
    return NextResponse.json({ error: "Could not update account email allowances. Confirm the database migration is applied and retry." }, { status: 502 });
  }
  return NextResponse.json({ ...data, message: "Account email allowances updated for all Free and trial/Pro accounts." }, { headers: { "Cache-Control": "private, no-store" } });
}
