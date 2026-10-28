import Stripe from "stripe";
import { SubscriptionRefreshBusyError, syncStripeSubscription } from "@/lib/stripe-subscription-sync";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getStripeWebhookClaimAction } from "@/lib/stripe-webhook-claim.mjs";
import { getInvoiceSubscriptionId } from "@/lib/stripe-invoice.mjs";
import { enqueueNotification, escapeEmailHtml, notificationFrame, processNotifications } from "@/lib/notification-outbox";
import { getWorkCraftNoReplySender } from "@/lib/email-senders";
import { createBoundedFetch } from "@/lib/bounded-fetch";
import { getServiceSupabase } from "@/lib/stripe-server";

export async function processVerifiedStripeEvent(event: Stripe.Event) {
  const deadlineAt = Date.now() + 25_000;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeKey || !serviceRoleKey) return NextResponse.json({ error: "Stripe worker is not configured." }, { status: 503 });
  const stripe = new Stripe(stripeKey, { timeout: 8_000, maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(createBoundedFetch(8_000, deadlineAt)) });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { persistSession: false },
    global: { fetch: createBoundedFetch(5_000, deadlineAt) },
  });
  const { data: claimState, error: claimError } = await admin.rpc("workcraft_claim_stripe_webhook_state", {
    p_event_id: event.id,
    p_event_type: event.type,
  });
  if (claimError) {
    console.error("Stripe webhook idempotency check failed:", claimError.message);
    return NextResponse.json({ error: "Webhook processing is temporarily unavailable." }, { status: 503 });
  }
  const claimAction = getStripeWebhookClaimAction(claimState);
  if (claimAction === "acknowledge_duplicate") {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (claimAction === "retry") {
    return NextResponse.json({ received: true, processing: true }, { status: 202 });
  }

  async function syncCustomerPayment(paymentId: string, connectedAccountId: string, paymentIntentId?: string | null) {
    const { error } = await admin.rpc("workcraft_apply_customer_payment_state", {
      p_payment_id: paymentId, p_stripe_account_id: connectedAccountId,
      p_state: "succeeded", p_payment_intent_id: paymentIntentId ?? null,
    });
    if (error) throw error;
  }

  async function syncRefund(charge: Stripe.Charge, connectedAccountId: string) {
    // Fetch current cumulative refunds; the RPC also prevents concurrent/stale
    // deliveries from lowering that amount and recalculates totals atomically.
    const current = await stripe.charges.retrieve(charge.id, {}, { stripeAccount: connectedAccountId });
    const paymentIntentId = typeof current.payment_intent === "string" ? current.payment_intent : current.payment_intent?.id;
    if (!paymentIntentId) return;
    const { error } = await admin.rpc("workcraft_apply_customer_payment_state", {
      p_payment_id: null, p_stripe_account_id: connectedAccountId,
      p_state: "refunded", p_payment_intent_id: paymentIntentId,
      p_refunded_cents: current.amount_refunded,
    });
    if (error) throw error;
  }

  const syncSubscription = (subscriptionId: string) => syncStripeSubscription(admin, stripe, subscriptionId);

  async function notifyConnectedPaymentDispute(disputeId: string, connectedAccountId: string) {
    // Retrieve current state so an old webhook cannot send a stale action alert.
    const dispute = await stripe.disputes.retrieve(disputeId, {}, { stripeAccount: connectedAccountId });
    const intentId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!intentId) return;
    const { data: payment, error: paymentError } = await admin.from("customer_payments")
      .select("user_id,estimate_id").eq("stripe_account_id", connectedAccountId)
      .eq("stripe_payment_intent_id", intentId).maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return;
    const [{ data: owner, error: ownerError }, { data: estimate, error: estimateError }] = await Promise.all([
      admin.auth.admin.getUserById(payment.user_id),
      admin.from("estimates").select("reference_number").eq("id", payment.estimate_id).single(),
    ]);
    if (ownerError || estimateError) throw new Error("Could not identify the connected payment dispute owner.");
    if (!owner.user?.email) return;
    const spanish = owner.user.user_metadata?.app_language === "es";
    const language = spanish ? "es" : "en";
    const reference = estimate.reference_number || payment.estimate_id;
    const status = dispute.status;
    const spanishStatus: Record<string, string> = {
      needs_response: "requiere respuesta", under_review: "en revisión", won: "ganada", lost: "perdida",
      warning_needs_response: "advertencia que requiere respuesta", warning_under_review: "advertencia en revisión", warning_closed: "advertencia cerrada",
    };
    const displayStatus = spanish ? (spanishStatus[status] || status) : status.replaceAll("_", " ");
    const amount = new Intl.NumberFormat(spanish ? "es-US" : "en-US", { style: "currency", currency: dispute.currency.toUpperCase() }).format(dispute.amount / 100);
    const title = spanish ? "Actualización de disputa de pago" : "Customer payment dispute update";
    const detail = spanish
      ? `Stripe informa que la disputa de ${reference} por ${amount} está en estado: ${displayStatus}. Revisa tu panel de Stripe para ver plazos, pruebas y próximos pasos.`
      : `Stripe reports that the dispute for ${reference} (${amount}) is now ${displayStatus}. Review your Stripe Dashboard for deadlines, evidence, and next steps.`;
    const dashboardUrl = "https://dashboard.stripe.com/disputes";
    const queued = await enqueueNotification(admin, {
      user_id: payment.user_id, source: "billing", send_key: `connected-dispute-${connectedAccountId}-${dispute.id}-${status}`,
      payload: {
        from: getWorkCraftNoReplySender(), to: [owner.user.email],
        subject: `${title} · ${reference}`.replace(/[\r\n]/g, " ").slice(0, 200),
        text: `${detail}\n\n${dashboardUrl}`,
        html: notificationFrame(language, title, `<p>${escapeEmailHtml(detail)}</p><p><a href="${dashboardUrl}">${spanish ? "Abrir el panel de Stripe" : "Open Stripe Dashboard"}</a></p>`),
      },
    });
    try { await processNotifications(admin, [queued.id], 1, 3_000, deadlineAt); }
    catch { console.error("Connected payment dispute notice remains queued."); }
  }

  try {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentId = session.metadata?.payment_id;
    if (paymentId && session.payment_status === "paid" && event.account) {
      const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      await syncCustomerPayment(paymentId, event.account, paymentIntentId);
    }
    const userId = session.client_reference_id || session.metadata?.user_id;
    if (session.mode === "subscription" && userId && session.subscription) {
      // Verify the current provider session before authorizing a new identity.
      const completed = await stripe.checkout.sessions.retrieve(session.id);
      const attemptId = completed.metadata?.checkout_attempt_id;
      const completedUser = completed.client_reference_id || completed.metadata?.user_id;
      const subscriptionId = typeof completed.subscription === "string" ? completed.subscription : completed.subscription?.id;
      if (completed.mode !== "subscription" || completed.status !== "complete" || !attemptId
        || completedUser !== userId || !subscriptionId) throw new Error("Subscription checkout could not be verified.");
      await syncStripeSubscription(admin, stripe, subscriptionId, { userId, attemptId, sessionId: completed.id });
    }
  }

  if (event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.payment_id && event.account) {
      const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      await syncCustomerPayment(session.metadata.payment_id, event.account, paymentIntentId);
    }
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode === "subscription" && session.metadata?.user_id && session.metadata?.checkout_attempt_id) {
      const { error } = await admin.from("pro_checkout_attempts").update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", session.metadata.checkout_attempt_id).eq("user_id", session.metadata.user_id).in("status", ["creating", "open"]);
      if (error) throw error;
    }
    if (session.metadata?.payment_id && event.account) {
      const { error } = await admin.from("customer_payments").update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", session.metadata.payment_id).eq("stripe_account_id", event.account).eq("status", "pending");
      if (error) throw error;
    }
  }

  if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.payment_id && event.account) {
      const { error } = await admin.from("customer_payments").update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", session.metadata.payment_id).eq("stripe_account_id", event.account).eq("status", "pending");
      if (error) throw error;
    }
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object as Stripe.PaymentIntent;
    if (intent.metadata.payment_id && event.account) {
      await syncCustomerPayment(intent.metadata.payment_id, event.account, intent.id);
    }
  }

  if (event.type === "payment_intent.payment_failed") {
    const intent = event.data.object as Stripe.PaymentIntent;
    if (intent.metadata.payment_id && event.account) {
      const { error } = await admin.from("customer_payments").update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", intent.metadata.payment_id).eq("stripe_account_id", event.account).eq("status", "pending");
      if (error) throw error;
    }
  }

  if (event.type === "charge.refunded") {
    if (event.account) await syncRefund(event.data.object as Stripe.Charge, event.account);
  }

  if (event.type === "charge.dispute.created" || event.type === "charge.dispute.updated" || event.type === "charge.dispute.closed") {
    if (event.account) await notifyConnectedPaymentDispute((event.data.object as Stripe.Dispute).id, event.account);
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const synced = await syncSubscription(subscription.id);
    if (!synced) {
      const { error } = await admin.rpc("workcraft_complete_stripe_webhook", { p_event_id: event.id });
      if (error) throw error;
      return NextResponse.json({ received: true, ignored: "subscription is unlinked or superseded" });
    }
    // Stripe Billing owns recovery emails. The app displays the access grace
    // period and billing action without duplicating each provider reminder.
  }

  if (!event.account && (event.type === "invoice.paid" || event.type === "invoice.payment_failed"
    || event.type === "invoice.payment_action_required" || event.type === "invoice.updated")) {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = getInvoiceSubscriptionId(invoice);
    if (subscriptionId) {
      const synced = await syncSubscription(subscriptionId);
      if (!synced) {
        const { error } = await admin.rpc("workcraft_complete_stripe_webhook", { p_event_id: event.id });
        if (error) throw error;
        return NextResponse.json({ received: true, ignored: "subscription is unlinked or superseded" });
      }
      const currentInvoice = await stripe.invoices.retrieve(invoice.id);
      if (getInvoiceSubscriptionId(currentInvoice) !== subscriptionId || !currentInvoice.status) {
        throw new Error("Subscription invoice changed during refresh.");
      }
      const { error: invoiceError } = await admin.rpc("workcraft_record_subscription_invoice", {
        p_invoice_id: currentInvoice.id,
        p_user_id: synced.userId,
        p_subscription_id: subscriptionId,
        p_status: currentInvoice.status,
        p_amount_due: currentInvoice.amount_due,
        p_currency: currentInvoice.currency,
        p_attempt_count: currentInvoice.attempt_count,
        p_next_retry_at: currentInvoice.next_payment_attempt
          ? new Date(currentInvoice.next_payment_attempt * 1000).toISOString() : null,
        p_failed_at: event.type === "invoice.payment_failed" ? new Date(event.created * 1000).toISOString() : null,
        p_paid_at: currentInvoice.status === "paid"
          ? new Date((currentInvoice.status_transitions?.paid_at ?? event.created) * 1000).toISOString() : null,
      });
      if (invoiceError) throw invoiceError;
    }
  }

  const { error: completeError } = await admin.rpc("workcraft_complete_stripe_webhook", { p_event_id: event.id });
  if (completeError) throw completeError;
  return NextResponse.json({ received: true });
  } catch (processingError) {
    const message = processingError instanceof Error ? processingError.message
      : processingError && typeof processingError === "object" && "code" in processingError && typeof processingError.code === "string"
        ? `Database error ${processingError.code}` : "unknown error";
    // Reserve a separate short cleanup budget after the processing deadline.
    // If this fails, the claim lease expires and the durable worker can retry.
    const { error: retryError } = await getServiceSupabase(1_500).rpc("workcraft_fail_stripe_webhook", { p_event_id: event.id, p_error: message });
    if (retryError) {
      console.error("Stripe webhook retry could not be scheduled:", event.type, retryError.message);
      return NextResponse.json({ error: "Webhook retry could not be scheduled." }, { status: 500 });
    }
    if (processingError instanceof SubscriptionRefreshBusyError) {
      console.info("Stripe subscription event deferred for a concurrent refresh:", event.type);
      return NextResponse.json({ received: true, deferred: true }, { status: 202 });
    }
    console.error("Stripe webhook business processing failed:", event.type, message);
    return NextResponse.json({ error: "Webhook processing failed. The durable worker will retry this event." }, { status: 500 });
  }
}
