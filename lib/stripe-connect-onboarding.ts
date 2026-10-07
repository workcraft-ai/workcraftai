import Stripe from "stripe";
import { getAppOrigin } from "@/lib/stripe-server";

export const MAX_AUTOMATIC_ONBOARDING_CONTINUATIONS = 3;

export function getStripeConnectOrigin(request: Request) {
  // Preview deployments must return to the same deployment so its Preview
  // Supabase and Stripe test credentials remain in use after hosted onboarding.
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return getAppOrigin(request);
}

export function getOnboardingContinuation(value: string | null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, MAX_AUTOMATIC_ONBOARDING_CONTINUATIONS);
}

export async function createStripeOnboardingLink(
  stripe: Stripe,
  accountId: string,
  origin: string,
  continuation = 0,
) {
  const nextContinuation = Math.min(
    MAX_AUTOMATIC_ONBOARDING_CONTINUATIONS,
    Math.max(0, continuation),
  );

  return stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["merchant"],
        collection_options: { fields: "eventually_due", future_requirements: "include" },
        return_url: `${origin}/api/stripe/connect/return?continuation=${nextContinuation}`,
        refresh_url: `${origin}/api/stripe/connect/refresh?continuation=${nextContinuation}`,
      },
    },
  });
}
