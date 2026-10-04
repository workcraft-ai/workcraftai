import { NextResponse } from "next/server";
import { requireTradeFlowAdmin } from "@/lib/admin-support";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireTradeFlowAdmin();
  if ("response" in access) return access.response;
  const { id } = await params;
  const { data: userData, error: userError } = await access.admin.auth.admin.getUserById(id);
  if (userError || !userData.user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const [{ data: subscription, error: subscriptionError }, { data: notes, error: notesError }, { data: audit, error: auditError }, { data: questions, error: questionsError }, { data: emails, error: emailsError }, { data: lifecycle, error: lifecycleError }, { data: adminMembership, error: adminError }] = await Promise.all([
    access.admin.from("subscriptions").select("status, current_period_end, stripe_customer_id, stripe_subscription_id, updated_at").eq("user_id", id).maybeSingle(),
    access.admin.from("tradeflow_support_notes").select("id, note, category, created_at, actor_user_id, actor_email").eq("target_user_id", id).order("created_at", { ascending: false }).limit(50),
    access.admin.from("tradeflow_admin_audit_log").select("id, action, reason, outcome, details, created_at, actor_user_id, actor_email").eq("target_user_id", id).order("created_at", { ascending: false }).limit(50),
    access.admin.from("proposal_questions").select("id, estimate_id, customer_name, customer_email, message, created_at, read_at").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
    access.admin.from("estimate_email_events").select("id, estimate_id, recipient, event, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
    access.admin.from("tradeflow_account_lifecycle").select("last_active_at, deletion_status, notice_sent_at, deletion_due_at").eq("user_id", id).maybeSingle(),
    access.admin.from("tradeflow_admins").select("user_id").eq("user_id", id).maybeSingle(),
  ]);
  if (subscriptionError || notesError || auditError || questionsError || emailsError || lifecycleError || adminError) {
    console.error("Admin account detail lookup failed:", subscriptionError?.message ?? notesError?.message ?? auditError?.message ?? questionsError?.message ?? emailsError?.message ?? lifecycleError?.message ?? adminError?.message);
    return NextResponse.json({ error: "Could not load account support history." }, { status: 502 });
  }
  const user = userData.user;
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
    },
    notes: notes ?? [],
    audit: audit ?? [],
    questions: questions ?? [],
    email_events: emails ?? [],
  }, { headers: { "Cache-Control": "no-store" } });
}
