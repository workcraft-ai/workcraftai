export type ClientProEntitlement = {
  has_pro: boolean;
  source: "stripe" | "admin_grant" | "free";
  grant_type: "temporary" | "permanent" | null;
  expires_at: string | null;
  stripe_status: string;
  trial_available: boolean;
  trial_ends_at: string | null;
};

export async function getClientProEntitlement(): Promise<ClientProEntitlement | null> {
  try {
    const response = await fetch("/api/user/entitlements", { cache: "no-store" });
    if (!response.ok) return null;
    const result = await response.json() as Partial<ClientProEntitlement>;
    if (typeof result.has_pro !== "boolean") return null;
    return {
      has_pro: result.has_pro,
      source: result.source === "stripe" || result.source === "admin_grant" ? result.source : "free",
      grant_type: result.grant_type === "temporary" || result.grant_type === "permanent" ? result.grant_type : null,
      expires_at: typeof result.expires_at === "string" ? result.expires_at : null,
      stripe_status: typeof result.stripe_status === "string" ? result.stripe_status : "free",
      trial_available: result.trial_available === true,
      trial_ends_at: typeof result.trial_ends_at === "string" ? result.trial_ends_at : null,
    };
  } catch {
    return null;
  }
}
