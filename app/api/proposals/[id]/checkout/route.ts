import { customerShareAllowed } from "@/lib/proposal-sharing";
import { NextResponse } from "next/server";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";
import { accountCanCharge, createConnectedCheckout, getEstimatePaymentData, retrieveOpenSession } from "@/lib/customer-payments";
import { getAppOrigin, getServiceSupabase } from "@/lib/stripe-server";
import { getProAccess } from "@/lib/pro-access";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedBody = await readLimitedJsonObject(request, 1_000);
  if (!parsedBody.ok) {
    return errorResponse(
      parsedBody.reason === "too_large" ? "Payment request is too large." : "Choose a valid payment option.",
      parsedBody.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsedBody.value;
  const kind = body && typeof body === "object" && "kind" in body && body.kind === "deposit" ? "deposit" :
    body && typeof body === "object" && "kind" in body && body.kind === "balance" ? "balance" : null;
  if (!kind) return errorResponse("Choose a valid payment option.", 400);

  try {
    const admin = getServiceSupabase();
    if (!(await customerShareAllowed(admin, id, request))) return errorResponse("Proposal not found or link expired.", 404);
    const data = await getEstimatePaymentData(admin, id);
    const estimate = data.estimate;
    if (!estimate) return errorResponse("Estimate not found.", 404);
    if (estimate.status !== "accepted") return errorResponse("Approve this estimate before making a payment.", 409);
    if (!data.totalCents) return errorResponse("This estimate has no payable balance.", 409);

    let hasPro = false;
    try { hasPro = (await getProAccess(admin, estimate.user_id)).hasPro; }
    catch { return errorResponse("Could not verify the contractor’s plan.", 502); }
    if (!hasPro) {
      return errorResponse("Online customer payments are currently unavailable for this estimate.", 403);
    }

    const { data: account, error: accountError } = await admin.from("stripe_connected_accounts")
      .select("stripe_account_id").eq("user_id", estimate.user_id).maybeSingle();
    if (accountError) return errorResponse("Could not load contractor payment settings.", 502);
    if (!account?.stripe_account_id || !(await accountCanCharge(account.stripe_account_id))) {
      return errorResponse("The contractor has not finished Stripe payment setup yet. Contact them to arrange payment.", 409);
    }

    const { data: preparedRows, error: prepareError } = await admin.rpc("workcraft_prepare_customer_payment", {
      p_user_id: estimate.user_id,
      p_estimate_id: estimate.id,
      p_payment_kind: kind,
      p_stripe_account_id: account.stripe_account_id,
    });
    if (prepareError) {
      const message = prepareError.message;
      if (message.includes("WORKCRAFT_PRO_REQUIRED")) return errorResponse("Online customer payments require an active WorkCraft AI Pro plan.", 403);
      if (message.includes("PAYMENT_CHECKOUT_ALREADY_OPEN")) return errorResponse("Another payment checkout is already open for this estimate. Finish or close it before starting a different payment.", 409);
      if (["DEPOSIT_NOT_AVAILABLE", "NO_REMAINING_BALANCE", "PAYMENT_AMOUNT_LIMIT_EXCEEDED"].some((code) => message.includes(code))) {
        if (message.includes("DEPOSIT_NOT_AVAILABLE")) return errorResponse("A deposit is not available for this estimate.", 409);
        if (message.includes("PAYMENT_AMOUNT_LIMIT_EXCEEDED")) return errorResponse("This estimate is above Stripe’s online checkout limit. Arrange payment directly with the contractor.", 409);
        return errorResponse("There is no remaining balance available to pay through Stripe.", 409);
      }
      if (message.includes("CHECKOUT_RATE_LIMITED")) return errorResponse("Too many checkout attempts. Please try again later.", 429);
      return errorResponse(message.includes("ESTIMATE_NOT_PAYABLE") ? "Approve this estimate before making a payment." : "Could not prepare this payment. Please try again.", prepareError.code === "42501" ? 403 : 502);
    }
    const prepared = Array.isArray(preparedRows) ? preparedRows[0] as { payment_id?: string; payment_kind?: string; amount_cents?: number; reused?: boolean } | undefined : undefined;
    if (!prepared?.payment_id) return errorResponse("Could not prepare this payment. Please try again.", 502);
    const amountCents = Number(prepared.amount_cents);
    if (prepared.payment_kind !== kind || !Number.isSafeInteger(amountCents) || amountCents < 1) {
      return errorResponse("Could not prepare this payment. Please try again.", 502);
    }

    const { data: payment, error: paymentError } = await admin.from("customer_payments")
      .select("id, payment_kind, amount_cents, status, stripe_checkout_session_id, checkout_url")
      .eq("id", prepared.payment_id).single();
    if (paymentError || !payment) return errorResponse("Could not load this payment. Please try again.", 502);
    if (payment.payment_kind !== kind || Number(payment.amount_cents) !== amountCents) {
      return errorResponse("Another payment checkout is already open for this estimate. Finish or close it before starting a different payment.", 409);
    }
    if (payment.stripe_checkout_session_id) {
      const session = await retrieveOpenSession(payment.stripe_checkout_session_id, account.stripe_account_id);
      if (session.status === "open" && payment.checkout_url) {
        return NextResponse.json({ url: payment.checkout_url }, { headers: { "Cache-Control": "no-store" } });
      }
      if (session.status === "complete") return errorResponse("Your payment is processing. Refresh this proposal in a moment.", 409);
      const { error: expireError } = await admin.from("customer_payments").update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", payment.id).eq("status", "pending");
      if (expireError) throw expireError;
      return errorResponse("This checkout link expired. Please start the payment again.", 409);
    }

    const session = await createConnectedCheckout({
      shareToken: new URL(request.url).searchParams.get("token"),
      estimate,
      amountCents,
      kind,
      paymentId: payment.id,
      stripeAccountId: account.stripe_account_id,
      origin: getAppOrigin(request),
    });
    const { error: saveError } = await admin.from("customer_payments").update({
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
      checkout_url: session.url,
      updated_at: new Date().toISOString(),
    }).eq("id", payment.id);
    if (saveError) throw saveError;
    return NextResponse.json({ url: session.url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Customer payment checkout failed:", error instanceof Error ? error.message : "unknown error");
    return errorResponse("Payment checkout is temporarily unavailable. Please try again later.", 502);
  }
}
