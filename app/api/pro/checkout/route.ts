import { createServerClient } from "@supabase/ssr";
import Stripe from "stripe";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerProAccess } from "@/lib/pro-access";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to upgrade." }, { status: 401 });

  try {
    if ((await getServerProAccess(user.id)).hasPro) {
      return NextResponse.json({ error: "Your account already has Pro access." }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ error: "Could not verify your plan." }, { status: 503 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!stripeKey || !proPriceId) return NextResponse.json({ error: "Set STRIPE_SECRET_KEY and STRIPE_PRO_PRICE_ID to enable Pro billing." }, { status: 503 });

  const { data: currentPlan } = await supabase.from("subscriptions").select("status, stripe_customer_id").eq("user_id", user.id).maybeSingle();
  if (["active", "trialing"].includes(currentPlan?.status ?? "")) return NextResponse.json({ error: "Your account already has Pro." }, { status: 409 });
  if (currentPlan?.stripe_customer_id && ["past_due", "unpaid", "incomplete"].includes(currentPlan.status)) {
    return NextResponse.json({ error: "Use Manage billing to resolve your existing subscription before starting another." }, { status: 409 });
  }

  const stripe = new Stripe(stripeKey);
  const origin = new URL(request.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: proPriceId, quantity: 1 }],
    customer_email: user.email,
    client_reference_id: user.id,
    metadata: { user_id: user.id },
    subscription_data: { metadata: { user_id: user.id } },
    success_url: `${origin}/profile?upgrade=success`,
    cancel_url: `${origin}/profile?upgrade=cancelled`,
  });
  return NextResponse.json({ url: session.url });
}
