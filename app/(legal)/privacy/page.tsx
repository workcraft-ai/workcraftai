import { LocalizedTree } from "@/app/components/LanguageProvider";
import LocalizedText from "@/app/components/LocalizedText";

export default function PrivacyPage() {
  return (
    <LocalizedTree>
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <article className="space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <header className="space-y-2 border-b border-slate-200 pb-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">WorkCraft AI · Legal</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Privacy Policy</h1>
          <p className="text-sm text-slate-600">Last updated: October 2026</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">1. Information We Collect</h2>
          <p className="text-sm leading-7 text-slate-700">
            We collect account and business profile details, customer contact information, estimate line items and prices, job addresses, schedules, notes, and approval details that you enter. For cloud AI cost controls, we also record your generation count, model, prompt length, outcome, and provider response status for cost controls, and we delete records older than 90 days the next time a cloud drafting request is processed; if the feature is idle or paused, those records may remain longer. We do not store your prompt or generated text in this usage log. If you contact support, we send the name, email address, topic, and message you provide to our email provider so our support team can reply. To limit spam, we use a keyed hash of the request IP address to enforce a daily submission limit. Expired hashes are pruned the next time a support request is processed after 30 days. Supabase provides account authentication and data storage. Payment card details are handled by Stripe Checkout and are not stored by WorkCraft AI.
          </p>
          <p className="text-sm leading-7 text-slate-700"><LocalizedText text="To manage email sending limits, we record app email counts by UTC day and message category. Estimate-email quota records include the account ID and are pruned when email processing runs after 90 days. If a provider request times out and delivery is uncertain, its quota reservation may remain counted." /></p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">2. How We Use Information</h2>
          <p className="text-sm leading-7 text-slate-700">
            We use information to create and manage estimates, price books, schedules, invoices, approvals, and reports. If you use cloud estimate drafting, the job description and selected trade are sent to Google Gemini for processing. Local drafting runs in your browser. If you send an estimate or enable a follow-up, the customer email address and proposal details are sent to our email provider to deliver the message. Support requests are sent to our support inbox through Resend; WorkCraft AI does not store their message contents in its app database.
          </p>
          <p className="text-sm leading-7 text-slate-700">
            Customer payments are processed directly by Stripe on a contractor’s connected account. WorkCraft AI stores the connected account ID and payment amount, currency, Stripe transaction IDs, and payment/refund status for the contractor’s records; it does not store card or bank-account details or hold customer funds. Contractors provide identity, business, and payout information directly to Stripe.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">3. Backups and Retention</h2>
          <p className="text-sm leading-7 text-slate-700">
            When disaster-recovery backups are enabled, we create daily encrypted database backups and weekly backups that also include private estimate photos and voice notes. Backups are encrypted before they are uploaded to a restricted Google Drive folder and are retained for up to 30 days. Because backups are not used for normal app operation, deleted account data may remain in encrypted backups until those snapshots expire.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">4. Estimate Email Tracking</h2>
          <p className="text-sm leading-7 text-slate-700">
            WorkCraft AI records when an estimate email is accepted by Resend, delivery status events such as delivered, delayed, bounced, or reported as spam, and when its proposal link is first viewed. This supports your estimate activity history and scheduled follow-ups.
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
