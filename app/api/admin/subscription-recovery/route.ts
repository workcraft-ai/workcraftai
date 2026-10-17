import { NextResponse } from "next/server";
import { requireTradeFlowAdmin } from "@/lib/admin-support";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireTradeFlowAdmin("billing");
  if ("response" in access) return access.response;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [pastDue, inGrace, expiredGrace, retryScheduled, recovered, latest] = await Promise.all([
    access.admin.from("subscriptions").select("user_id", { count: "exact", head: true }).eq("status", "past_due"),
    access.admin.from("subscriptions").select("user_id", { count: "exact", head: true }).eq("status", "past_due").gt("grace_ends_at", new Date().toISOString()),
    access.admin.from("subscriptions").select("user_id", { count: "exact", head: true }).eq("status", "past_due").lte("grace_ends_at", new Date().toISOString()),
    access.admin.from("subscription_billing_invoices").select("invoice_id", { count: "exact", head: true }).eq("status", "open").gt("next_retry_at", new Date().toISOString()),
    access.admin.from("subscription_billing_invoices").select("invoice_id", { count: "exact", head: true }).eq("status", "paid").not("first_failed_at", "is", null).gte("paid_at", monthStart.toISOString()),
    access.admin.from("subscription_billing_invoices")
      .select("invoice_id,user_id,status,amount_due,currency,attempt_count,next_retry_at,first_failed_at,last_failed_at,paid_at,updated_at")
      .not("first_failed_at", "is", null).order("updated_at", { ascending: false }).limit(25),
  ]);
  const results = [pastDue, inGrace, expiredGrace, retryScheduled, recovered, latest];
  const failure = results.find((result) => result.error)?.error;
  if (failure) {
    console.error("Subscription recovery summary failed:", failure.message);
    return NextResponse.json({ error: "Could not load subscription recovery." }, { status: 502 });
  }
  const userIds = [...new Set((latest.data ?? []).map((item) => item.user_id))];
  const users = await Promise.all(userIds.map(async (id) => {
    const { data, error } = await access.admin.auth.admin.getUserById(id);
    if (error) throw error;
    return [id, data.user?.email ?? null] as const;
  })).catch((error) => {
    console.error("Subscription recovery account lookup failed:", error instanceof Error ? error.message : "unknown");
    return null;
  });
  if (!users) return NextResponse.json({ error: "Could not load subscription accounts." }, { status: 502 });
  const emailById = new Map(users);
  return NextResponse.json({
    counts: { past_due: pastDue.count ?? 0, in_grace: inGrace.count ?? 0,
      grace_ended: expiredGrace.count ?? 0, retry_scheduled: retryScheduled.count ?? 0,
      recovered_this_month: recovered.count ?? 0 },
    invoices: (latest.data ?? []).map((item) => ({ ...item, email: emailById.get(item.user_id) ?? "Account unavailable" })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
