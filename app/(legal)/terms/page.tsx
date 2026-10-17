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
          <p className="text-sm text-slate-600"><LocalizedText text="Last updated: October 13, 2026" /></p>
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
            <LocalizedText text="Eligible new accounts may start one 14-day WorkCraft AI Pro trial without a payment method. The trial ends automatically and access returns to Free if you do not add billing details. If you add a payment method through Manage billing before the trial ends, Pro continues at $9.99 per month after the trial unless you cancel before then. Your saved data remains available if the trial ends. A paid WorkCraft AI Pro subscription renews automatically at the price and billing interval shown at checkout until you cancel it. You can cancel anytime through Manage billing. Cancellation takes effect at the end of your current paid billing period, and your Pro access remains active until then. We do not issue refunds or credits for subscriptions, partial billing periods, or unused time except where required by law. This WorkCraft AI subscription policy is separate from payments your customers make to your business." />
          </p>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="If Stripe reports your subscription as past due, your Pro access moves to the Free plan immediately. Your saved estimates, jobs, and other account data remain in WorkCraft AI; the downgrade does not delete them. To restore Pro, sign in and use Manage billing from your Profile to update your payment method or pay the open invoice. Stripe restores Pro access after it confirms payment. We may send transactional billing notices about failed payments and account access." />
          </p>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="Some features require an active paid plan. Your WorkCraft AI Pro subscription is billed separately from customer payments. If you enable customer payments, customers must accept an estimate before paying online. Stripe Checkout offers the payment options available for that accepted estimate, and the amount is calculated from the accepted estimate and payments already recorded against it. If invoice sharing is enabled, an invoice email includes the estimate link; changing an invoice amount separately does not create a separate Stripe checkout amount. These are direct charges on your connected Stripe account. Stripe processes the payment, deducts applicable processing fees from your connected account, and pays out according to Stripe’s schedule and terms. WorkCraft AI does not receive or hold customer funds and does not add a per-payment fee. New connected accounts use the Full Stripe Dashboard, which you access using your own Stripe credentials; an existing connection may retain its previously configured Dashboard access. You must complete Stripe’s onboarding and accept its terms. You are responsible for the services you provide, prices, taxes, payment terms, customer communication, and service-related refund or dispute decisions, and must respond to Stripe requests. Stripe manages payment processing and eligible connected-account risk, including eligible unrecoverable negative balances, under its separate terms. Stripe may require identity, business, and payout verification before you can accept payments." />
          </p>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="Plan allowances apply per account and use UTC calendar periods. Free accounts can save up to 10 estimates per day and 50 per month; Pro accounts can save up to 50 per day and 500 per month and use cloud AI and private media. The Free estimate-email allowance and the trial/Pro customer-email allowance may be changed by WorkCraft AI. Trial and paid Pro share one email allowance for estimates, follow-ups, question alerts, and invoices. Free email allowance, when available, applies to estimate emails. Unused allowances do not roll over. Shared provider capacity can pause an action sooner. Your current limits, usage, and remaining amounts are shown in Profile. Existing account data is not deleted when a limit is reached or a plan changes." /></p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="4. Acceptable Use" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="You may not use the service for any illegal or unauthorized purpose, nor violate any laws in your jurisdiction. You are responsible for having permission to use the customer information you add to WorkCraft AI." />
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="5. Contractor Services and Customer Payments" /></h2>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="WorkCraft AI provides software for contractors to prepare estimates and manage work. We are not the contractor, customer, seller, or a party to any agreement for construction or other services. Contractors alone set the scope, schedule, prices, taxes, cancellation and refund terms, and warranties for their work. Contractors are responsible for initiating any customer refunds and responding to Stripe requests for payment-dispute information. Customers should resolve service and refund questions with the contractor and payment disputes with the contractor and Stripe or their payment provider. WorkCraft AI does not guarantee a contractor's work or decide service disputes. Customer acceptance in WorkCraft AI records a response to an estimate; contractors remain responsible for any signatures, notices, or written agreements required for their work." /></p>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="The sales-tax rate in an estimate is entered by the contractor. WorkCraft AI calculates from that rate but does not determine whether a service, labor, material, or location is taxable and does not automatically calculate or remit tax through Stripe Tax. Contractors must verify tax treatment and fulfill any collection and filing obligations. Customer card details are entered on Stripe-hosted Checkout, not in WorkCraft AI. WorkCraft AI does not currently send automated customer text messages. If you share a customer link using your own text-message or email service, you are responsible for required consent and compliance with applicable communications laws." /></p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="6. Service Availability and Liability" /></h2>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="We provide WorkCraft AI on an as-available basis. To the extent permitted by law, we disclaim implied warranties, including fitness for a particular purpose, and are not liable for indirect, incidental, special, or consequential losses, including lost profits or lost business. To the extent permitted by law, our total liability arising from WorkCraft AI is limited to the greater of $100 or the amount you paid us for the service in the 12 months before the claim. These limits do not apply where the law prohibits them, including liability that cannot be excluded for fraud or intentional misconduct." /></p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="7. Contact and Legal Notices" /></h2>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="WorkCraft AI is the name of the software service covered by these Terms. For account support, billing questions, privacy requests, or legal notices, contact WorkCraft AI at support@workcraftai.com." /></p>
        </section>
      </article>
    </div>
    </LocalizedTree>
  );
}
