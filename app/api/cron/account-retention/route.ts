import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { deleteTradeFlowAccount } from "@/lib/account-deletion";
import { getTrustedAppOrigin } from "@/lib/security.mjs";
import { getWorkCraftNoReplySender } from "@/lib/email-senders";
import { releaseAppEmail, reserveAppEmail } from "@/lib/email-quota";

export const maxDuration = 60;

function warningEmail(language: string, appUrl: string, supportEmail: string) {
  if (language === "es") {
    return {
      subject: "Tu cuenta de WorkCraft AI está programada para eliminarse",
      text: `No hemos registrado actividad en tu cuenta de WorkCraft AI durante 12 meses. Si no vuelves a iniciar sesión durante los próximos 30 días, eliminaremos tu cuenta y los datos asociados. Inicia sesión en ${appUrl}/login para mantener tu cuenta. Si necesitas ayuda, escribe a ${supportEmail}.`,
      html: `<p>No hemos registrado actividad en tu cuenta de WorkCraft AI durante 12 meses.</p><p>Si no vuelves a iniciar sesión durante los próximos 30 días, eliminaremos tu cuenta y los datos asociados.</p><p><a href="${appUrl}/login">Inicia sesión para mantener tu cuenta</a>.</p><p>Si necesitas ayuda, escribe a <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`,
    };
  }
  return {
    subject: "Your WorkCraft AI account is scheduled for deletion",
    text: `We have not recorded activity on your WorkCraft AI account for 12 months. If you do not sign in during the next 30 days, we will delete your account and associated data. Sign in at ${appUrl}/login to keep your account. If you need help, contact ${supportEmail}.`,
    html: `<p>We have not recorded activity on your WorkCraft AI account for 12 months.</p><p>If you do not sign in during the next 30 days, we will delete your account and associated data.</p><p><a href="${appUrl}/login">Sign in to keep your account</a>.</p><p>If you need help, contact <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`,
  };
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const sender = getWorkCraftNoReplySender();
  const appOrigin = getTrustedAppOrigin(process.env.NEXT_PUBLIC_APP_URL);
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@workcraftai.com";
  if (!cronSecret || !supabaseUrl || !serviceKey || !resendKey || !appOrigin) {
    return NextResponse.json({ error: "Account retention service is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: warnings, error: warningError } = await admin.rpc("workcraft_claim_inactivity_notices", { p_limit: 25 });
  if (warningError) {
    console.error("Could not claim inactivity notices:", warningError.message);
    return NextResponse.json({ error: "Could not process inactivity notices." }, { status: 503 });
  }

  let warned = 0;
  let warningFailures = 0;
  for (const entry of warnings ?? []) {
    if (!entry.email) {
      await admin.rpc("workcraft_finish_inactivity_notice", { p_user_id: entry.user_id, p_claimed_at: entry.claimed_at, p_sent: false });
      continue;
    }
    const { reservation, error: quotaError } = await reserveAppEmail(admin, "account_retention");
    if (quotaError || !reservation) {
      warningFailures += 1;
      console.error("Could not reserve account retention email quota:", quotaError?.message ?? "invalid reservation response");
      await admin.rpc("workcraft_finish_inactivity_notice", { p_user_id: entry.user_id, p_claimed_at: entry.claimed_at, p_sent: false });
      continue;
    }
    if (!reservation.allowed || !reservation.reservation_id) {
      warningFailures += 1;
      await admin.rpc("workcraft_finish_inactivity_notice", { p_user_id: entry.user_id, p_claimed_at: entry.claimed_at, p_sent: false });
      continue;
    }

    let sent: Response;
    try {
      const message = warningEmail(entry.language, appOrigin, supportEmail);
      sent = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `account-inactivity-notice-${entry.user_id}` },
        body: JSON.stringify({ from: sender, to: [entry.email], reply_to: supportEmail, ...message }),
      });
    } catch (cause) {
      warningFailures += 1;
      console.error("Inactivity notice failed for account", entry.user_id, cause instanceof Error ? cause.message : "unknown error");
      await admin.rpc("workcraft_finish_inactivity_notice", { p_user_id: entry.user_id, p_claimed_at: entry.claimed_at, p_sent: false });
      continue;
    }
    if (!sent.ok) {
      if (sent.status < 500) await releaseAppEmail(admin, reservation.reservation_id);
      warningFailures += 1;
      console.error("Inactivity notice provider rejected request:", sent.status);
      await admin.rpc("workcraft_finish_inactivity_notice", { p_user_id: entry.user_id, p_claimed_at: entry.claimed_at, p_sent: false });
      continue;
    }

    const { data: completed, error: finishError } = await admin.rpc("workcraft_finish_inactivity_notice", {
      p_user_id: entry.user_id, p_claimed_at: entry.claimed_at, p_sent: true,
    });
    if (finishError) {
      warningFailures += 1;
      console.error("Accepted inactivity email delivery could not be recorded:", finishError.message);
    } else if (completed) warned += 1;
  }

  const { data: dueAccounts, error: deletionClaimError } = await admin.rpc("workcraft_claim_due_account_deletions", { p_limit: 10 });
  if (deletionClaimError) {
    console.error("Could not claim due account deletions:", deletionClaimError.message);
    return NextResponse.json({ warned, warningFailures, error: "Could not process due account deletions." }, { status: 503 });
  }
  const { data: retryAccounts, error: retryClaimError } = await admin.rpc("workcraft_claim_failed_account_deletions", { p_limit: 10 });
  if (retryClaimError) {
    console.error("Could not claim failed account deletions:", retryClaimError.message);
    return NextResponse.json({ warned, warningFailures, error: "Could not retry account deletions." }, { status: 503 });
  }
  let deleted = 0;
  let deletionFailures = 0;
  type DeletionCandidate = { user_id: string; reason: string | null };
  const deletionTasks = [
    ...((dueAccounts ?? []) as DeletionCandidate[]).map((account) => ({ ...account, trigger: "inactivity" as const })),
    ...((retryAccounts ?? []) as DeletionCandidate[]).map((account) => ({ ...account, trigger: "retry" as const })),
  ];
  for (const account of deletionTasks) {
    try {
      await deleteTradeFlowAccount({
        admin, targetUserId: account.user_id, actorUserId: null, actorEmail: "WorkCraft AI retention service",
        reason: account.reason || "No authenticated app activity for 12 months; 30-day warning period elapsed.",
        trigger: account.trigger, alreadyClaimed: true,
      });
      deleted += 1;
    } catch {
      deletionFailures += 1;
    }
  }

  return NextResponse.json({ warned, warningFailures, deleted, deletionFailures, noticeCandidates: warnings?.length ?? 0, deletionCandidates: dueAccounts?.length ?? 0, deletionRetryCandidates: retryAccounts?.length ?? 0 });
}
