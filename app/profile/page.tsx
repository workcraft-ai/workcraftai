"use client";

import { useCallback, useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { LocalizedTree, translate, useLanguage, type Language } from "@/app/components/LanguageProvider";
import { getClientProEntitlement } from "@/lib/client-pro-access";
import { isValidOptionalBusinessPhone } from "@/lib/business-phone";
import MfaSecurity from "@/app/components/MfaSecurity";
import EmailPreferences from "@/app/components/EmailPreferences";

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

function trialNotice(language: Language, date: string | null, billingReady: boolean | null) {
  const message = billingReady === true
    ? date
      ? "Your Pro upgrade is set. Your 14-day trial ends {date}. Your saved payment method will be charged $9.99/month starting then unless you cancel before the trial ends. No charge is due today."
      : "Your Pro upgrade is set. Your saved payment method will be charged $9.99/month when the trial ends unless you cancel before then. No charge is due today."
    : billingReady === false
      ? date
        ? "Your Pro trial ends {date}. Add billing details before then to continue at $9.99/month. Without them, your account returns to Free and your saved data remains."
        : "Your Pro trial is active. Add billing details in Manage billing to continue at $9.99/month. Without them, your account returns to Free and your saved data remains."
      : date
        ? "Your Pro trial ends {date}. Check Manage billing to confirm whether a payment method is set and when billing begins."
        : "Your Pro trial is active. Check Manage billing to confirm whether a payment method is set and when billing begins.";
  return translate(language, message).replace("{date}", date ?? "");
}

function planBadge(language: Language, status: string, billingReady: boolean | null) {
  if (status === "trialing") return translate(language, billingReady === true ? "Pro upgrade set" : "14-day Pro trial");
  if (status === "active") return translate(language, "Pro active");
  return translate(language, status);
}

function billingActionLabel(language: Language, status: string, billingReady: boolean | null) {
  if (status === "trialing" && billingReady === false) return translate(language, "Add payment method");
  if (status === "trialing" && billingReady === null) return translate(language, "Review billing");
  return translate(language, "Manage billing");
}

function localizePlanActionError(language: Language, message: string) {
  const spanishMessages: Record<string, string> = {
    "Unable to start checkout.": "No se pudo abrir el pago. Inténtalo de nuevo.",
    "Pro checkout is temporarily unavailable. Please try again.": "El pago de Pro no está disponible temporalmente. Inténtalo de nuevo.",
    "Could not start Pro checkout. Please try again.": "No se pudo iniciar el pago de Pro. Inténtalo de nuevo.",
    "Could not verify your plan.": "No se pudo verificar tu plan. Actualiza la página e inténtalo de nuevo.",
    "Your account already has Pro access.": "Tu cuenta ya tiene acceso a Pro. Actualiza la página para ver tu plan.",
    "Your account already has Pro.": "Tu cuenta ya tiene Pro. Actualiza la página para ver tu plan.",
    "Use Manage billing to resolve your existing subscription before starting another.": "Usa Administrar facturación para resolver tu suscripción actual antes de iniciar otra.",
    "Your payment is processing. Refresh your profile in a moment.": "Tu pago se está procesando. Actualiza tu perfil en un momento.",
    "Could not refresh Pro checkout. Please try again.": "No se pudo actualizar el pago de Pro. Inténtalo de nuevo.",
    "A new checkout is being prepared. Please try again in a moment.": "Se está preparando un nuevo pago. Inténtalo de nuevo en un momento.",
    "Checkout is being finalized. Refresh your profile and try again shortly.": "Se está finalizando el pago. Actualiza tu perfil e inténtalo de nuevo en breve.",
    "Unable to open billing settings.": "No se pudo abrir la configuración de facturación. Inténtalo de nuevo.",
    "Could not open billing settings. Please try again.": "No se pudo abrir la configuración de facturación. Inténtalo de nuevo.",
    "Billing settings are temporarily unavailable. Please try again.": "La configuración de facturación no está disponible temporalmente. Inténtalo de nuevo.",
    "Sign in to upgrade.": "Inicia sesión para actualizar tu plan.",
  };
  return language === "es" ? spanishMessages[message] ?? "No se pudo completar la acción de facturación. Inténtalo de nuevo o comunícate con soporte." : message;
}

export default function ProfilePage() {
  const { language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planActionError, setPlanActionError] = useState<string | null>(null);

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
  const [trialAvailable, setTrialAvailable] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [entitlementGraceEnd, setEntitlementGraceEnd] = useState<string | null>(null);
  const [trialBillingReady, setTrialBillingReady] = useState<boolean | null>(null);
  const [planReturnStatus, setPlanReturnStatus] = useState<"pending" | "confirmed" | "delayed" | null>(null);
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
  const [stripePaymentMode, setStripePaymentMode] = useState<"test" | "live" | "unavailable">("unavailable");
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
    setStripePaymentMode(connect.paymentMode === "test" || connect.paymentMode === "live" ? connect.paymentMode : "unavailable");
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

        const checkoutParams = new URLSearchParams(window.location.search);
        const returnedFromCheckout = checkoutParams.get("upgrade") === "success";
        const checkoutSessionId = checkoutParams.get("session_id");
        if (returnedFromCheckout) {
          setPlanReturnStatus("pending");
          if (checkoutSessionId) {
            for (let attempt = 0; attempt < 5; attempt += 1) {
              try {
                const response = await fetch("/api/pro/checkout/confirm", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ session_id: checkoutSessionId }),
                  cache: "no-store",
                });
                const result = await response.json().catch(() => null) as { confirmed?: boolean } | null;
                if (response.ok && result?.confirmed === true) break;
                if (response.status !== 202 && response.status !== 503) break;
              } catch {
                // The durable Stripe webhook remains the fallback if this
                // immediate, authenticated confirmation cannot reach the API.
              }
              if (attempt < 4) await new Promise((resolve) => window.setTimeout(resolve, 1_000 + attempt * 500));
            }
          }
        }

        let entitlement = await getClientProEntitlement();
        if (returnedFromCheckout && !entitlement?.has_pro) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 1_000));
            entitlement = await getClientProEntitlement();
            if (entitlement?.has_pro) break;
          }
        }
        if (entitlement) {
          setPlanStatus(entitlement.stripe_status);
          setHasProAccess(entitlement.has_pro);
          setProAccessSource(entitlement.source);
          setProAccessExpiresAt(entitlement.expires_at);
          setTrialAvailable(entitlement.trial_available);
          setTrialEndsAt(entitlement.trial_ends_at);
          setEntitlementGraceEnd(entitlement.grace_ends_at);
          setTrialBillingReady(entitlement.trial_billing_ready);
        } else {
          setError("Could not verify your plan. Refresh the page before using Pro tools.");
        }
        if (returnedFromCheckout) {
          setPlanReturnStatus(entitlement?.has_pro ? "confirmed" : "delayed");
          window.dispatchEvent(new Event("workcraft:pro-entitlement-refresh"));
          checkoutParams.delete("upgrade");
          checkoutParams.delete("session_id");
          const cleanQuery = checkoutParams.toString();
          window.history.replaceState(null, "", `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}${window.location.hash}`);
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
    setMessage(null);
    setError(null);
    if (!isValidOptionalBusinessPhone(phone)) {
      setError(language === "es"
        ? "Ingresa un número de teléfono válido, como (555) 123-4567, o deja el campo vacío."
        : "Enter a valid phone number, such as (555) 123-4567, or leave this field blank.");
      return;
    }
    setSaving(true);

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
    setUpgrading(true);
    setPlanActionError(null);
    try {
      const response = await fetch("/api/pro/checkout", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Unable to start checkout.");
      window.location.href = result.url;
    } catch (err) {
      setPlanActionError(err instanceof Error ? err.message : "Unable to start checkout.");
      setUpgrading(false);
    }
  };

  const handleManageBilling = async () => {
    setManagingBilling(true);
    setPlanActionError(null);
    try {
      const response = await fetch("/api/pro/portal", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Unable to open billing settings.");
      window.location.href = result.url;
    } catch (err) {
      setPlanActionError(err instanceof Error ? err.message : "Unable to open billing settings.");
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
  const formattedGraceEnd = planStatus === "past_due" && entitlementGraceEnd
    ? new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(entitlementGraceEnd))
    : null;
  const formattedTrialEnd = trialEndsAt
    ? new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(trialEndsAt))
    : null;
  const planReturnMessage = planReturnStatus === "pending"
    ? translate(language, "Confirming your Pro access…")
    : planReturnStatus === "confirmed"
      ? translate(language, "Your Pro access is active. Scheduling and other Pro features are now unlocked.")
      : planReturnStatus === "delayed"
        ? translate(language, "Your checkout is complete. Pro access is still syncing; refresh this page in a moment.")
        : null;

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

      <section id="plan" className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your plan</p><h2 className="mt-1 text-lg font-bold capitalize text-slate-900">{hasProAccess ? "WorkCraft AI Pro" : "WorkCraft AI Free"}</h2><p className="mt-1 text-xs text-slate-600">{proAccessSource === "admin_grant" ? <>{"Admin-granted Pro access"}{proAccessExpiresAt ? <> {"through"} {new Date(proAccessExpiresAt).toLocaleString()}.</> : <> {"until an administrator revokes it."}</>}</> : hasProAccess ? (language === "es" ? "Tu plan Pro incluye cotizaciones, borradores con IA, correos para clientes y cargas de archivos. Consulta los límites actuales y lo que te queda en el panel de uso." : "Your Pro plan includes estimates, AI drafts, customer emails, and media uploads. Check the current limits and what remains in the usage panel below.") : (language === "es" ? "Crea cotizaciones, administra tu lista de precios y comparte propuestas. Consulta abajo si tu plan incluye correos para clientes. Mejora a Pro para usar IA en la nube y programar trabajos." : "Create estimates, manage your price book, and share proposals. Check below whether your plan includes customer emails. Upgrade to Pro for cloud AI and job scheduling.")}</p>
          {proAccessSource === "stripe" && planStatus === "trialing" && <p role="status" className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900">{trialNotice(language, formattedTrialEnd, trialBillingReady)}</p>}
          {planStatus === "past_due" && proAccessSource !== "admin_grant" && <p role="alert" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">{hasProAccess
            ? language === "es"
              ? `No pudimos cobrar tu suscripción Pro. Conservas el acceso hasta ${formattedGraceEnd ?? "el final del período de gracia"} (hora del este). Selecciona Administrar facturación para actualizar el pago.`
              : `Your Pro payment failed. You keep Pro access until ${formattedGraceEnd ?? "the end of your grace period"} (Eastern time). Select Manage billing to update payment.`
            : language === "es"
              ? "El plazo para actualizar tu pago terminó. Tu cuenta pasó al plan Gratis; tus datos siguen guardados. Selecciona Administrar facturación para recuperar Pro."
              : "Your payment grace period ended. Your account moved to Free; your data is safe. Select Manage billing to restore Pro."}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasProAccess && <span className="rounded-full bg-green-100 px-3 py-1.5 text-xs font-bold text-green-800">{proAccessSource === "admin_grant" ? "Admin granted" : planBadge(language, planStatus, trialBillingReady)}</span>}
          {hasBillingHistory && <button type="button" disabled={managingBilling} onClick={() => void handleManageBilling()} className="min-h-12 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">{managingBilling ? "Opening billing…" : billingActionLabel(language, planStatus, trialBillingReady)}</button>}
          {!hasProAccess && !needsBillingAttention && <button type="button" disabled={upgrading} onClick={() => void handleUpgrade()} className="min-h-12 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{upgrading ? "Opening checkout…" : trialAvailable ? "Start 14-day Pro trial" : "Upgrade to Pro"}</button>}
        </div>
        {planReturnMessage && <p role="status" aria-live="polite" className={`w-full rounded-lg border px-3 py-2 text-sm leading-5 ${planReturnStatus === "delayed" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-900"}`}>{planReturnMessage}</p>}
        {planActionError && <p role="alert" aria-live="assertive" className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-800">{localizePlanActionError(language, planActionError)}</p>}
        {!hasProAccess && <p className="w-full text-xs text-slate-600">{language === "es"
          ? trialAvailable ? "Prueba todas las funciones Pro gratis durante 14 días. No se requiere tarjeta. La prueba termina automáticamente; agrega los datos de facturación antes de que termine para continuar a $9.99 al mes. Si no te suscribes, tu cuenta vuelve al plan Gratis y tus datos guardados permanecen." : "WorkCraft AI Pro cuesta $9.99 al mes. Las funciones gratuitas siguen disponibles. Esta cuenta ya usó una prueba Pro o no es apta para una prueba."
          : trialAvailable ? "Try every Pro feature free for 14 days. No card required. The trial ends automatically; add billing details before it ends to continue at $9.99/month. Your account returns to Free if you do not subscribe, and your saved data remains." : "WorkCraft AI Pro is $9.99 per month. Free features remain available. This account has already used or is not eligible for a Pro trial."}</p>}
      </section>

      <MfaSecurity />
      <EmailPreferences language={language} />

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="account-usage-heading">
        <h2 id="account-usage-heading" className="text-lg font-bold text-slate-900">Your usage and allowances</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600">Usage is counted per account and resets at UTC midnight or the first day of the month, as shown.</p>
        {usageLoading && <p role="status" className="mt-3 text-sm text-slate-500">Loading your usage…</p>}
        {!usageLoading && !usageSnapshot && <p role="status" className="mt-3 text-sm text-amber-800">Usage totals are temporarily unavailable. Refresh this page shortly.</p>}
        {usageSnapshot && <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-4">
            <h3 className="text-sm font-bold text-slate-900">Estimates</h3>
            <p role="status" className={`mt-1 text-xs leading-5 ${remaining(usageSnapshot.estimates.daily_used, usageSnapshot.estimates.daily_limit) === 0 || remaining(usageSnapshot.estimates.monthly_used, usageSnapshot.estimates.monthly_limit) === 0 ? "font-semibold text-red-800" : remaining(usageSnapshot.estimates.daily_used, usageSnapshot.estimates.daily_limit) <= 2 || remaining(usageSnapshot.estimates.monthly_used, usageSnapshot.estimates.monthly_limit) <= 10 ? "font-semibold text-amber-800" : "text-slate-700"}`}>{language === "es" ? `Quedan ${remaining(usageSnapshot.estimates.daily_used, usageSnapshot.estimates.daily_limit)} de ${usageSnapshot.estimates.daily_limit} hoy y ${remaining(usageSnapshot.estimates.monthly_used, usageSnapshot.estimates.monthly_limit)} de ${usageSnapshot.estimates.monthly_limit} este mes` : `${remaining(usageSnapshot.estimates.daily_used, usageSnapshot.estimates.daily_limit)} of ${usageSnapshot.estimates.daily_limit} left today · ${remaining(usageSnapshot.estimates.monthly_used, usageSnapshot.estimates.monthly_limit)} of ${usageSnapshot.estimates.monthly_limit} left this month`}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <h3 className="text-sm font-bold text-slate-900">{language === "es" ? "Correos para clientes" : "Customer emails"}</h3>
            <p role="status" className={`mt-1 text-xs leading-5 ${remaining(usageSnapshot.email.daily_used, usageSnapshot.email.daily_limit) === 0 || remaining(usageSnapshot.email.monthly_used, usageSnapshot.email.monthly_limit) === 0 ? "font-semibold text-red-800" : remaining(usageSnapshot.email.daily_used, usageSnapshot.email.daily_limit) <= 1 || remaining(usageSnapshot.email.monthly_used, usageSnapshot.email.monthly_limit) <= 20 ? "font-semibold text-amber-800" : "text-slate-700"}`}>{language === "es" ? `Quedan ${remaining(usageSnapshot.email.daily_used, usageSnapshot.email.daily_limit)} de ${usageSnapshot.email.daily_limit} hoy y ${remaining(usageSnapshot.email.monthly_used, usageSnapshot.email.monthly_limit)} de ${usageSnapshot.email.monthly_limit} este mes` : `${remaining(usageSnapshot.email.daily_used, usageSnapshot.email.daily_limit)} of ${usageSnapshot.email.daily_limit} left today · ${remaining(usageSnapshot.email.monthly_used, usageSnapshot.email.monthly_limit)} of ${usageSnapshot.email.monthly_limit} left this month`}</p>
            <p className="mt-1 text-[11px] text-slate-500">{hasProAccess ? (language === "es" ? "Este cupo incluye cotizaciones, seguimientos, avisos de preguntas y facturas." : "Estimate emails, follow-ups, question alerts, and invoices share this allowance.") : (language === "es" ? "El plan Gratis puede enviar cotizaciones por correo si hay un cupo disponible." : "Free accounts can email estimates when an allowance is available.")}</p>
          </div>
          {hasProAccess && <>
            <div className="rounded-lg bg-slate-50 p-4">
              <h3 className="text-sm font-bold text-slate-900">Cloud AI drafts</h3>
              <p role="status" className={`mt-1 text-xs leading-5 ${remaining(usageSnapshot.ai.daily_used, usageSnapshot.ai.daily_limit) === 0 || remaining(usageSnapshot.ai.monthly_used, usageSnapshot.ai.monthly_limit) === 0 ? "font-semibold text-red-800" : remaining(usageSnapshot.ai.daily_used, usageSnapshot.ai.daily_limit) <= 1 || remaining(usageSnapshot.ai.monthly_used, usageSnapshot.ai.monthly_limit) <= 10 ? "font-semibold text-amber-800" : "text-slate-700"}`}>{usageSnapshot.ai.enabled ? `${remaining(usageSnapshot.ai.daily_used, usageSnapshot.ai.daily_limit)} of ${usageSnapshot.ai.daily_limit} left today · ${remaining(usageSnapshot.ai.monthly_used, usageSnapshot.ai.monthly_limit)} of ${usageSnapshot.ai.monthly_limit} left this month` : "Cloud estimate drafting is temporarily paused."}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <h3 className="text-sm font-bold text-slate-900">Private media storage</h3>
              <p role="status" className={`mt-1 text-xs leading-5 ${usageSnapshot.media.monthly_limit_bytes - usageSnapshot.media.monthly_used_bytes <= 0 ? "font-semibold text-red-800" : usageSnapshot.media.monthly_limit_bytes - usageSnapshot.media.monthly_used_bytes <= 10 * 1048576 ? "font-semibold text-amber-800" : "text-slate-700"}`}>{`${(Math.max(usageSnapshot.media.monthly_limit_bytes - usageSnapshot.media.monthly_used_bytes, 0) / 1048576).toFixed(2)} MB left to upload this month · ${(usageSnapshot.media.retained_bytes / 1048576).toFixed(2)} of ${(usageSnapshot.media.retained_limit_bytes / 1048576).toFixed(0)} MB stored · ${usageSnapshot.media.file_count} of ${usageSnapshot.media.file_limit} files`}</p>
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
            {stripePaymentMode === "test" && <p role="status" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">{language === "es" ? "Stripe está en modo de prueba. La incorporación y los pagos usan datos de prueba; no se cobran fondos reales." : "Stripe is in test mode. Setup and payments use test data; no real money is collected."}</p>}
            {!hasProAccess && <p className="mt-2 text-xs font-semibold text-slate-700">Customer payment collection is a Pro feature. See your plan above for trial or upgrade options.</p>}
            {hasProAccess && !connectLoading && stripeConnected && stripeChargesEnabled && <p className="mt-2 text-xs font-semibold text-green-700">Stripe is connected and can accept payments.{stripeRequirementsDue ? " Stripe may request updated business information later." : ""}</p>}
            {hasProAccess && !connectLoading && stripeConnected && !stripeChargesEnabled && stripeSetupState === "needs_action" && <p role="status" className="mt-2 text-xs font-semibold text-amber-700">Stripe still needs information before it can activate payments. Continue setup to complete the remaining verification steps.</p>}
            {hasProAccess && !connectLoading && stripeConnected && !stripeChargesEnabled && stripeSetupState === "under_review" && <p role="status" className="mt-2 text-xs font-semibold text-amber-700">Stripe is reviewing your identity or business information. You do not need to submit it again while Stripe reviews it; we will check your status automatically for a short time.</p>}
            {hasProAccess && !connectLoading && stripeConnected && !stripeChargesEnabled && stripeSetupState === "incomplete" && <p className="mt-2 text-xs font-semibold text-amber-700">Stripe setup is not active yet. Continue setup to review any remaining steps.</p>}
            {hasProAccess && !connectLoading && stripeStatusError && <p role="status" className="mt-2 text-xs font-semibold text-red-700">We could not check your Stripe status. Retry the status check.</p>}
            {hasProAccess && !connectLoading && !stripeConnected && <p className="mt-2 text-xs text-slate-600">Connect Stripe to collect down payments and invoice balances. Stripe will guide you through account verification. Once active, sign in to Stripe with your own credentials to use the Full Dashboard.</p>}
            {hasProAccess && connectLoading && <p className="mt-2 text-xs text-slate-500">Checking Stripe connection…</p>}
          </div>
          {hasProAccess && stripeConnected && stripeChargesEnabled && stripeDashboard === "full" && <a href="https://dashboard.stripe.com/" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50">Open Stripe Dashboard</a>}
          {hasProAccess && stripeConnected && !stripeChargesEnabled && stripeSetupState === "under_review" && <button type="button" disabled={stripeStatusRefreshing || connectLoading} onClick={() => void handleRefreshStripeStatus()} className="min-h-12 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">{stripeStatusRefreshing ? "Checking status…" : "Check Stripe status"}</button>}
          {hasProAccess && !(stripeConnected && stripeChargesEnabled && stripeDashboard === "full") && !(stripeConnected && !stripeChargesEnabled && stripeSetupState === "under_review") && <button type="button" disabled={connectingStripe || connectLoading} onClick={() => void handleConnectStripe()} className="min-h-12 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">{connectingStripe ? "Opening Stripe…" : stripeConnected && stripeChargesEnabled && stripeDashboard === "express" ? "Open Stripe Express" : stripeConnected ? "Continue Stripe setup" : "Connect Stripe"}</button>}
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
              maxLength={40}
              autoComplete="tel"
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
            className="min-h-12 bg-blue-600 hover:bg-blue-500 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
          >
            {saving ? "Saving Changes..." : "Save Preferences"}
          </button>
        </div>
      </form>
    </div>
    </LocalizedTree>
  );
}
