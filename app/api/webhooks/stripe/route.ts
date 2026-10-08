import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getEstimatePaymentData, paidCents } from "@/lib/customer-payments";
import { readLimitedText } from "@/lib/read-limited-body.mjs";
import { getStripeWebhookClaimAction } from "@/lib/stripe-webhook-claim.mjs";
import { buildPastDueBillingEmail, pastDueNoticeIdempotencyKey, shouldSendPastDueNotice } from "@/lib/subscription-billing-notice.mjs";

const MAX_STRIPE_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

function getPeriodEnd(subscription: Stripe.Subscription) {
  const periodEnds = subscription.items.data.map((item) => item.current_period_end);
  const latestPeriodEnd = Math.max(0, ...periodEnds);
  return latestPeriodEnd ? new Date(latestPeriodEnd * 1000).toISOString() : null;
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  if (invoice.parent?.type !== "subscription_details" || !invoice.parent.subscription_details) return null;
  const subscription = invoice.parent.subscription_details.subscription;
  return typeof subscription === "string" ? subscription : subscription.id;
}

export async function POST(request: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecrets = [...new Set([process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((secret): secret is string => Boolean(secret)))];
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeKey || webhookSecrets.length === 0 || !serviceRoleKey) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }

  const stripe = new Stripe(stripeKey);
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });

  const body = await readLimitedText(request, MAX_STRIPE_WEBHOOK_BODY_BYTES);
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

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, { auth: { persistSession: false } });
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
    const { data: payment, error: lookupError } = await admin.from("customer_payments")
      .select("id, user_id, estimate_id, stripe_account_id, stripe_checkout_session_id")
      .eq("id", paymentId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!payment) return;
    if (payment.stripe_account_id !== connectedAccountId) throw new Error("Connected account does not match the payment record.");
    const { error: updateError } = await admin.from("customer_payments").update({
      status: "succeeded",
      stripe_payment_intent_id: paymentIntentId || undefined,
      updated_at: new Date().toISOString(),
    }).eq("id", paymentId).eq("stripe_account_id", connectedAccountId).not("status", "in", "(refunded,partially_refunded)");
    if (updateError) throw updateError;

    const current = await getEstimatePaymentData(admin, payment.estimate_id);
    if (!current.estimate) throw new Error("Estimate for the payment no longer exists.");
    const fullyPaid = paidCents(current.payments) >= current.totalCents;
    const { error: estimateUpdateError } = await admin.from("estimates").update({ status: fullyPaid ? "paid" : "accepted" })
      .eq("id", payment.estimate_id).eq("user_id", payment.user_id);
    if (estimateUpdateError) throw estimateUpdateError;
  }

  async function syncRefund(charge: Stripe.Charge, connectedAccountId: string) {
    const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (!paymentIntentId) return;
    const { data: payment, error: lookupError } = await admin.from("customer_payments")
      .select("id, user_id, estimate_id, amount_cents")
      .eq("stripe_payment_intent_id", paymentIntentId).eq("stripe_account_id", connectedAccountId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!payment) return;
    const refunded = Math.min(Number(payment.amount_cents), Number(charge.amount_refunded));
    const nextStatus = refunded >= Number(payment.amount_cents) ? "refunded" : refunded > 0 ? "partially_refunded" : "succeeded";
    const { error: updateError } = await admin.from("customer_payments").update({
      status: nextStatus,
      amount_refunded_cents: refunded,
      updated_at: new Date().toISOString(),
    }).eq("id", payment.id).eq("stripe_account_id", connectedAccountId);
    if (updateError) throw updateError;
    const current = await getEstimatePaymentData(admin, payment.estimate_id);
    if (!current.estimate) return;
    const fullyPaid = paidCents(current.payments) >= current.totalCents;
    const { error: estimateUpdateError } = await admin.from("estimates").update({ status: fullyPaid ? "paid" : "accepted" })
      .eq("id", payment.estimate_id).eq("user_id", payment.user_id);
    if (estimateUpdateError) throw estimateUpdateError;
  }

  async function syncSubscription(subscriptionId: string) {
    // Read the current Stripe object so retries and out-of-order event delivery
    // cannot roll local subscription status back to an older event snapshot.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const userId = subscription.metadata.user_id;
    if (!userId) return null;
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const { error } = await admin.from("subscriptions").upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      current_period_end: getPeriodEnd(subscription),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw error;
    return { userId, subscription };
  }

  async function sendPastDueBillingNotice(userId: string, eventId: string) {
    const apiKey = process.env.RESEND_API_KEY;
    const sender = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !sender) throw new Error("Past-due billing email is not configured.");

    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) throw new Error("Could not load the account email for a past-due notice.");
    const recipient = data.user?.email;
    if (!recipient) throw new Error("The account has no email address for a past-due notice.");

    const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@workcraftai.com";
    const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
    const billingUrl = new URL("/profile", appOrigin).toString();
    const language = data.user?.user_metadata?.app_language === "es" ? "es" : "en";
    const email = buildPastDueBillingEmail({ language, billingUrl, supportEmail });
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": pastDueNoticeIdempotencyKey(eventId),
      },
      body: JSON.stringify({
        from: sender,
        reply_to: supportEmail,
        to: [recipient],
        ...email,
      }),
    });
    if (!response.ok) {
      console.error("Past-due billing email provider rejected request:", response.status);
      throw new Error("Past-due billing email provider request failed.");
    }
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
      if (session.metadata?.checkout_attempt_id) {
        const { error: attemptError } = await admin.from("pro_checkout_attempts").update({
          status: "completed",
          stripe_checkout_session_id: session.id,
          checkout_url: null,
          updated_at: new Date().toISOString(),
        }).eq("user_id", userId).eq("id", session.metadata.checkout_attempt_id);
        if (attemptError) throw attemptError;
      }
      const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
      const { error } = await admin.from("subscriptions").upsert({
        user_id: userId,
        stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
        stripe_subscription_id: subscription.id,
        status: subscription.status,
        current_period_end: getPeriodEnd(subscription),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
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

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const previousStatus = (event.data.previous_attributes as { status?: string } | null)?.status;
    const synced = await syncSubscription(subscription.id);
    if (!synced) {
      await admin.rpc("workcraft_complete_stripe_webhook", { p_event_id: event.id });
      return NextResponse.json({ received: true, ignored: "subscription has no WorkCraft AI user metadata" });
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
        await admin.rpc("workcraft_complete_stripe_webhook", { p_event_id: event.id });
        return NextResponse.json({ received: true, ignored: "subscription has no WorkCraft AI user metadata" });
      }
    }
  }

  const { error: completeError } = await admin.rpc("workcraft_complete_stripe_webhook", { p_event_id: event.id });
  if (completeError) throw completeError;
  return NextResponse.json({ received: true });
  } catch (processingError) {
    const message = processingError instanceof Error ? processingError.message : "unknown error";
    await admin.rpc("workcraft_fail_stripe_webhook", { p_event_id: event.id, p_error: message });
    console.error("Stripe webhook business processing failed:", event.type, message);
    return NextResponse.json({ error: "Webhook processing failed. Stripe may retry this event." }, { status: 500 });
  }
}
