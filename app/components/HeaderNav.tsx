"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/app/utils/supabase/client";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { translate, useLanguage } from "@/app/components/LanguageProvider";

const appLinks = [
  { href: "/dashboard", label: "Estimates" },
  { href: "/schedule", label: "Schedule & jobs" },
  { href: "/pricebook", label: "Price book" },
  { href: "/reports", label: "Reports" },
];

export default function HeaderNav() {
  const { language, setLanguage } = useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openMenus, setOpenMenus] = useState({ pathname: "", dropdown: false, mobile: false });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const dropdownOpen = openMenus.pathname === pathname && openMenus.dropdown;
  const mobileMenuOpen = openMenus.pathname === pathname && openMenus.mobile;
  const setDropdownOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setOpenMenus((current) => ({ pathname: pathname ?? "", dropdown: typeof next === "function" ? next(current.pathname === pathname && current.dropdown) : next, mobile: current.pathname === pathname && current.mobile }));
  }, [pathname]);
  const setMobileMenuOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setOpenMenus((current) => ({ pathname: pathname ?? "", dropdown: current.pathname === pathname && current.dropdown, mobile: typeof next === "function" ? next(current.pathname === pathname && current.mobile) : next }));
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();
    const loadAdminRole = async (signedIn: boolean) => {
      if (!signedIn) {
        setAdminRole(null);
        return;
      }
      try {
        const response = await fetch("/api/admin/me", { cache: "no-store" });
        const result = response.ok ? await response.json() : null;
        setAdminRole(typeof result?.role === "string" ? result.role : null);
      } catch {
        setAdminRole(null);
      }
    };
    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
      void loadAdminRole(Boolean(data.user));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        setUser(session?.user ?? null);
        setLoading(false);
        void loadAdminRole(Boolean(session?.user));
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDropdownOpen(false);
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [setDropdownOpen, setMobileMenuOpen]);


  const handleSignOut = async () => {
    const supabase = createClient();
    setDropdownOpen(false);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  if (loading) {
    return <div aria-hidden="true" className="h-9 w-24 animate-pulse rounded-lg bg-slate-800" />;
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setLanguage(language === "en" ? "es" : "en")} className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-xs font-bold text-slate-100 transition hover:bg-slate-700" aria-label={language === "en" ? "Cambiar a español" : "Switch to English"}>
          {language === "en" ? "ES" : "EN"}
        </button>
        <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white">
          {translate(language, "Sign in")}
        </Link>
        <Link href="/signup" className="rounded-lg bg-orange-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400">
          {translate(language, "Create account")}
        </Link>
      </div>
    );
  }

  const userInitial = user.email?.charAt(0).toUpperCase() || "U";
  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard" || pathname.startsWith("/estimate/")
      : pathname === href || pathname.startsWith(`${href}/`);

  const links = adminRole ? [...appLinks, { href: "/admin", label: "Admin support" }] : appLinks;
  const renderLinks = (mobile = false) => (
    <>
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          onClick={() => setMobileMenuOpen(false)}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            isActive(href)
              ? "bg-slate-800 text-orange-300"
              : "text-slate-300 hover:bg-slate-800 hover:text-white"
          } ${mobile ? "block w-full" : "whitespace-nowrap"}`}
        >
          {translate(language, label)}
        </Link>
      ))}
      <Link
        href="/estimate/new"
        onClick={() => setMobileMenuOpen(false)}
        className={`rounded-lg bg-orange-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-orange-500 ${mobile ? "mt-2 block text-center" : "whitespace-nowrap"}`}
      >
        {translate(language, "+ New estimate")}
      </Link>
    </>
  );

  return (
    <div className="relative flex items-center gap-2 sm:gap-3">
      <button type="button" onClick={() => setLanguage(language === "en" ? "es" : "en")} className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-xs font-bold text-slate-100 transition hover:bg-slate-700" aria-label={language === "en" ? "Cambiar a español" : "Switch to English"} title={language === "en" ? "Cambiar a español" : "Switch to English"}>
        {language === "en" ? "ES" : "EN"}
      </button>
      <nav aria-label="Main navigation" className="hidden items-center gap-1 lg:flex">
        {renderLinks()}
      </nav>

      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          aria-label="Open account menu"
          aria-expanded={dropdownOpen}
          aria-haspopup="menu"
          onClick={() => setDropdownOpen((open) => !open)}
          className="flex max-w-44 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-600 text-xs font-bold text-white" aria-hidden="true">{userInitial}</span>
          <span className="hidden max-w-28 truncate sm:inline">{user.email}</span>
          <svg className={`h-4 w-4 text-slate-400 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="m6 9 6 6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {dropdownOpen && (
          <div role="menu" className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-slate-200 bg-white py-1 text-slate-800 shadow-xl">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Signed in as</p>
              <p className="mt-1 truncate text-sm font-medium text-slate-900">{user.email}</p>
            </div>
            <Link role="menuitem" href="/profile" onClick={() => setDropdownOpen(false)} className="block px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-50 hover:text-slate-950">
              {translate(language, "Profile & preferences")}
            </Link>
            <button role="menuitem" type="button" onClick={handleSignOut} className="w-full border-t border-slate-100 px-4 py-3 text-left text-sm font-medium text-red-700 transition hover:bg-red-50">
              {translate(language, "Sign out")}
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={mobileMenuOpen}
        aria-controls="mobile-main-navigation"
        onClick={() => setMobileMenuOpen((open) => !open)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 lg:hidden"
      >
        {mobileMenuOpen ? (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" strokeWidth="2" strokeLinecap="round" /></svg>
        ) : (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" strokeWidth="2" strokeLinecap="round" /></svg>
        )}
      </button>

      {mobileMenuOpen && (
        <nav id="mobile-main-navigation" aria-label="Mobile navigation" className="absolute right-0 top-full z-40 mt-3 w-64 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-xl lg:hidden">
          {renderLinks(true)}
        </nav>
      )}
    </div>
  );
}
