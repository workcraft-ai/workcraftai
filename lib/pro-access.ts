import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createBoundedFetch } from "@/lib/bounded-fetch";

export type ProAccess = {
  hasPro: boolean;
  source: "stripe" | "admin_grant" | "free";
  stripeStatus: string;
  grantType: "temporary" | "permanent" | null;
  expiresAt: string | null;
  trialAvailable: boolean;
  trialEndsAt: string | null;
};

export function createProAccessAdminClient(deadlineAt?:number) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Pro access is not configured.");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false },global:{fetch:createBoundedFetch(5_000,deadlineAt)} });
}

export async function getProAccess(admin: SupabaseClient, userId: string): Promise<ProAccess> {
  const now = new Date().toISOString();
  const [{ data: subscription, error: subscriptionError }, { data: grant, error: grantError }] = await Promise.all([
    admin.from("subscriptions").select("status,stripe_customer_id,stripe_subscription_id,current_period_end").eq("user_id", userId).maybeSingle(),
    admin.from("tradeflow_pro_access_grants")
      .select("grant_type, expires_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (subscriptionError || grantError) {
    throw new Error(subscriptionError?.message ?? grantError?.message ?? "Could not read Pro access.");
  }

  const stripeStatus = subscription?.status ?? "free";
  const trialAvailable = !subscription?.stripe_customer_id && !subscription?.stripe_subscription_id;
  if (stripeStatus === "active" || stripeStatus === "trialing") {
    return {
      hasPro: true,
      source: "stripe",
      stripeStatus,
      grantType: null,
      expiresAt: null,
      trialAvailable: false,
      trialEndsAt: stripeStatus === "trialing" ? subscription?.current_period_end ?? null : null,
    };
  }
  if (grant) {
    return {
      hasPro: true,
      source: "admin_grant",
      stripeStatus,
      grantType: grant.grant_type,
      expiresAt: grant.expires_at,
      trialAvailable,
      trialEndsAt: null,
    };
  }
  return { hasPro: false, source: "free", stripeStatus, grantType: null, expiresAt: null, trialAvailable, trialEndsAt: null };
}

export async function getServerProAccess(userId: string, deadlineAt?:number) {
  return getProAccess(createProAccessAdminClient(deadlineAt), userId);
}
