"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { LocalizedTree } from "@/app/components/LanguageProvider";
import { getClientProEntitlement } from "@/lib/client-pro-access";

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

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

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
          const response = await fetch("/api/stripe/connect/status", { cache: "no-store" });
          const connect = await response.json();
          if (response.ok) {
            setStripeConnected(connect.connected === true);
            setStripeChargesEnabled(connect.chargesEnabled === true);
            setStripeRequirementsDue(connect.requirementsDue === true);
          }
        } catch { /* Stripe status is rechecked before each payment session. */ }
      }
      setLoading(false);
      setConnectLoading(false);
    }

    loadProfile();
  }, [supabase]);

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
        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your plan</p><h2 className="mt-1 text-lg font-bold capitalize text-slate-900">{hasProAccess ? "WorkCraft AI Pro" : "WorkCraft AI Free"}</h2><p className="mt-1 text-xs text-slate-600">{proAccessSource === "admin_grant" ? <>{"Admin-granted Pro access"}{proAccessExpiresAt ? <> {"through"} {new Date(proAccessExpiresAt).toLocaleString()}.</> : <> {"until an administrator revokes it."}</>}</> : hasProAccess ? "Pro tools are enabled on this account." : "Create up to 10 estimates per day, manage your price book, share proposals, and view estimate reports. Upgrade to Pro for cloud AI, job scheduling, and other advanced tools."}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {hasProAccess && <span className="rounded-full bg-green-100 px-3 py-1.5 text-xs font-bold text-green-800">{proAccessSource === "admin_grant" ? "Admin granted" : planStatus}</span>}
          {hasBillingHistory && <button type="button" disabled={managingBilling} onClick={() => void handleManageBilling()} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">{managingBilling ? "Opening billing…" : "Manage billing"}</button>}
          {!hasProAccess && !needsBillingAttention && <button type="button" disabled={upgrading} onClick={() => void handleUpgrade()} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{upgrading ? "Opening checkout…" : "Upgrade to Pro"}</button>}
        </div>
        {!hasProAccess && <p className="w-full text-xs text-slate-600">WorkCraft AI Pro is $9.99 per month. Free features remain available with no trial required.</p>}
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer payments</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">Stripe payment setup</h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-slate-600">Customers pay your business directly through Stripe. Stripe collects verification and bank details, and you manage payments, refunds, disputes, and payouts with Stripe.</p>
            {!hasProAccess && <p className="mt-2 text-xs font-semibold text-slate-700">Customer payment collection is a Pro feature.</p>}
            {hasProAccess && !connectLoading && stripeConnected && stripeChargesEnabled && <p className="mt-2 text-xs font-semibold text-green-700">Stripe is connected and can accept payments.{stripeRequirementsDue ? " Stripe may request updated business information later." : ""}</p>}
            {hasProAccess && !connectLoading && stripeConnected && !stripeChargesEnabled && <p className="mt-2 text-xs font-semibold text-amber-700">Finish Stripe verification before accepting customer payments.</p>}
            {hasProAccess && !connectLoading && !stripeConnected && <p className="mt-2 text-xs text-slate-600">Connect Stripe to collect down payments and invoice balances. You’ll complete a guided setup hosted by Stripe.</p>}
            {hasProAccess && connectLoading && <p className="mt-2 text-xs text-slate-500">Checking Stripe connection…</p>}
          </div>
          {hasProAccess && <button type="button" disabled={connectingStripe || connectLoading || (stripeConnected && stripeChargesEnabled && !stripeRequirementsDue)} onClick={() => void handleConnectStripe()} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">{connectingStripe ? "Opening Stripe…" : stripeConnected ? stripeChargesEnabled ? "Update Stripe details" : "Continue Stripe setup" : "Connect Stripe"}</button>}
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
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Email Address (Read-only)
          </label>
          <input
            type="email"
            disabled
            value={email}
            className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2.5 text-sm text-slate-500 cursor-not-allowed"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. John Doe"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm"
              suppressHydrationWarning
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Business / Company Name
            </label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Apex Contracting LLC"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm"
              suppressHydrationWarning
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Business address</label>
            <input type="text" value={businessAddress} onChange={(e) => setBusinessAddress(e.target.value)} placeholder="Street, city, state, ZIP" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Public logo URL (optional)</label>
            <input type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://your-site.com/logo.png" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Proposal accent color</label>
            <div className="flex gap-2"><input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-10 w-14 rounded border border-slate-200" /><input type="text" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} pattern="^#[0-9A-Fa-f]{6}$" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm" /></div>
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
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Phone Number
            </label>
            <input
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
            className="bg-blue-600 hover:bg-blue-500 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
          >
            {saving ? "Saving Changes..." : "Save Preferences"}
          </button>
        </div>
      </form>
    </div>
    </LocalizedTree>
  );
}
