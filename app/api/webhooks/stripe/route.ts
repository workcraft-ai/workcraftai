import Stripe from "stripe";
import { syncStripeSubscription } from "@/lib/stripe-subscription-sync";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readLimitedText } from "@/lib/read-limited-body.mjs";
import { getStripeWebhookClaimAction } from "@/lib/stripe-webhook-claim.mjs";
import { getInvoiceSubscriptionId } from "@/lib/stripe-invoice.mjs";
import { buildPastDueBillingEmail, pastDueNoticeIdempotencyKey, shouldSendPastDueNotice } from "@/lib/subscription-billing-notice.mjs";
import { enqueueNotification, escapeEmailHtml, notificationFrame, processNotifications } from "@/lib/notification-outbox";
import { getWorkCraftNoReplySender } from "@/lib/email-senders";
import { createBoundedFetch } from "@/lib/bounded-fetch";
import { getServiceSupabase } from "@/lib/stripe-server";

const MAX_STRIPE_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const deadlineAt = Date.now() + 25_000;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecrets = [...new Set([process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((secret): secret is string => Boolean(secret)))];
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeKey || webhookSecrets.length === 0 || !serviceRoleKey) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }

  // Stripe retries non-2xx responses. Keep a single bounded provider attempt
  // and let its durable delivery retry policy handle transient failures.
  const stripe = new Stripe(stripeKey, { timeout: 8_000, maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(createBoundedFetch(8_000, deadlineAt)) });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });

  const body = await readLimitedText(request, MAX_STRIPE_WEBHOOK_BODY_BYTES, 10_000);
  if (!body.ok) return NextResponse.json({ error: body.reason === "too_large" ? "Webhook request is too large." : "Invalid webhook request." }, { status: body.reason === "too_large" ? 413 : 400 });
  const payload = body.value;
  let event: Stripe.Event | undefined;
  for (const secret of webhookSecrets) {
    try {
      event = stripe.webhooks.constructEvent(payload, signature, secret);
      break;
    } catch {
      // Connect and account-scope endpoints have distinct signing secrets.
    }
  }
  if (!event) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });

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
    return NextResponse.json({ error: "This event is already being processed or could not be claimed. Stripe may retry it." }, { status: 503 });
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

  async function sendPastDueBillingNotice(userId: string, eventId: string) {
    const sender = getWorkCraftNoReplySender();

    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) throw new Error("Could not load the account email for a past-due notice.");
    const recipient = data.user?.email;
    if (!recipient) throw new Error("The account has no email address for a past-due notice.");

    const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@workcraftai.com";
    const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
    const billingUrl = new URL("/profile", appOrigin).toString();
    const language = data.user?.user_metadata?.app_language === "es" ? "es" : "en";
    const email = buildPastDueBillingEmail({ language, billingUrl, supportEmail });
    const queued = await enqueueNotification(admin, {
      user_id: userId, source: "billing", send_key: pastDueNoticeIdempotencyKey(eventId),
      payload: {from: sender, reply_to: supportEmail, to: [recipient], ...email},
    });
    // Entitlement sync must complete even if a provider is down or the reserved
    // billing pool is full. The durable worker retries the notice separately.
    try { await processNotifications(admin, [queued.id], 1, 3_000, deadlineAt); }
    catch { console.error("Billing notification remains queued."); }

  }

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
    const previousStatus = (event.data.previous_attributes as { status?: string } | null)?.status;
    const synced = await syncSubscription(subscription.id);
    if (!synced) {
      const { error } = await admin.rpc("workcraft_complete_stripe_webhook", { p_event_id: event.id });
      if (error) throw error;
      return NextResponse.json({ received: true, ignored: "subscription is unlinked or superseded" });
    }
    if (shouldSendPastDueNotice({
      eventType: event.type,
      eventStatus: subscription.status,
      previousStatus,
      currentStatus: synced.subscription.status,
    })) {
      await sendPastDueBillingNotice(synced.userId, event.id);
    }
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required") {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = getInvoiceSubscriptionId(invoice);
    if (subscriptionId) {
      const synced = await syncSubscription(subscriptionId);
      if (!synced) {
        const { error } = await admin.rpc("workcraft_complete_stripe_webhook", { p_event_id: event.id });
        if (error) throw error;
        return NextResponse.json({ received: true, ignored: "subscription is unlinked or superseded" });
      }
    }
  }

  const { error: completeError } = await admin.rpc("workcraft_complete_stripe_webhook", { p_event_id: event.id });
  if (completeError) throw completeError;
  return NextResponse.json({ received: true });
  } catch (processingError) {
    const message = processingError instanceof Error ? processingError.message : "unknown error";
    // Reserve a separate short cleanup budget after the processing deadline.
    // If this fails, the existing claim lease still expires for provider replay.
    await getServiceSupabase(1_500).rpc("workcraft_fail_stripe_webhook", { p_event_id: event.id, p_error: message });
    console.error("Stripe webhook business processing failed:", event.type, message);
    return NextResponse.json({ error: "Webhook processing failed. Stripe may retry this event." }, { status: 500 });
  }
}
