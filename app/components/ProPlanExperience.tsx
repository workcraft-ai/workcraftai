"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/app/utils/supabase/client";
import { translate, useLanguage } from "@/app/components/LanguageProvider";
import { getClientProEntitlement, type ClientProEntitlement } from "@/lib/client-pro-access";

type ProPlanContextValue = {
  entitlement: ClientProEntitlement | null;
  loading: boolean;
};

const ProPlanContext = createContext<ProPlanContextValue | null>(null);

export function ProPlanProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [entitlement, setEntitlement] = useState<ClientProEntitlement | null>(null);
  const [entitlementUserId, setEntitlementUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const nextUserId = session?.user?.id ?? null;
      setUserId(nextUserId);
      setIdentityLoading(false);
      if (!nextUserId) {
        setEntitlement(null);
        setEntitlementUserId(null);
      }
    });

    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUserId(data.user?.id ?? null);
      setIdentityLoading(false);
    }).catch(() => {
      if (!active) return;
      setUserId(null);
      setIdentityLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (identityLoading) return;
    if (!userId) return;

    let active = true;
    let requestNumber = 0;
    let checkoutRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const currentRequest = ++requestNumber;
      const result = await getClientProEntitlement();
      if (active && currentRequest === requestNumber) {
        setEntitlement(result);
        setEntitlementUserId(userId);
      }
      return result;
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const refreshOnCheckoutConfirmation = () => { void refresh(); };

    const checkoutParams = new URLSearchParams(window.location.search);
    const checkoutReturn = pathname === "/profile" && checkoutParams.get("upgrade") === "success";
    if (checkoutReturn) {
      let checks = 0;
      const refreshUntilProIsReady = async () => {
        const result = await refresh();
        checks += 1;
        if (active && !result?.has_pro && checks < 8) {
          checkoutRefreshTimer = setTimeout(() => { void refreshUntilProIsReady(); }, 2_000);
        }
      };
      void refreshUntilProIsReady();
    } else {
      void refresh();
    }
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("workcraft:pro-entitlement-refresh", refreshOnCheckoutConfirmation);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("workcraft:pro-entitlement-refresh", refreshOnCheckoutConfirmation);
      if (checkoutRefreshTimer) clearTimeout(checkoutRefreshTimer);
    };
  }, [identityLoading, pathname, userId]);

  const currentEntitlement = entitlementUserId === userId ? entitlement : null;
  const value = useMemo(() => ({ entitlement: currentEntitlement, loading: identityLoading || (!!userId && entitlementUserId !== userId) }), [currentEntitlement, entitlementUserId, identityLoading, userId]);
  return <ProPlanContext.Provider value={value}>{children}</ProPlanContext.Provider>;
}

function useProPlan() {
  const context = useContext(ProPlanContext);
  if (!context) throw new Error("ProPlanExperience must be rendered inside ProPlanProvider");
  return context;
}

type ProPlanActionProps = {
  className?: string;
  variant?: "button" | "text";
};

export function ProPlanAction({ className, variant = "button" }: ProPlanActionProps) {
  const { entitlement, loading } = useProPlan();
  const { language } = useLanguage();
  if (loading || !entitlement || entitlement.has_pro) return null;

  const label = translate(language, entitlement.trial_available ? "Start 14-day Pro trial" : "Upgrade to Pro");
  const styles = variant === "text"
    ? "font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800"
    : "inline-flex min-h-11 items-center justify-center rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400";

  return <Link href="/profile#plan" className={className ?? styles}>{label}</Link>;
}

function isWorkspaceNavigation(pathname: string) {
  return ["/dashboard", "/customers", "/schedule", "/pricebook", "/reports"].includes(pathname);
}

export function ProPlanBanner() {
  const pathname = usePathname();
  const { entitlement, loading } = useProPlan();
  const { language } = useLanguage();

  if (loading || !entitlement || !isWorkspaceNavigation(pathname) ||
    (entitlement.source === "admin_grant" && entitlement.stripe_status === "past_due") ||
    (entitlement.has_pro && !["trialing", "past_due"].includes(entitlement.stripe_status))) return null;

  const date = entitlement.trial_ends_at
    ? new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(entitlement.trial_ends_at))
    : null;
  let message: string;
  if (entitlement.stripe_status === "past_due") {
    const graceEnd = entitlement.grace_ends_at
      ? new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(entitlement.grace_ends_at))
      : null;
    message = entitlement.has_pro
      ? language === "es"
        ? `No pudimos cobrar tu suscripción Pro. Conservas Pro hasta ${graceEnd ?? "el final del período de gracia"} (hora del este). Actualiza tu pago para evitar perder acceso.`
        : `Your Pro payment did not go through. Pro stays available until ${graceEnd ?? "the end of your grace period"} (Eastern time). Update billing to keep access.`
      : language === "es"
        ? "El plazo para actualizar tu pago terminó y tu cuenta pasó al plan Gratis. Tus datos están guardados; actualiza la facturación para recuperar Pro."
        : "Your payment grace period ended and your account moved to Free. Your data is safe; update billing to restore Pro.";
  } else if (entitlement.has_pro && entitlement.stripe_status === "trialing") {
    if (entitlement.trial_billing_ready === true) {
      message = date
        ? translate(language, "Your Pro upgrade is set. Your 14-day trial ends {date}. Your saved payment method will be charged $9.99/month starting then unless you cancel before the trial ends. No charge is due today.").replace("{date}", date)
        : translate(language, "Your Pro upgrade is set. Your saved payment method will be charged $9.99/month when the trial ends unless you cancel before then. No charge is due today.");
    } else if (entitlement.trial_billing_ready === false) {
      message = date
        ? translate(language, "Your Pro trial ends {date}. Add billing details before then to continue at $9.99/month. Without them, your account returns to Free and your saved data remains.").replace("{date}", date)
        : translate(language, "Your Pro trial is active. Add billing details in Manage billing to continue at $9.99/month. Without them, your account returns to Free and your saved data remains.");
    } else {
      message = date
        ? translate(language, "Your Pro trial ends {date}. Check Manage billing to confirm whether a payment method is set and when billing begins.").replace("{date}", date)
        : translate(language, "Your Pro trial is active. Check Manage billing to confirm whether a payment method is set and when billing begins.");
    }
  } else if (entitlement.trial_available) {
    message = translate(language, "Try Pro free for 14 days—no card required.");
  } else {
    message = translate(language, "Upgrade to Pro for $9.99/month.");
  }

  const label = entitlement.stripe_status === "past_due" || ["unpaid", "incomplete"].includes(entitlement.stripe_status)
    ? translate(language, "Manage billing")
    : entitlement.has_pro && entitlement.stripe_status === "trialing"
    ? translate(language, entitlement.trial_billing_ready === true ? "Manage billing" : entitlement.trial_billing_ready === false ? "Add payment method" : "Review billing")
    : translate(language, entitlement.trial_available ? "Start 14-day Pro trial" : "Upgrade to Pro");
  return (
    <aside className="print:hidden border-b border-orange-100 bg-orange-50/80 px-4 py-2.5 text-slate-800" aria-label={translate(language, "Pro plan options")}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs leading-5 sm:text-sm">{message}</p>
        <Link href="/profile#plan" className="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-xs font-semibold text-orange-900 transition hover:bg-orange-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">
          {label}
        </Link>
      </div>
    </aside>
  );
}
