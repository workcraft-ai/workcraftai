import { NextResponse } from "next/server";
import { requireTradeFlowAdmin } from "@/lib/admin-support";
import { getResendEmailUsage } from "@/lib/resend-usage";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET() {
  const access = await requireTradeFlowAdmin("super_admin");
  if ("response" in access) return access.response;

  const today = new Date().toISOString().slice(0, 10);
  const [capacity, pressure, settings, emailUsage, aiUsage, webhookFailures, notificationFailures, heartbeats, resend] = await Promise.all([
    access.admin.rpc("workcraft_infrastructure_usage"),
    access.admin.rpc("workcraft_db_pressure"),
    access.admin.from("tradeflow_app_settings").select("app_email_daily_limit,ai_global_daily_generation_limit").eq("singleton", true).single(),
    access.admin.from("tradeflow_app_email_daily_usage").select("emails_started").eq("usage_date", today).maybeSingle(),
    access.admin.from("tradeflow_ai_global_daily_usage").select("attempts_started").eq("usage_date", today).maybeSingle(),
    access.admin.from("stripe_webhook_events").select("event_id", { count: "exact", head: true }).eq("status", "failed"),
    access.admin.from("notification_outbox").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString()),
    access.admin.from("operational_heartbeats").select("name,last_success_at").in("name", ["availability_monitor", "database_backup", "private_media_backup"]),
    getResendEmailUsage(process.env.RESEND_USAGE_API_KEY),
  ]);

  const errors: string[] = [];
  if (capacity.error) errors.push("supabase_capacity");
  if (pressure.error) errors.push("supabase_connections");
  if (settings.error || emailUsage.error || aiUsage.error) errors.push("app_allowances");
  if (webhookFailures.error || notificationFailures.error) errors.push("delivery_health");
  if (heartbeats.error) errors.push("backup_freshness");
  if (!resend) errors.push("resend_provider_usage");
  if (errors.length) console.error("Infrastructure overview has unavailable sources:", errors.join(", "));

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    errors,
    supabase: capacity.error ? null : capacity.data,
    connections: pressure.error ? null : pressure.data,
    resend,
    app: settings.error || emailUsage.error || aiUsage.error ? null : {
      email_today: emailUsage.data?.emails_started ?? 0,
      email_daily_limit: settings.data.app_email_daily_limit,
      ai_today: aiUsage.data?.attempts_started ?? 0,
      ai_daily_limit: settings.data.ai_global_daily_generation_limit,
    },
    delivery: webhookFailures.error || notificationFailures.error ? null : {
      failed_stripe_webhooks: webhookFailures.count ?? 0,
      failed_notifications: notificationFailures.count ?? 0,
    },
    heartbeats: heartbeats.error ? null : heartbeats.data,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
