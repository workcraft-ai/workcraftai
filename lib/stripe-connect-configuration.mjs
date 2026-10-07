/**
 * @param {{ userId: string, email?: string, businessName?: string, country: string }} input
 * @returns {import("stripe").V2.Core.AccountCreateParams}
 */
export function createWorkCraftConnectedAccountParams(input) {
  return {
    contact_email: input.email,
    display_name: input.businessName?.slice(0, 100),
    dashboard: "full",
    identity: { country: input.country },
    defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
    include: ["configuration.merchant", "requirements"],
    metadata: { workcraft_user_id: input.userId },
  };
}

/**
 * @param {import("stripe").V2.Core.Account["dashboard"]} dashboard
 * @param {boolean} chargesEnabled
 * @returns {"onboarding" | "full_dashboard" | "express_dashboard" | "unsupported"}
 */
export function getConnectedAccountDestination(dashboard, chargesEnabled) {
  if (!chargesEnabled) return "onboarding";
  if (dashboard === "full") return "full_dashboard";
  if (dashboard === "express") return "express_dashboard";
  return "unsupported";
}
