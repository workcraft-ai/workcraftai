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
    const refresh = async () => {
      const currentRequest = ++requestNumber;
      const result = await getClientProEntitlement();
      if (active && currentRequest === requestNumber) {
        setEntitlement(result);
        setEntitlementUserId(userId);
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [identityLoading, userId]);

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

  if (loading || !entitlement || !isWorkspaceNavigation(pathname) || (entitlement.has_pro && entitlement.stripe_status !== "trialing")) return null;

  const date = entitlement.trial_ends_at
    ? new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(entitlement.trial_ends_at))
    : null;
  let message: string;
  if (entitlement.has_pro && entitlement.stripe_status === "trialing") {
    message = date
      ? `${translate(language, "Your Pro trial is active until")} ${date}${translate(language, ". Add a payment method to keep Pro at $9.99/month.")}`
      : translate(language, "Your Pro trial is active. Add a payment method to keep Pro at $9.99/month.");
  } else if (entitlement.trial_available) {
    message = translate(language, "Try Pro free for 14 days—no card required.");
  } else {
    message = translate(language, "Upgrade to Pro for $9.99/month.");
  }

  const label = translate(language, entitlement.trial_available && !entitlement.has_pro ? "Start 14-day Pro trial" : "Upgrade to Pro");
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
