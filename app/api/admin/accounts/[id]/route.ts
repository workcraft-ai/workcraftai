import { NextResponse } from "next/server";
import { requireTradeFlowAdmin } from "@/lib/admin-support";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireTradeFlowAdmin();
  if ("response" in access) return access.response;
  const { id } = await params;
  const { data: userData, error: userError } = await access.admin.auth.admin.getUserById(id);
  if (userError || !userData.user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const [{ data: subscription, error: subscriptionError }, { data: notes, error: notesError }, { data: audit, error: auditError }, { data: questions, error: questionsError }, { data: emails, error: emailsError }, { data: lifecycle, error: lifecycleError }, { data: adminMembership, error: adminError }, { data: proGrants, error: proGrantsError }] = await Promise.all([
    access.admin.from("subscriptions").select("status, current_period_end, stripe_customer_id, stripe_subscription_id, updated_at").eq("user_id", id).maybeSingle(),
    access.admin.from("tradeflow_support_notes").select("id, note, category, created_at, actor_user_id, actor_email").eq("target_user_id", id).order("created_at", { ascending: false }).limit(50),
    access.admin.from("tradeflow_admin_audit_log").select("id, action, reason, outcome, details, created_at, actor_user_id, actor_email").eq("target_user_id", id).order("created_at", { ascending: false }).limit(50),
    access.admin.from("proposal_questions").select("id, estimate_id, customer_name, customer_email, message, created_at, read_at").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
    access.admin.from("estimate_email_events").select("id, estimate_id, recipient, event, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
    access.admin.from("tradeflow_account_lifecycle").select("last_active_at, deletion_status, notice_sent_at, deletion_due_at").eq("user_id", id).maybeSingle(),
    access.admin.from("tradeflow_admins").select("user_id").eq("user_id", id).maybeSingle(),
    access.role === "support"
      ? Promise.resolve({ data: [], error: null })
      : access.admin.from("tradeflow_pro_access_grants").select("id, grant_type, reason, created_at, starts_at, expires_at, revoked_at")
        .eq("user_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  if (subscriptionError || notesError || auditError || questionsError || emailsError || lifecycleError || adminError || proGrantsError) {
    console.error("Admin account detail lookup failed:", subscriptionError?.message ?? notesError?.message ?? auditError?.message ?? questionsError?.message ?? emailsError?.message ?? lifecycleError?.message ?? adminError?.message ?? proGrantsError?.message);
    return NextResponse.json({ error: "Could not load account support history." }, { status: 502 });
  }
  let aiUsage: { daily_date: string; daily_used: number; daily_limit: number; monthly_month: string; monthly_used: number; monthly_limit: number } | null = null;
  if (access.role === "super_admin") {
    const today = new Date().toISOString().slice(0, 10);
    const month = `${today.slice(0, 7)}-01`;
    const [{ data: dailyUsage, error: dailyUsageError }, { data: monthlyUsage, error: monthlyUsageError }, { data: aiSettings, error: aiSettingsError }] = await Promise.all([
      access.admin.from("tradeflow_ai_daily_usage").select("attempts_started").eq("user_id", id).eq("usage_date", today).maybeSingle(),
      access.admin.from("tradeflow_ai_monthly_usage").select("attempts_started").eq("user_id", id).eq("usage_month", month).maybeSingle(),
      access.admin.from("tradeflow_app_settings").select("ai_daily_generation_limit, ai_monthly_generation_limit").eq("singleton", true).single(),
    ]);
    if (dailyUsageError || monthlyUsageError || aiSettingsError) {
      console.error("Admin AI allowance lookup failed:", dailyUsageError?.message ?? monthlyUsageError?.message ?? aiSettingsError?.message);
      return NextResponse.json({ error: "Could not load this account’s AI allowance." }, { status: 502 });
    }
    aiUsage = {
      daily_date: today,
      daily_used: dailyUsage?.attempts_started ?? 0,
      daily_limit: aiSettings.ai_daily_generation_limit,
      monthly_month: month,
      monthly_used: monthlyUsage?.attempts_started ?? 0,
      monthly_limit: aiSettings.ai_monthly_generation_limit,
    };
  }
  const user = userData.user;
  const now = Date.now();
  const proGrantHistory = (proGrants ?? []).map((grant) => ({
    ...grant,
    is_expired: Boolean(grant.expires_at && new Date(grant.expires_at).getTime() <= now),
  }));
  const activeProGrant = proGrantHistory.find((grant) => grant.revoked_at === null
    && new Date(grant.starts_at).getTime() <= now
    && (grant.expires_at === null || new Date(grant.expires_at).getTime() > now)) ?? null;
  return NextResponse.json({
    account: {
      id: user.id,
      email: user.email ?? "",
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at ?? null,
      last_active_at: lifecycle?.last_active_at ?? user.last_sign_in_at ?? user.created_at,
      deletion_status: lifecycle?.deletion_status ?? "active",
      deletion_notice_sent_at: lifecycle?.notice_sent_at ?? null,
      deletion_due_at: lifecycle?.deletion_due_at ?? null,
      is_admin: Boolean(adminMembership),
      email_confirmed_at: user.email_confirmed_at ?? null,
      banned_until: user.banned_until ?? null,
      business_name: typeof user.user_metadata?.business_name === "string" ? user.user_metadata.business_name : "",
      status: subscription?.status ?? "free",
      current_period_end: subscription?.current_period_end ?? null,
      has_stripe_subscription: Boolean(subscription?.stripe_subscription_id),
      subscription_updated_at: subscription?.updated_at ?? null,
      active_pro_grant: activeProGrant,
    },
    ai_usage: aiUsage,
    pro_grants: proGrantHistory,
    notes: notes ?? [],
    audit: audit ?? [],
    questions: questions ?? [],
    email_events: emails ?? [],
  }, { headers: { "Cache-Control": "no-store" } });
}
