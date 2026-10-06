import { NextResponse } from "next/server";
import { requireTradeFlowAdmin, sameOrigin, validReason } from "@/lib/admin-support";

export async function GET() {
  const access = await requireTradeFlowAdmin("billing");
  if ("response" in access) return access.response;
  if (access.role !== "super_admin") return NextResponse.json({ error: "Super administrator access is required." }, { status: 403 });

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: settings, error: settingsError }, { data: usage, error: usageError }] = await Promise.all([
    access.admin.from("tradeflow_app_settings").select("app_email_daily_limit").eq("singleton", true).single(),
    access.admin.from("tradeflow_app_email_daily_usage").select("emails_started").eq("usage_date", today).maybeSingle(),
  ]);
  if (settingsError || usageError) {
    console.error("Could not read app email limit:", settingsError?.message ?? usageError?.message);
    return NextResponse.json({ error: "Could not load the app email limit. Apply the global email limit migration." }, { status: 503 });
  }
  return NextResponse.json({ daily_limit: settings.app_email_daily_limit, today: { emails_started: usage?.emails_started ?? 0 } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await requireTradeFlowAdmin("billing");
  if ("response" in access) return access.response;
  if (access.role !== "super_admin") return NextResponse.json({ error: "Super administrator access is required." }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const limit = typeof body.limit === "number" ? body.limit : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 90) {
    return NextResponse.json({ error: "The app email limit must be a whole number from 1 to 90 per UTC day." }, { status: 400 });
  }
  if (!validReason(body.reason)) return NextResponse.json({ error: "Provide a reason of at least 8 characters." }, { status: 400 });

  const { data, error } = await access.admin.rpc("update_workcraft_email_daily_limit", {
    p_limit: limit,
    p_actor_user_id: access.user.id,
    p_actor_email: access.user.email ?? null,
    p_reason: body.reason.trim(),
  });
  if (error) {
    console.error("Could not update app email limit:", error.message);
    return NextResponse.json({ error: "Could not update the app email limit. Confirm the database migration is applied and retry." }, { status: 502 });
  }
  return NextResponse.json({ success: true, daily_limit: data, message: `App email limit updated to ${data} messages per UTC day.` }, { headers: { "Cache-Control": "no-store" } });
}
