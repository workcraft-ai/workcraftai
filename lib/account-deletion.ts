import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { finishAudit, startAudit } from "@/lib/admin-support";

type DeletionTrigger = "admin_requested" | "user_requested" | "inactivity" | "retry";

export class AccountDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

async function removeAccountMedia(admin: SupabaseClient, userId: string) {
  const bucket = admin.storage.from("estimate-media");
  const paths: string[] = [];

  async function collect(prefix: string): Promise<void> {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await bucket.list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new AccountDeletionError("Could not safely remove the account’s uploaded files.");
      if (!data?.length) break;
      for (const entry of data) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null && entry.metadata === null) await collect(path);
        else paths.push(path);
      }
      if (data.length < 100) break;
    }
  }

  await collect(userId);
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await bucket.remove(paths.slice(offset, offset + 100));
    if (error) throw new AccountDeletionError("Could not safely remove the account’s uploaded files.");
  }
}

export async function deleteTradeFlowAccount(input: {
  admin: SupabaseClient;
  targetUserId: string;
  actorUserId: string | null;
  actorEmail: string;
  reason: string;
  trigger: DeletionTrigger;
  alreadyClaimed?: boolean;
}) {
  const { admin, targetUserId, actorUserId, actorEmail, reason, trigger } = input;
  let auditId: string | null = null;
  let deletionStarted = Boolean(input.alreadyClaimed);
  let stage = "account_lookup";

  try {
    const { data: authResult, error: accountError } = await admin.auth.admin.getUserById(targetUserId);
    if (accountError || !authResult.user) throw new AccountDeletionError("The account could not be found.");

    const { data: adminMembership, error: adminLookupError } = await admin.from("tradeflow_admins").select("user_id").eq("user_id", targetUserId).maybeSingle();
    if (adminLookupError) throw new AccountDeletionError("Could not verify whether this account has administrator access.");
    if (adminMembership) throw new AccountDeletionError("Administrator accounts cannot be deleted through this workflow.");
    if (actorUserId === targetUserId && trigger !== "user_requested") throw new AccountDeletionError("You cannot delete the administrator account currently in use.");

    if (!deletionStarted) {
      const { data: claimed, error: claimError } = await admin.rpc("workcraft_begin_account_deletion", { p_user_id: targetUserId, p_reason: reason });
      if (claimError || claimed !== true) throw new AccountDeletionError("This account is already being deleted. Refresh and try again later.");
      deletionStarted = true;
    }

    auditId = await startAudit(admin, actorUserId, targetUserId, "account_deletion", reason, { trigger }, actorEmail);

    stage = "subscription_cancellation";
    const { data: subscription, error: subscriptionError } = await admin.from("subscriptions")
      .select("status, stripe_subscription_id").eq("user_id", targetUserId).maybeSingle();
    if (subscriptionError) throw new AccountDeletionError("Could not verify the account’s subscription status.");
    if (subscription?.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(subscription.status)) {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) throw new AccountDeletionError("Billing cancellation is not configured. The account was not deleted.");
      const stripe = new Stripe(stripeKey);
      const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
      if (!['canceled', 'incomplete_expired'].includes(stripeSubscription.status)) {
        await stripe.subscriptions.cancel(subscription.stripe_subscription_id);
      }
    }

    stage = "media_cleanup";
    await removeAccountMedia(admin, targetUserId);

    stage = "payment_record_cleanup";
    const { error: paymentError } = await admin.from("customer_payments").delete().eq("user_id", targetUserId);
    if (paymentError) throw new AccountDeletionError("Could not safely remove the account’s payment records.");

    stage = "auth_deletion";
    const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
    if (deleteError) throw new AccountDeletionError("The account could not be deleted. Support can safely retry this request.");

    if (auditId) await finishAudit(admin, auditId, "succeeded", { trigger });
    return { deleted: true };
  } catch (cause) {
    if (auditId) await finishAudit(admin, auditId, "failed", { trigger, failed_stage: stage });
    if (deletionStarted) {
      const { error } = await admin.rpc("workcraft_mark_account_deletion_retryable", { p_user_id: targetUserId });
      if (error) console.error("Could not mark failed account deletion for retry:", error.message);
    }
    if (cause instanceof AccountDeletionError) throw cause;
    console.error("Account deletion failed at stage", stage, cause instanceof Error ? cause.message : "unknown error");
    throw new AccountDeletionError("Account deletion did not finish. It remains queued for a safe retry; contact support if it is still pending tomorrow.");
  }
}
