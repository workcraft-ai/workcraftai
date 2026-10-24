import type { Metadata, Viewport } from "next";
import React from "react";
import HeaderNav from "@/app/components/HeaderNav";
import HeaderLanguageToggle from "@/app/components/HeaderLanguageToggle";
import Footer from "@/app/components/Footer";
import Logo from "@/app/components/Logo";
import AccountActivityTracker from "@/app/components/AccountActivityTracker";
import { LanguageProvider } from "@/app/components/LanguageProvider";
import { ProPlanBanner, ProPlanProvider } from "@/app/components/ProPlanExperience";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.workcraftai.com"),
  title: "WorkCraft AI — Keep good work moving",
  applicationName: "WorkCraft AI",
  description: "For the people who get the work done. WorkCraft AI helps independent trade and service businesses prepare estimates, share proposals, and manage jobs and invoices.",
  // The app is a customer workspace. Public help and legal pages opt back in
  // individually; customer records, account flows, and tools stay out of search.
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: "WorkCraft AI",
    title: "WorkCraft AI — Keep good work moving",
    description: "For the people who get the work done. Keep good work moving.",
    url: "https://app.workcraftai.com",
  },
  icons: { icon: "/workcraftai-mark.svg", apple: "/apple-icon.png" },
  appleWebApp: { capable: true, title: "WorkCraft AI", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1c2b25",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return React.createElement(
    "html",
    { lang: "en" },
    React.createElement(
      "body",
      {
        className: "bg-slate-50 min-h-screen flex flex-col font-sans text-slate-900 antialiased",
        style: { overflowX: "hidden", overflowY: "auto" },
        suppressHydrationWarning: true,
      },
      React.createElement(
      LanguageProvider,
      null,
      React.createElement(
      ProPlanProvider,
      null,
      React.createElement(AccountActivityTracker, null),
      React.createElement(
          "header",
          { className: "print:hidden relative z-20 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-3 border-b border-slate-800 bg-slate-900 px-4 py-3.5 text-white shadow-sm md:px-8 lg:flex lg:flex-wrap lg:gap-x-3" },
          React.createElement(
            "div",
            { className: "col-span-2 flex items-center lg:col-auto" },
            React.createElement(Logo, null)
          ),
          React.createElement(HeaderLanguageToggle, null),
          React.createElement(HeaderNav, null)
        ),
        React.createElement(ProPlanBanner, null),
        React.createElement("main", { className: "flex-1" }, children),
        React.createElement(Footer, null)
      )
      )
    )
  );
}
