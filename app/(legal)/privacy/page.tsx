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
          <p className="text-sm text-slate-600"><LocalizedText text="Last updated: October 18, 2026" /></p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="1. Information We Collect" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="We collect account and business profile details, customer contact information, estimate line items and prices, job addresses, schedules, notes, and approval details that you enter. To enforce account plan allowances, we record per-account estimate, email, AI, and private-media usage counts by UTC day or month. For cloud AI cost controls, we also record the model, prompt length, outcome, provider response status, and provider-reported input/output token totals when available. We do not store your prompt or generated text in this usage log. AI event records older than 90 days and quota summaries older than three months are pruned when the related feature is used; if a feature is idle or paused, those records may remain longer. If you contact support, we send the name, email address, topic, and message you provide to our email provider so our support team can reply. To limit spam, we use a keyed hash of the request IP address to enforce a daily submission limit. Expired hashes are pruned the next time a support request is processed after 30 days. Supabase provides account authentication and data storage. Payment card details are handled by Stripe Checkout and are not stored by WorkCraft AI." />
          </p>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="Estimate and email quota counters are account-linked so limits can be enforced and the remaining allowance shown to you. New private-media upload totals count toward a monthly allowance; separately, current stored bytes and file count are checked against retained-storage limits. Counters are not a copy of your customer content and are pruned during later quota activity as described above. If an email provider request times out and delivery is uncertain, its quota reservation may remain counted." /></p>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="When you use AI drafting, we compare generated lines with your own Price Book. We record whether a match was suggested, chosen, changed, or removed to measure matching quality. These usage records contain counts and item references, not customer or job descriptions, and are removed with the related AI event after the retention period described above. If you twice select the same Price Book item for a generated description, we may save that description as a private alternate name for your account. You can remove learned names from your Price Book. We do not use one contractor's Price Book rates or learned names to price another contractor's work." /></p>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="At signup, we record the version of the Terms you accepted and the server time of acceptance. When a connected-account payment is disputed, Stripe sends the dispute status and payment reference so we can notify the contractor. Card numbers and dispute evidence remain in Stripe, not WorkCraft AI." /></p>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="After a new account is confirmed, we send one welcome email through our email provider. The first-login checklist stores completion and dismissal times; business preferences are saved in your account profile. You can skip the checklist and return later." /></p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="2. How We Use Information" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="We use information to create and manage estimates, price books, schedules, invoices, approvals, and reports. If you use cloud estimate drafting, the job description and selected trade are sent to Google Gemini for processing. An unfinished estimate draft can be saved in your browser on that device. If you send an estimate, invoice, or follow-up, the customer email address and related proposal or invoice details are sent to our email provider to deliver the message. When an invoice email is accepted by the provider, its sent status is saved on the job. Support requests are sent to our support inbox through Resend; WorkCraft AI does not store their message contents in its app database." />
          </p>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="Customer payments use Stripe Checkout as direct charges on a contractor’s connected Stripe account. Stripe hosts contractor onboarding and the connected account Dashboard; new connections use the Full Stripe Dashboard, while an existing connection may retain its previous Dashboard access. Contractors sign in to Stripe with their own credentials to manage payment activity and payout information. WorkCraft AI stores the connected account ID, payment amount and currency, Stripe transaction IDs, and payment or refund status for the contractor’s records. Stripe collects customer payment details and contractor identity, business, and payout information directly; WorkCraft AI does not store card or bank-account details or receive or hold customer funds. Stripe processes payments and manages eligible connected-account risk under its separate terms." />
          </p>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="WorkCraft AI does not sell personal information or disclose app account, contractor, customer, estimate, job, invoice, private-media, or payment-reference information for targeted advertising. We disclose limited information to service providers to host, secure, store, and operate the service and deliver features you choose. These providers include Vercel for hosting, Supabase for authentication and data storage, Resend for email, Stripe for payments, Google Gemini when you request cloud AI drafting, and Google Drive for enabled encrypted backup snapshots. Providers may process information under the terms and privacy notices that apply to their services. Optional Google Analytics on workcraftai.com is a separate, consent-based disclosure of limited public-site visit and signup-link activity described below; it does not receive signed-in account identifiers or estimate and customer content." /></p>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="WorkCraft AI currently sends customer communications by email and does not send automated customer text messages. If a contractor chooses to copy a customer link and send it by text using another service, that message is sent outside WorkCraft AI." /></p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="3. Backups and Retention" /></h2>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="We keep account, customer, estimate, job, invoice, and payment-reference records while the account is active so the service works and contractors can access their history. After 12 months without authenticated app activity, we send a warning and allow 30 days to sign in before scheduling account deletion. Signing in during that period cancels the pending deletion. Some minimal admin audit records may remain after deletion; payment providers may retain their own transaction and compliance records under their policies." /></p>
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
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="5. Optional Public Website Analytics" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="If you allow analytics on workcraftai.com, Google Analytics measures public page visits and clicks on signup links. The public website does not send account IDs, customer details, estimate contents, or URL query strings to Google Analytics. Google may set analytics cookies and receive browser and device information under its own privacy policy. The analytics tag does not load if you decline. You can change your choice anytime using Analytics choices in the public website footer. We do not use this tag inside the signed-in app or customer proposal pages." />
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="6. Data Deletion" /></h2>
          <p className="text-sm leading-7 text-slate-700">
            <LocalizedText text="You can request deletion of your WorkCraft AI account and associated app data through account settings or by emailing support@workcraftai.com. Deletion removes app records and private estimate media, but cannot erase copies already held by payment or email providers under their own retention rules. Encrypted backup copies expire under the backup schedule above, and minimal admin audit records may remain. A contractor's separate Stripe account is not deleted by deleting a WorkCraft AI account." />
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900"><LocalizedText text="7. Privacy Contact" /></h2>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="For questions about this Privacy Policy or requests about your information, email support@workcraftai.com. Please do not email passwords, payment-card details, or other sensitive authentication information." /></p>
        </section>
      </article>
    </div>
    </LocalizedTree>
  );
}
