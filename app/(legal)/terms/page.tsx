import type { Metadata } from "next";
import Link from "next/link";
import { LocalizedTree } from "@/app/components/LanguageProvider";

export const metadata: Metadata = {
  title: "Terms of Service | WorkCraft AI",
  description: "Review the WorkCraft AI terms for using the contractor estimates and job management service.",
  alternates: { canonical: "https://app.workcraftai.com/terms" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "WorkCraft AI",
    title: "Terms of Service | WorkCraft AI",
    description: "Review the WorkCraft AI terms for using the contractor estimates and job management service.",
    url: "https://app.workcraftai.com/terms",
  },
};

export default function TermsPage() {
  return (
    <LocalizedTree>
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <Link href="https://workcraftai.com/" className="mb-5 inline-flex min-h-10 items-center text-sm font-semibold text-slate-600 transition hover:text-orange-800">
        ← WorkCraft AI home
      </Link>
      <article className="space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <header className="space-y-2 border-b border-slate-200 pb-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">WorkCraft AI · Legal</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Terms of Service</h1>
          <p className="text-sm text-slate-600">Last updated: September 2026</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">1. Account Terms</h2>
          <p className="text-sm leading-7 text-slate-700">
            You are responsible for maintaining the security of your account and password. We cannot and will not be liable for any loss or damage from your failure to comply with this security obligation.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">2. Estimates and AI Drafts</h2>
          <p className="text-sm leading-7 text-slate-700">
            Estimates and AI-generated line items are drafts to help prepare a quote. You are responsible for checking the scope, measurements, rates, taxes, and terms before sharing an estimate with a customer. WorkCraft AI does not guarantee that suggested quantities or prices are accurate for a specific job or location.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">3. Paid Plans and Payments</h2>
          <p className="text-sm leading-7 text-slate-700">
            Some features require an active paid plan. Plan charges are processed through Stripe. If you enable customer payments, your customer pays your connected Stripe account directly through Stripe Checkout. You are responsible for your services, prices, taxes, payment terms, customer support, refunds, and disputes. WorkCraft AI does not hold or transfer your customer funds. Stripe may require identity, business, and payout verification before you can accept payments.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">4. Acceptable Use</h2>
          <p className="text-sm leading-7 text-slate-700">
            You may not use the service for any illegal or unauthorized purpose, nor violate any laws in your jurisdiction. You are responsible for having permission to use the customer information you add to WorkCraft AI.
          </p>
        </section>
      </article>
    </div>
    </LocalizedTree>
  );
}
