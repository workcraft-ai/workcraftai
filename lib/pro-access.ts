import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ProAccess = {
  hasPro: boolean;
  source: "stripe" | "admin_grant" | "free";
  stripeStatus: string;
  grantType: "temporary" | "permanent" | null;
  expiresAt: string | null;
};

export function createProAccessAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Pro access is not configured.");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function getProAccess(admin: SupabaseClient, userId: string): Promise<ProAccess> {
  const now = new Date().toISOString();
  const [{ data: subscription, error: subscriptionError }, { data: grant, error: grantError }] = await Promise.all([
    admin.from("subscriptions").select("status").eq("user_id", userId).maybeSingle(),
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
  if (stripeStatus === "active" || stripeStatus === "trialing") {
    return { hasPro: true, source: "stripe", stripeStatus, grantType: null, expiresAt: null };
  }
  if (grant) {
    return {
      hasPro: true,
      source: "admin_grant",
      stripeStatus,
      grantType: grant.grant_type,
      expiresAt: grant.expires_at,
    };
  }
  return { hasPro: false, source: "free", stripeStatus, grantType: null, expiresAt: null };
}

export async function getServerProAccess(userId: string) {
  return getProAccess(createProAccessAdminClient(), userId);
}
