import { NextResponse } from "next/server";
import { accountCanCharge, createConnectedCheckout, getEstimatePaymentData, paidCents, retrieveOpenSession } from "@/lib/customer-payments";
import { getAppOrigin, getServiceSupabase } from "@/lib/stripe-server";
import { getProAccess } from "@/lib/pro-access";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("Choose a valid payment option.", 400); }
  const kind = body && typeof body === "object" && "kind" in body && body.kind === "deposit" ? "deposit" :
    body && typeof body === "object" && "kind" in body && body.kind === "balance" ? "balance" : null;
  if (!kind) return errorResponse("Choose a valid payment option.", 400);

  try {
    const admin = getServiceSupabase();
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

    const alreadyPaid = paidCents(data.payments);
    if (kind === "deposit" && (!estimate.require_deposit || alreadyPaid > 0)) {
      return errorResponse("A deposit is not available for this estimate.", 409);
    }
    const dueCents = Math.max(0, data.totalCents - alreadyPaid);
    const amountCents = kind === "deposit"
      ? Math.min(dueCents, Math.round(data.totalCents * Number(estimate.deposit_percentage || 0) / 100))
      : dueCents;
    if (amountCents < 1) return errorResponse("There is no remaining balance to pay.", 409);

    const { data: preparedRows, error: prepareError } = await admin.rpc("workcraft_prepare_customer_payment", {
      p_user_id: estimate.user_id,
      p_estimate_id: estimate.id,
      p_payment_kind: kind,
      p_amount_cents: amountCents,
      p_stripe_account_id: account.stripe_account_id,
    });
    if (prepareError) {
      const message = prepareError.message.includes("WORKCRAFT_PRO_REQUIRED")
        ? "Online customer payments require an active WorkCraft AI Pro plan."
        : "Could not prepare this payment. Please try again.";
      return errorResponse(message, prepareError.code === "42501" ? 403 : 502);
    }
    const prepared = Array.isArray(preparedRows) ? preparedRows[0] as { payment_id?: string; reused?: boolean } | undefined : undefined;
    if (!prepared?.payment_id) return errorResponse("Could not prepare this payment. Please try again.", 502);

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
      await admin.from("customer_payments").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", payment.id);
      return errorResponse("This checkout link expired. Please start the payment again.", 409);
    }

    const session = await createConnectedCheckout({
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
