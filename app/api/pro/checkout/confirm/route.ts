import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { getServerProAccess } from "@/lib/pro-access";
import { getServiceSupabase, getStripeClient } from "@/lib/stripe-server";
import { SubscriptionRefreshBusyError, syncStripeSubscription } from "@/lib/stripe-subscription-sync";

export const runtime = "nodejs";
export const maxDuration = 30;

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return response({ error: "Request origin is not allowed." }, 403);

  const userClient = await createUserSupabaseClient();
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return response({ error: "Sign in to confirm Pro access." }, 401);

  const body = await request.json().catch(() => null) as { session_id?: unknown } | null;
  const sessionId = body?.session_id;
  if (typeof sessionId !== "string" || !/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return response({ error: "A valid Checkout session is required." }, 400);
  }

  const deadlineAt = Date.now() + 25_000;
  try {
    const admin = getServiceSupabase(5_000, deadlineAt);
    const { data: attempt, error: attemptError } = await admin.from("pro_checkout_attempts")
      .select("id")
      .eq("user_id", user.id)
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();
    if (attemptError) throw attemptError;
    if (!attempt) return response({ error: "Checkout could not be verified for this account." }, 404);

    const stripe = getStripeClient(deadlineAt);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const attemptId = session.metadata?.checkout_attempt_id;
    const sessionUserId = session.client_reference_id || session.metadata?.user_id;
    const subscriptionId = typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
    if (session.mode !== "subscription" || session.status !== "complete"
      || sessionUserId !== user.id || session.metadata?.user_id !== user.id
      || !attemptId || attemptId !== attempt.id || !subscriptionId) {
      return response({ error: "Checkout is not complete for this account yet." }, 409);
    }

    try {
      await syncStripeSubscription(admin, stripe, subscriptionId, {
        userId: user.id,
        attemptId,
        sessionId: session.id,
      });
    } catch (error) {
      if (!(error instanceof SubscriptionRefreshBusyError)) throw error;
      // A webhook may be syncing the same subscription at this moment. Check
      // the authoritative entitlement before asking the browser to retry.
    }

    const access = await getServerProAccess(user.id, deadlineAt);
    return response({ confirmed: access.hasPro }, access.hasPro ? 200 : 202);
  } catch (error) {
    console.error("Pro checkout confirmation failed:", error instanceof Error ? error.name : "unknown error");
    if (error instanceof SubscriptionRefreshBusyError) return response({ confirmed: false }, 202);
    return response({ error: "Pro access is still being confirmed. Please try again shortly." }, 503);
  }
}
