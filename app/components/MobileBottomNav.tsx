"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { translate, useLanguage } from "@/app/components/LanguageProvider";

type MobileBottomNavProps = {
  pathname: string | null;
  adminRole: string | null;
};

const primaryLinks = [
  { href: "/dashboard", label: "Dashboard", icon: "home" },
  { href: "/customers", label: "Customers", icon: "customers" },
  { href: "/schedule", label: "Jobs", icon: "jobs" },
  { href: "/pricebook", label: "Price book", icon: "pricebook" },
] as const;

function isPathActive(pathname: string | null, href: string) {
  if (href === "/dashboard") {
    return pathname === href || Boolean(pathname?.startsWith("/estimate/"));
  }
  return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
}

function NavIcon({ name }: { name: string }) {
  const common = { className: "h-5 w-5", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };

  switch (name) {
    case "home":
      return <svg {...common}><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></svg>;
    case "customers":
      return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 4.6V20" /></svg>;
    case "jobs":
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h3M8 17h7" /></svg>;
    case "pricebook":
      return <svg {...common}><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 1 4 17.5zM4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 6h8M8 9h6" /></svg>;
    case "more":
      return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></svg>;
    case "reports":
      return <svg {...common}><path d="M4 19V5M4 19h17" /><path d="m7 15 4-4 3 2 5-6" /></svg>;
    case "help":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4.6 1.4c-.5.6-2.1 1.2-2.1 2.6v.5M12 17h.01" /></svg>;
    case "admin":
      return <svg {...common}><path d="M12 3 4 6v5c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z" /><path d="m9 12 2 2 4-4" /></svg>;
    default:
      return null;
  }
}

export default function MobileBottomNav({ pathname, adminRole }: MobileBottomNavProps) {
  const { language } = useLanguage();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [moreOpen]);
  const moreLinks = [
    { href: "/reports", label: "Reports", icon: "reports" },
    { href: "/help", label: language === "es" ? "Centro de ayuda" : "Help center", icon: "help" },
    ...(adminRole ? [{ href: "/admin", label: "Admin support", icon: "admin" }] : []),
  ];
  const moreActive = moreLinks.some(({ href }) => isPathActive(pathname, href));

  return (
    <>
      {moreOpen && <button type="button" aria-label={translate(language, "Close more navigation")} className="fixed inset-0 z-[48] cursor-default bg-black/10 lg:hidden" onClick={() => setMoreOpen(false)} />}
      <nav aria-label={translate(language, "Mobile navigation")} className="mobile-app-nav fixed inset-x-0 bottom-0 z-[50] grid grid-cols-5 border-t border-slate-200 bg-white/95 px-1 pt-1 text-slate-700 shadow-[0_-8px_24px_rgba(15,23,42,.10)] backdrop-blur lg:hidden">
        {primaryLinks.map(({ href, label, icon }) => {
          const active = isPathActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              onClick={() => setMoreOpen(false)}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1 text-[10px] font-semibold leading-none transition-colors ${active ? "text-orange-800" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <NavIcon name={icon} />
              <span className="max-w-full truncate">{translate(language, label)}</span>
            </Link>
          );
        })}
        <button type="button" aria-expanded={moreOpen} aria-current={moreActive ? "page" : undefined} aria-controls="mobile-more-menu" onClick={() => setMoreOpen((open) => !open)} className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1 text-[10px] font-semibold leading-none transition-colors ${moreOpen || moreActive ? "text-orange-800" : "text-slate-600 hover:bg-slate-100"}`}>
          <NavIcon name="more" />
          <span>{translate(language, "More")}</span>
        </button>
      </nav>
      {moreOpen && (
        <div id="mobile-more-menu" className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 z-[51] w-64 rounded-2xl border border-slate-200 bg-white p-2 text-slate-800 shadow-xl lg:hidden">
          <p className="px-3 pb-2 pt-1 text-xs font-bold uppercase tracking-wide text-slate-500">{translate(language, "More tools")}</p>
          {moreLinks.map(({ href, label, icon }) => {
            const active = isPathActive(pathname, href);
            return <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => setMoreOpen(false)} className={`flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-semibold ${active ? "bg-orange-50 text-orange-900" : "text-slate-700 hover:bg-slate-50"}`}><NavIcon name={icon} />{translate(language, label)}</Link>;
          })}
        </div>
      )}
    </>
  );
}
