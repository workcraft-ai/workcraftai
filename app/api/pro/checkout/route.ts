import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAppOrigin, getServiceSupabase, getStripeClient } from "@/lib/stripe-server";
import { getServerProAccess } from "@/lib/pro-access";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return response({ error: "Sign in to upgrade." }, 401);

  try {
    if ((await getServerProAccess(user.id)).hasPro) {
      return response({ error: "Your account already has Pro access." }, 409);
    }
  } catch {
    return response({ error: "Could not verify your plan." }, 503);
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!stripeKey || !proPriceId) return response({ error: "Set STRIPE_SECRET_KEY and STRIPE_PRO_PRICE_ID to enable Pro billing." }, 503);

  let admin: ReturnType<typeof getServiceSupabase>;
  try { admin = getServiceSupabase(); }
  catch { return response({ error: "Pro billing is temporarily unavailable." }, 503); }
  const { data: currentPlan, error: planError } = await admin.from("subscriptions")
    .select("status, stripe_customer_id").eq("user_id", user.id).maybeSingle();
  if (planError) return response({ error: "Could not verify your plan." }, 503);
  if (["active", "trialing"].includes(currentPlan?.status ?? "")) return response({ error: "Your account already has Pro." }, 409);
  if (currentPlan?.stripe_customer_id && ["past_due", "unpaid", "incomplete"].includes(currentPlan.status)) {
    return response({ error: "Use Manage billing to resolve your existing subscription before starting another." }, 409);
  }

  try {
  const stripe = getStripeClient();
  const origin = getAppOrigin(request);
  const { data: reservations, error: reserveError } = await admin.rpc("workcraft_reserve_pro_checkout", { p_user_id: user.id });
  if (reserveError) {
    const status = reserveError.message.includes("WORKCRAFT_PRO_ALREADY_ACTIVE") ? 409 : 503;
    return response({ error: status === 409 ? "Your account already has Pro access." : "Could not start Pro checkout. Please try again." }, status);
  }

  let attempt = Array.isArray(reservations) ? reservations[0] as {
    attempt_id?: string;
    stripe_checkout_session_id?: string | null;
    checkout_url?: string | null;
  } | undefined : undefined;
  if (!attempt?.attempt_id) return response({ error: "Could not start Pro checkout. Please try again." }, 503);

  if (attempt.stripe_checkout_session_id) {
    const existingSession = await stripe.checkout.sessions.retrieve(attempt.stripe_checkout_session_id);
    if (existingSession.status === "open" && existingSession.url) {
      return response({ url: existingSession.url });
    }
    if (existingSession.status === "complete") {
      return response({ error: "Your payment is processing. Refresh your profile in a moment." }, 409);
    }

    const { error: expireError } = await admin.from("pro_checkout_attempts")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", attempt.attempt_id).in("status", ["creating", "open"]);
    if (expireError) return response({ error: "Could not refresh Pro checkout. Please try again." }, 503);
    const { data: retryReservations, error: retryError } = await admin.rpc("workcraft_reserve_pro_checkout", { p_user_id: user.id });
    if (retryError) return response({ error: "Could not refresh Pro checkout. Please try again." }, 503);
    attempt = Array.isArray(retryReservations) ? retryReservations[0] as typeof attempt : undefined;
    if (!attempt?.attempt_id) return response({ error: "Could not refresh Pro checkout. Please try again." }, 503);
    if (attempt.stripe_checkout_session_id) {
      // Another request already created the next checkout while this request
      // was expiring the previous one. Reuse it on the next call.
      return response({ error: "A new checkout is being prepared. Please try again in a moment." }, 409);
    }
  }

  const customer = currentPlan?.stripe_customer_id
    ? { customer: currentPlan.stripe_customer_id }
    : { customer_email: user.email };
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: proPriceId, quantity: 1 }],
    ...customer,
    client_reference_id: user.id,
    metadata: { user_id: user.id, checkout_attempt_id: attempt.attempt_id },
    subscription_data: { metadata: { user_id: user.id, checkout_attempt_id: attempt.attempt_id } },
    success_url: `${origin}/profile?upgrade=success`,
    cancel_url: `${origin}/profile?upgrade=cancelled`,
  }, {
    idempotencyKey: `workcraft-pro-checkout-${attempt.attempt_id}`,
  });
  if (!session.url) return response({ error: "Stripe did not return a checkout URL." }, 502);

  const { data: savedAttempt, error: saveError } = await admin.from("pro_checkout_attempts").update({
    status: "open",
    stripe_checkout_session_id: session.id,
    checkout_url: session.url,
    expires_at: new Date(session.expires_at * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", attempt.attempt_id).in("status", ["creating", "open"]).select("id").maybeSingle();
  if (saveError || !savedAttempt) return response({ error: "Checkout is being finalized. Refresh your profile and try again shortly." }, 503);
  return response({ url: session.url });
  } catch (error) {
    console.error("Pro checkout could not be completed:", error instanceof Error ? error.name : "unknown error");
    return response({ error: "Pro checkout is temporarily unavailable. Please try again." }, 502);
  }
}
