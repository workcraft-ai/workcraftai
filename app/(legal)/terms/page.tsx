import type { Metadata } from "next";
import Link from "next/link";
import { LocalizedTree } from "@/app/components/LanguageProvider";
import LocalizedText from "@/app/components/LocalizedText";

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
        <LocalizedText text="← WorkCraft AI home" />
      </Link>
      <article className="space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <header className="space-y-2 border-b border-slate-200 pb-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700"><LocalizedText text="WorkCraft AI · Legal" /></p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900"><LocalizedText text="Terms of Service" /></h1>
          <p className="text-sm text-slate-600"><LocalizedText text="Last updated: October 2026" /></p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="1. Account Terms" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="You are responsible for maintaining the security of your account and password. We cannot and will not be liable for any loss or damage from your failure to comply with this security obligation." />
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="2. Estimates and AI Drafts" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="Estimates and AI-generated line items are drafts to help prepare a quote. You are responsible for checking the scope, measurements, rates, taxes, and terms before sharing an estimate with a customer. WorkCraft AI does not guarantee that suggested quantities or prices are accurate for a specific job or location." />
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="3. Paid Plans and Payments" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="Your WorkCraft AI Pro subscription renews automatically at the price and billing interval shown at checkout until you cancel it. You can cancel anytime through Manage billing. Cancellation takes effect at the end of your current paid billing period, and your Pro access remains active until then. We do not issue refunds or credits for subscriptions, partial billing periods, or unused time except where required by law. This WorkCraft AI subscription policy is separate from payments your customers make to your business." />
          </p>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="If Stripe reports your subscription as past due, your Pro access moves to the Free plan immediately. Your saved estimates, jobs, and other account data remain in WorkCraft AI; the downgrade does not delete them. To restore Pro, sign in and use Manage billing from your Profile to update your payment method or pay the open invoice. Stripe restores Pro access after it confirms payment. We may send transactional billing notices about failed payments and account access." />
          </p>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="Some features require an active paid plan. Your WorkCraft AI Pro subscription is billed separately from customer payments. If you enable customer payments, customers pay from an accepted proposal through Stripe Checkout as direct charges on your connected Stripe account. Stripe processes the payment, deducts applicable processing fees from your connected account, and pays out according to Stripe’s schedule and terms. WorkCraft AI does not receive or hold customer funds and does not add a per-payment fee. New connected accounts use the Full Stripe Dashboard, which you access using your own Stripe credentials; an existing connection may retain its previously configured Dashboard access. You must complete Stripe’s onboarding and accept its terms. You are responsible for the services you provide, prices, taxes, payment terms, customer communication, and service-related refund or dispute decisions, and must respond to Stripe requests. Stripe manages payment processing and eligible connected-account risk, including eligible unrecoverable negative balances, under its separate terms. Stripe may require identity, business, and payout verification before you can accept payments." />
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="4. Acceptable Use" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="You may not use the service for any illegal or unauthorized purpose, nor violate any laws in your jurisdiction. You are responsible for having permission to use the customer information you add to WorkCraft AI." />
          </p>
        </section>
      </article>
    </div>
    </LocalizedTree>
  );
}
