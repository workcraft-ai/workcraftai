"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/utils/supabase/client";
import { translate, useLanguage } from "@/app/components/LanguageProvider";

type NotificationType = "customer_question" | "estimate_accepted" | "estimate_declined" | "payment_received";

type ContractorNotification = {
  id: string;
  estimate_id: string | null;
  event_type: NotificationType;
  customer_name: string;
  estimate_reference: string | null;
  amount_cents: number | string | null;
  currency: string | null;
  created_at: string;
  read_at: string | null;
};

const eventText: Record<NotificationType, string> = {
  customer_question: "asked a question about your estimate",
  estimate_accepted: "accepted your estimate",
  estimate_declined: "declined your estimate",
  payment_received: "made a payment on your estimate",
};

const notificationFields =
  "id, estimate_id, event_type, customer_name, estimate_reference, amount_cents, currency, created_at, read_at";

function formatDate(value: string, language: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatAmount(amount: number | string | null, currency: string | null, language: string) {
  const cents = Number(amount);
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  const code = typeof currency === "string" && /^[a-z]{3}$/i.test(currency) ? currency.toUpperCase() : "USD";
  try {
    return new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", {
      style: "currency",
      currency: code,
    }).format(cents / 100);
  } catch {
    return null;
  }
}

export default function NotificationBell({ userId }: { userId: string }) {
  const { language } = useLanguage();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const rootRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const requestRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<ContractorNotification[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const refresh = useCallback(async (includeList: boolean) => {
    const requestId = ++requestRef.current;
    const unreadResult = await supabase
      .from("contractor_notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null);

    if (requestId !== requestRef.current) return;
    if (unreadResult.error) {
      setLoadError(true);
      return;
    }
    setUnreadCount(unreadResult.count ?? 0);
    setLoadError(false);

    if (!includeList) return;
    setLoadingList(true);
    const listResult = await supabase
      .from("contractor_notifications")
      .select(notificationFields)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (requestId !== requestRef.current) return;
    setLoadingList(false);
    if (listResult.error) {
      setLoadError(true);
      return;
    }
    setNotifications((listResult.data ?? []) as ContractorNotification[]);
  }, [supabase, userId]);

  useEffect(() => {
    void refresh(false);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(openRef.current);
    }, 60_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh(openRef.current);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      requestRef.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (open) void refresh(true);
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const markRead = async (notification: ContractorNotification) => {
    if (notification.read_at) return;
    const readAt = new Date().toISOString();
    const { error } = await supabase
      .from("contractor_notifications")
      .update({ read_at: readAt })
      .eq("id", notification.id)
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) return;
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: readAt } : item));
    setUnreadCount((current) => Math.max(0, current - 1));
  };

  const openNotification = async (notification: ContractorNotification) => {
    await markRead(notification);
    setOpen(false);
    const safeEstimateId = notification.estimate_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notification.estimate_id)
      ? notification.estimate_id
      : null;
    router.push(safeEstimateId ? "/estimate/" + encodeURIComponent(safeEstimateId) : "/dashboard");
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    const readAt = new Date().toISOString();
    const { error } = await supabase
      .from("contractor_notifications")
      .update({ read_at: readAt })
      .eq("user_id", userId)
      .is("read_at", null);
    setMarkingAll(false);
    if (error) {
      setLoadError(true);
      return;
    }
    setNotifications((current) => current.map((item) => item.read_at ? item : { ...item, read_at: readAt }));
    setUnreadCount(0);
  };

  const buttonLabel = unreadCount
    ? translate(language, "Notifications") + ", " + unreadCount + " " + translate(language, "unread")
    : translate(language, "Notifications");

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-controls={open ? "contractor-notification-panel" : undefined}
        onClick={() => setOpen((current) => !current)}
        className="relative inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-100 transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
        {unreadCount > 0 && (
          <span aria-hidden="true" className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-slate-900 bg-orange-600 px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section
          id="contractor-notification-panel"
          aria-label={translate(language, "Notifications")}
          className="absolute right-0 top-full z-[60] mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-xl sm:w-96"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold">{translate(language, "Notifications")}</h2>
              <p className="text-xs text-slate-500">{unreadCount} {translate(language, "unread")}</p>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button type="button" onClick={() => void markAllRead()} disabled={markingAll} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-orange-800 underline disabled:opacity-50">
                  {markingAll ? translate(language, "Marking…") : translate(language, "Mark all as read")}
                </button>
              )}
              <button type="button" aria-label={translate(language, "Close notifications")} onClick={() => setOpen(false)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m4 4 12 12M16 4 4 16" /></svg>
              </button>
            </div>
          </div>
          {loadError ? (
            <p role="status" className="px-4 py-6 text-sm text-slate-600">{translate(language, "Notifications could not load.")}</p>
          ) : loadingList && notifications.length === 0 ? (
            <p role="status" className="px-4 py-6 text-sm text-slate-600">{translate(language, "Loading notifications…")}</p>
          ) : notifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-600">{translate(language, "No notifications yet.")}</p>
          ) : (
            <ul className="max-h-[min(70vh,28rem)] overflow-y-auto divide-y divide-slate-100">
              {notifications.map((notification) => {
                const title = notification.customer_name + " " + translate(language, eventText[notification.event_type]);
                const reference = notification.estimate_reference
                  ? translate(language, "Estimate") + " " + notification.estimate_reference
                  : translate(language, "Estimate");
                const amount = notification.event_type === "payment_received"
                  ? formatAmount(notification.amount_cents, notification.currency, language)
                  : null;
                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => void openNotification(notification)}
                      className={"flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 " + (notification.read_at ? "" : "bg-orange-50/70")}
                    >
                      <span className={"mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " + (notification.read_at ? "bg-transparent" : "bg-orange-600")} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold leading-5">{title}</span>
                        <span className="mt-1 block text-xs text-slate-600">{reference}{amount ? " · " + amount : ""}</span>
                        <span className="mt-1 block text-[11px] text-slate-500">{formatDate(notification.created_at, language)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
