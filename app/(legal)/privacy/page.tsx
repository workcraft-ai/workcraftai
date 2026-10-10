import type { Metadata } from "next";
import Link from "next/link";
import { LocalizedTree } from "@/app/components/LanguageProvider";
import LocalizedText from "@/app/components/LocalizedText";

export const metadata: Metadata = {
  title: "Privacy Policy | WorkCraft AI",
  description: "Learn how WorkCraft AI collects, uses, and protects account, customer, and business information.",
  alternates: { canonical: "https://app.workcraftai.com/privacy" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "WorkCraft AI",
    title: "Privacy Policy | WorkCraft AI",
    description: "Learn how WorkCraft AI collects, uses, and protects account, customer, and business information.",
    url: "https://app.workcraftai.com/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <LocalizedTree>
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <Link href="https://workcraftai.com/" className="mb-5 inline-flex min-h-10 items-center text-sm font-semibold text-slate-600 transition hover:text-orange-800">
        <LocalizedText text="← WorkCraft AI home" />
      </Link>
      <article className="space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <header className="space-y-2 border-b border-slate-200 pb-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700"><LocalizedText text="WorkCraft AI · Legal" /></p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900"><LocalizedText text="Privacy Policy" /></h1>
          <p className="text-sm text-slate-600"><LocalizedText text="Last updated: October 2026" /></p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="1. Information We Collect" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="We collect account and business profile details, customer contact information, estimate line items and prices, job addresses, schedules, notes, and approval details that you enter. To enforce account plan allowances, we record per-account estimate, email, AI, and private-media usage counts by UTC day or month. For cloud AI cost controls, we also record the model, prompt length, outcome, provider response status, and provider-reported input/output token totals when available. We do not store your prompt or generated text in this usage log. AI event records older than 90 days and quota summaries older than three months are pruned when the related feature is used; if a feature is idle or paused, those records may remain longer. If you contact support, we send the name, email address, topic, and message you provide to our email provider so our support team can reply. To limit spam, we use a keyed hash of the request IP address to enforce a daily submission limit. Expired hashes are pruned the next time a support request is processed after 30 days. Supabase provides account authentication and data storage. Payment card details are handled by Stripe Checkout and are not stored by WorkCraft AI." />
          </p>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="Estimate and email quota counters are account-linked so limits can be enforced and the remaining allowance shown to you. New private-media upload totals count toward a monthly allowance; separately, current stored bytes and file count are checked against retained-storage limits. Counters are not a copy of your customer content and are pruned during later quota activity as described above. If an email provider request times out and delivery is uncertain, its quota reservation may remain counted." /></p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="2. How We Use Information" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="We use information to create and manage estimates, price books, schedules, invoices, approvals, and reports. If you use cloud estimate drafting, the job description and selected trade are sent to Google Gemini for processing. Local drafting runs in your browser. If you send an estimate, invoice, or follow-up, the customer email address and related proposal or invoice details are sent to our email provider to deliver the message. When an invoice email is accepted by the provider, its sent status is saved on the job. Support requests are sent to our support inbox through Resend; WorkCraft AI does not store their message contents in its app database." />
          </p>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="Customer payments use Stripe Checkout as direct charges on a contractor’s connected Stripe account. Stripe hosts contractor onboarding and the connected account Dashboard; new connections use the Full Stripe Dashboard, while an existing connection may retain its previous Dashboard access. Contractors sign in to Stripe with their own credentials to manage payment activity and payout information. WorkCraft AI stores the connected account ID, payment amount and currency, Stripe transaction IDs, and payment or refund status for the contractor’s records. Stripe collects customer payment details and contractor identity, business, and payout information directly; WorkCraft AI does not store card or bank-account details or receive or hold customer funds. Stripe processes payments and manages eligible connected-account risk under its separate terms." />
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="3. Backups and Retention" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="When disaster-recovery backups are enabled, we create daily encrypted database backups and weekly backups that also include private estimate photos and voice notes. Backups are encrypted before they are uploaded to a restricted Google Drive folder and are retained for up to 30 days. Because backups are not used for normal app operation, deleted account data may remain in encrypted backups until those snapshots expire." />
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="4. Estimate Email Tracking" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="WorkCraft AI records when an estimate email is accepted by Resend, delivery status events such as delivered, delayed, bounced, or reported as spam, and when its proposal link is first viewed. This supports your estimate activity history and scheduled follow-ups." />
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="5. Data Deletion" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="You may request full deletion of your account and associated data at any time through your account settings or by contacting support." />
          </p>
        </section>
      </article>
    </div>
    </LocalizedTree>
  );
}
