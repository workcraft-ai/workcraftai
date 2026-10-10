"use client";

import { useCallback, useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { LocalizedTree } from "@/app/components/LanguageProvider";
import { getClientProEntitlement } from "@/lib/client-pro-access";

type UsageSnapshot = {
  plan: "free" | "pro";
  estimates: { daily_used: number; daily_limit: number; monthly_used: number; monthly_limit: number };
  ai: { included: boolean; enabled: boolean; daily_used: number; daily_limit: number; monthly_used: number; monthly_limit: number };
  email: { included: boolean; daily_used: number; daily_limit: number; monthly_used: number; monthly_limit: number };
  media: { included: boolean; monthly_used_bytes: number; monthly_limit_bytes: number; retained_bytes: number; retained_limit_bytes: number; file_count: number; file_limit: number };
};

function remaining(used: number, limit: number) {
  return Math.max(limit - used, 0);
}

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [brandColor, setBrandColor] = useState("#c85b2d");
  const [taxRate, setTaxRate] = useState("0");
  const [markupPercentage, setMarkupPercentage] = useState("0");
  const [planStatus, setPlanStatus] = useState("free");
  const [hasProAccess, setHasProAccess] = useState(false);
  const [proAccessSource, setProAccessSource] = useState<"stripe" | "admin_grant" | "free">("free");
  const [proAccessExpiresAt, setProAccessExpiresAt] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [managingBilling, setManagingBilling] = useState(false);
  const [connectLoading, setConnectLoading] = useState(true);
  const [connectingStripe, setConnectingStripe] = useState(false);
  const [stripeConnected, setStripeConnected] = useState(false);
  const [stripeChargesEnabled, setStripeChargesEnabled] = useState(false);
  const [stripeRequirementsDue, setStripeRequirementsDue] = useState(true);
  const [stripeSetupState, setStripeSetupState] = useState<"ready" | "needs_action" | "under_review" | "incomplete">("incomplete");
  const [stripeStatusError, setStripeStatusError] = useState(false);
  const [stripeStatusRefreshing, setStripeStatusRefreshing] = useState(false);
  const [stripeDashboard, setStripeDashboard] = useState<"full" | "express" | "none" | null>(null);
  const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const refreshStripeStatus = useCallback(async () => {
    const response = await fetch("/api/stripe/connect/status", { cache: "no-store" });
    const connect = await response.json();
    if (!response.ok) throw new Error(connect.error || "Could not load Stripe account status.");
    setStripeConnected(connect.connected === true);
    setStripeChargesEnabled(connect.chargesEnabled === true);
    setStripeRequirementsDue(connect.requirementsDue === true);
    setStripeSetupState(connect.setupState === "ready" || connect.setupState === "needs_action" || connect.setupState === "under_review" ? connect.setupState : "incomplete");
    setStripeDashboard(connect.dashboard === "full" || connect.dashboard === "express" || connect.dashboard === "none" ? connect.dashboard : null);
    setStripeStatusError(false);
  }, []);

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setEmail(user.email ?? "");
        setFullName(user.user_metadata?.full_name ?? "");
        setBusinessName(user.user_metadata?.business_name ?? "");
        setPhone(user.user_metadata?.phone ?? "");
        setBusinessAddress(user.user_metadata?.business_address ?? "");
        setLogoUrl(user.user_metadata?.logo_url ?? "");
        setBrandColor(user.user_metadata?.brand_color ?? "#c85b2d");
        setTaxRate(String(user.user_metadata?.tax_rate ?? 0));
        setMarkupPercentage(String(user.user_metadata?.markup_percentage ?? 0));
        void fetch("/api/account/usage", { cache: "no-store" })
          .then(async (response) => {
            if (!response.ok) throw new Error("usage unavailable");
            setUsageSnapshot(await response.json() as UsageSnapshot);
          })
          .catch(() => setUsageSnapshot(null))
          .finally(() => setUsageLoading(false));
        const entitlement = await getClientProEntitlement();
        if (entitlement) {
          setPlanStatus(entitlement.stripe_status);
          setHasProAccess(entitlement.has_pro);
          setProAccessSource(entitlement.source);
          setProAccessExpiresAt(entitlement.expires_at);
        } else {
          setError("Could not verify your plan. Refresh the page before using Pro tools.");
        }
        try {
          await refreshStripeStatus();
        } catch {
          setStripeStatusError(true);
        }
      }
      if (!user) setUsageLoading(false);
      setLoading(false);
      setConnectLoading(false);
    }

    loadProfile();
  }, [refreshStripeStatus, supabase]);

  useEffect(() => {
    if (stripeSetupState !== "under_review") return;

    let active = true;
    let remainingChecks = 12;
    let timer: ReturnType<typeof setTimeout>;

    const checkAgain = () => {
      timer = setTimeout(async () => {
        if (!active) return;
        remainingChecks -= 1;
        try {
          await refreshStripeStatus();
        } catch {
          if (active) setStripeStatusError(true);
        }
        if (active && remainingChecks > 0) checkAgain();
      }, 10_000);
    };

    checkAgain();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [refreshStripeStatus, stripeSetupState]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const { error } = await supabase.auth.updateUser({
      data: {
        full_name: fullName,
        business_name: businessName,
        phone: phone,
        business_address: businessAddress.trim(),
        logo_url: logoUrl.trim(),
        brand_color: /^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : "#c85b2d",
        tax_rate: Math.min(100, Math.max(0, Number(taxRate) || 0)),
        markup_percentage: Math.min(500, Math.max(0, Number(markupPercentage) || 0)),
      },
    });

    if (error) {
      setError(error.message);
    } else {
      setMessage("Profile and preferences updated successfully!");
    }
    setSaving(false);
  };

  const handleUpgrade = async () => {
    setUpgrading(true); setError(null);
    try {
      const response = await fetch("/api/pro/checkout", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Unable to start checkout.");
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start checkout.");
      setUpgrading(false);
    }
  };

  const handleManageBilling = async () => {
    setManagingBilling(true); setError(null);
    try {
      const response = await fetch("/api/pro/portal", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Unable to open billing settings.");
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open billing settings.");
      setManagingBilling(false);
    }
  };

  const handleConnectStripe = async () => {
    setConnectingStripe(true); setError(null);
    try {
      const response = await fetch("/api/stripe/connect/onboard", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Unable to start Stripe setup.");
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start Stripe setup.");
      setConnectingStripe(false);
    }
  };

  const handleRefreshStripeStatus = async () => {
    setStripeStatusRefreshing(true);
    try {
      await refreshStripeStatus();
    } catch {
      setStripeStatusError(true);
    } finally {
      setStripeStatusRefreshing(false);
    }
  };

  const hasBillingHistory = planStatus !== "free";
  const needsBillingAttention = ["past_due", "unpaid", "incomplete"].includes(planStatus);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="h-8 w-48 bg-slate-200 animate-pulse rounded mb-4" />
        <div className="h-64 bg-slate-100 animate-pulse rounded-xl" />
      </div>
    );
  }

  return (
    <LocalizedTree>
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Profile & Preferences</h1>
        <p className="text-xs text-slate-500 mt-1">
          Manage your account details and default estimate preferences.
        </p>
      </div>

      <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your plan</p><h2 className="mt-1 text-lg font-bold capitalize text-slate-900">{hasProAccess ? "WorkCraft AI Pro" : "WorkCraft AI Free"}</h2><p className="mt-1 text-xs text-slate-600">{proAccessSource === "admin_grant" ? <>{"Admin-granted Pro access"}{proAccessExpiresAt ? <> {"through"} {new Date(proAccessExpiresAt).toLocaleString()}.</> : <> {"until an administrator revokes it."}</>}</> : hasProAccess ? "Your Pro plan includes up to 50 estimates per day and 500 per month, 5 cloud AI drafts per day and 50 per month, 5 customer-facing emails per day and 100 per month, and up to 100 MB of media uploads per month. Check the usage panel below for what remains." : "Create up to 10 estimates per day and 50 per month, manage your price book, share proposals, and view estimate reports. Upgrade to Pro for cloud AI, job scheduling, and other advanced tools."}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {hasProAccess && <span className="rounded-full bg-green-100 px-3 py-1.5 text-xs font-bold text-green-800">{proAccessSource === "admin_grant" ? "Admin granted" : planStatus}</span>}
          {hasBillingHistory && <button type="button" disabled={managingBilling} onClick={() => void handleManageBilling()} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">{managingBilling ? "Opening billing…" : "Manage billing"}</button>}
          {!hasProAccess && !needsBillingAttention && <button type="button" disabled={upgrading} onClick={() => void handleUpgrade()} className="min-h-11 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{upgrading ? "Opening checkout…" : "Upgrade to Pro"}</button>}
        </div>
        {!hasProAccess && <p className="w-full text-xs text-slate-600">WorkCraft AI Pro is $9.99 per month. Free features remain available with no trial required.</p>}
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="account-usage-heading">
        <h2 id="account-usage-heading" className="text-lg font-bold text-slate-900">Your usage and allowances</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600">Usage is counted per account and resets at UTC midnight or the first day of the month, as shown.</p>
        {usageLoading && <p role="status" className="mt-3 text-sm text-slate-500">Loading your usage…</p>}
        {!usageLoading && !usageSnapshot && <p role="status" className="mt-3 text-sm text-amber-800">Usage totals are temporarily unavailable. Refresh this page shortly.</p>}
        {usageSnapshot && <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-4">
            <h3 className="text-sm font-bold text-slate-900">Estimates</h3>
            <p role="status" className={`mt-1 text-xs leading-5 ${remaining(usageSnapshot.estimates.daily_used, usageSnapshot.estimates.daily_limit) === 0 || remaining(usageSnapshot.estimates.monthly_used, usageSnapshot.estimates.monthly_limit) === 0 ? "font-semibold text-red-800" : remaining(usageSnapshot.estimates.daily_used, usageSnapshot.estimates.daily_limit) <= 2 || remaining(usageSnapshot.estimates.monthly_used, usageSnapshot.estimates.monthly_limit) <= 10 ? "font-semibold text-amber-800" : "text-slate-700"}`}>{remaining(usageSnapshot.estimates.daily_used, usageSnapshot.estimates.daily_limit)} of {usageSnapshot.estimates.daily_limit} left today · {remaining(usageSnapshot.estimates.monthly_used, usageSnapshot.estimates.monthly_limit)} of {usageSnapshot.estimates.monthly_limit} left this month</p>
          </div>
          {hasProAccess && <>
            <div className="rounded-lg bg-slate-50 p-4">
              <h3 className="text-sm font-bold text-slate-900">Cloud AI drafts</h3>
              <p role="status" className={`mt-1 text-xs leading-5 ${remaining(usageSnapshot.ai.daily_used, usageSnapshot.ai.daily_limit) === 0 || remaining(usageSnapshot.ai.monthly_used, usageSnapshot.ai.monthly_limit) === 0 ? "font-semibold text-red-800" : remaining(usageSnapshot.ai.daily_used, usageSnapshot.ai.daily_limit) <= 1 || remaining(usageSnapshot.ai.monthly_used, usageSnapshot.ai.monthly_limit) <= 10 ? "font-semibold text-amber-800" : "text-slate-700"}`}>{usageSnapshot.ai.enabled ? `${remaining(usageSnapshot.ai.daily_used, usageSnapshot.ai.daily_limit)} of ${usageSnapshot.ai.daily_limit} left today · ${remaining(usageSnapshot.ai.monthly_used, usageSnapshot.ai.monthly_limit)} of ${usageSnapshot.ai.monthly_limit} left this month` : "Cloud estimate drafting is temporarily paused."}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <h3 className="text-sm font-bold text-slate-900">Customer emails</h3>
              <p role="status" className={`mt-1 text-xs leading-5 ${remaining(usageSnapshot.email.daily_used, usageSnapshot.email.daily_limit) === 0 || remaining(usageSnapshot.email.monthly_used, usageSnapshot.email.monthly_limit) === 0 ? "font-semibold text-red-800" : remaining(usageSnapshot.email.daily_used, usageSnapshot.email.daily_limit) <= 1 || remaining(usageSnapshot.email.monthly_used, usageSnapshot.email.monthly_limit) <= 20 ? "font-semibold text-amber-800" : "text-slate-700"}`}>{remaining(usageSnapshot.email.daily_used, usageSnapshot.email.daily_limit)} of {usageSnapshot.email.daily_limit} left today · {remaining(usageSnapshot.email.monthly_used, usageSnapshot.email.monthly_limit)} of {usageSnapshot.email.monthly_limit} left this month</p>
              <p className="mt-1 text-[11px] text-slate-500">Estimate emails, follow-ups, customer-question alerts, and invoice emails share this allowance.</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <h3 className="text-sm font-bold text-slate-900">Private media storage</h3>
              <p role="status" className={`mt-1 text-xs leading-5 ${usageSnapshot.media.monthly_limit_bytes - usageSnapshot.media.monthly_used_bytes <= 0 ? "font-semibold text-red-800" : usageSnapshot.media.monthly_limit_bytes - usageSnapshot.media.monthly_used_bytes <= 10 * 1048576 ? "font-semibold text-amber-800" : "text-slate-700"}`}>{Math.max(usageSnapshot.media.monthly_limit_bytes - usageSnapshot.media.monthly_used_bytes, 0) / 1048576} MB left to upload this month · {(usageSnapshot.media.retained_bytes / 1048576).toFixed(1)} of {(usageSnapshot.media.retained_limit_bytes / 1048576).toFixed(0)} MB stored · {usageSnapshot.media.file_count} of {usageSnapshot.media.file_limit} files</p>
            </div>
          </>}
        </div>}
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer payments</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">Stripe payment setup</h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-slate-600">{stripeDashboard === "express" ? "This existing Stripe connection uses the Express Dashboard. New connections use the Full Stripe Dashboard. Use the Open Stripe Express button to review payments and payout settings." : "Stripe-hosted onboarding collects verification and payout information directly. New connected accounts use the Full Stripe Dashboard; after Stripe activates your account, use your own Stripe login to manage payments, payouts, reports, and account details. Stripe processing fees are separate from your WorkCraft AI Pro subscription."}</p>
            {!hasProAccess && <p className="mt-2 text-xs font-semibold text-slate-700">Customer payment collection is a Pro feature.</p>}
            {hasProAccess && !connectLoading && stripeConnected && stripeChargesEnabled && <p className="mt-2 text-xs font-semibold text-green-700">Stripe is connected and can accept payments.{stripeRequirementsDue ? " Stripe may request updated business information later." : ""}</p>}
            {hasProAccess && !connectLoading && stripeConnected && !stripeChargesEnabled && stripeSetupState === "needs_action" && <p role="status" className="mt-2 text-xs font-semibold text-amber-700">Stripe still needs information before it can activate payments. Continue setup to complete the remaining verification steps.</p>}
            {hasProAccess && !connectLoading && stripeConnected && !stripeChargesEnabled && stripeSetupState === "under_review" && <p role="status" className="mt-2 text-xs font-semibold text-amber-700">Stripe is reviewing your identity or business information. You do not need to submit it again while Stripe reviews it; we will check your status automatically for a short time.</p>}
            {hasProAccess && !connectLoading && stripeConnected && !stripeChargesEnabled && stripeSetupState === "incomplete" && <p className="mt-2 text-xs font-semibold text-amber-700">Stripe setup is not active yet. Continue setup to review any remaining steps.</p>}
            {hasProAccess && !connectLoading && stripeStatusError && <p role="status" className="mt-2 text-xs font-semibold text-red-700">We could not check your Stripe status. Retry the status check.</p>}
            {hasProAccess && !connectLoading && !stripeConnected && <p className="mt-2 text-xs text-slate-600">Connect Stripe to collect down payments and invoice balances. Stripe will guide you through account verification. Once active, sign in to Stripe with your own credentials to use the Full Dashboard.</p>}
            {hasProAccess && connectLoading && <p className="mt-2 text-xs text-slate-500">Checking Stripe connection…</p>}
          </div>
          {hasProAccess && stripeConnected && stripeChargesEnabled && stripeDashboard === "full" && <a href="https://dashboard.stripe.com/" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50">Open Stripe Dashboard</a>}
          {hasProAccess && stripeConnected && !stripeChargesEnabled && stripeSetupState === "under_review" && <button type="button" disabled={stripeStatusRefreshing || connectLoading} onClick={() => void handleRefreshStripeStatus()} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">{stripeStatusRefreshing ? "Checking status…" : "Check Stripe status"}</button>}
          {hasProAccess && !(stripeConnected && stripeChargesEnabled && stripeDashboard === "full") && !(stripeConnected && !stripeChargesEnabled && stripeSetupState === "under_review") && <button type="button" disabled={connectingStripe || connectLoading} onClick={() => void handleConnectStripe()} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">{connectingStripe ? "Opening Stripe…" : stripeConnected && stripeChargesEnabled && stripeDashboard === "express" ? "Open Stripe Express" : stripeConnected ? "Continue Stripe setup" : "Connect Stripe"}</button>}
        </div>
      </section>

      <form
        onSubmit={handleSaveProfile}
        className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4"
      >
        {message && (
          <div className="text-xs text-green-700 bg-green-50 p-3 rounded-lg border border-green-200">
            {message}
          </div>
        )}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="profile-email" className="block text-xs font-medium text-slate-700 mb-1">
            Email Address (Read-only)
          </label>
          <input
            id="profile-email"
            type="email"
            disabled
            value={email}
            className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2.5 text-sm text-slate-500 cursor-not-allowed"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label htmlFor="profile-full-name" className="block text-xs font-medium text-slate-700 mb-1">
              Full Name
            </label>
            <input
              id="profile-full-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. John Doe"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm"
              suppressHydrationWarning
            />
          </div>

          <div>
            <label htmlFor="profile-business-name" className="block text-xs font-medium text-slate-700 mb-1">
              Business / Company Name
            </label>
            <input
              id="profile-business-name"
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Apex Contracting LLC"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm"
              suppressHydrationWarning
            />
          </div>
          <div>
            <label htmlFor="profile-business-address" className="block text-xs font-medium text-slate-700 mb-1">Business address</label>
            <input id="profile-business-address" type="text" value={businessAddress} onChange={(e) => setBusinessAddress(e.target.value)} placeholder="Street, city, state, ZIP" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm" />
          </div>
          <div>
            <label htmlFor="profile-logo-url" className="block text-xs font-medium text-slate-700 mb-1">Public logo URL (optional)</label>
            <input id="profile-logo-url" type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://your-site.com/logo.png" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm" />
          </div>
          <div>
            <label htmlFor="profile-brand-color-picker" className="block text-xs font-medium text-slate-700 mb-1">Proposal accent color</label>
            <div className="flex gap-2"><input id="profile-brand-color-picker" type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-10 w-14 rounded border border-slate-200" /><label htmlFor="profile-brand-color-text" className="sr-only">Hex color value</label><input id="profile-brand-color-text" type="text" aria-label="Hex color value" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} pattern="^#[0-9A-Fa-f]{6}$" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm" /></div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Default estimate pricing</h2>
          <p className="mt-1 text-xs text-slate-600">Applied to new estimates as a starting point. Tax rules vary by location; confirm what is taxable with your tax professional.</p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-700">Markup (%)<input type="number" min="0" max="500" step="0.01" value={markupPercentage} onChange={(e) => setMarkupPercentage(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm" /></label>
            <label className="text-xs font-medium text-slate-700">Sales tax (%)<input type="number" min="0" max="100" step="0.001" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm" /></label>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="profile-phone" className="block text-xs font-medium text-slate-700 mb-1">
              Phone Number
            </label>
            <input
              id="profile-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 000-0000"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm"
              suppressHydrationWarning
            />
          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 bg-blue-600 hover:bg-blue-500 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
          >
            {saving ? "Saving Changes..." : "Save Preferences"}
          </button>
        </div>
      </form>
    </div>
    </LocalizedTree>
  );
}
