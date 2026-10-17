"use client";

import Link from "next/link";
import { translate, useLanguage } from "@/app/components/LanguageProvider";

const questions = [
  {
    question: "How do I create an estimate?",
    answer: "Sign in and choose New estimate. Add the customer and job details, review the line items and totals, then save. You can find saved estimates on your dashboard.",
  },
  {
    question: "How much detail can I show on a proposal?",
    answer: "Choose detailed line items or a summary with the total only. In summary mode, the customer sees your work summary and final total; the detailed line items stay in your account.",
  },
  {
    question: "Are AI suggested prices guaranteed?",
    answer: "No. They are broad starting estimates, not live local supplier quotes. Exact or high-confidence Price Book matches can apply automatically; possible matches are shown for you to choose. Review the unit, quantity, labor, material, taxes, and final rate before sharing the estimate.",
  },
  {
    question: "Where can I find my estimate reference number?",
    answer: "Each saved estimate has a readable reference such as WC-2026-0001. You can see it in your estimate list, on the proposal, and in estimate emails. The full ID in a share link remains in place for secure access.",
  },
  {
    question: "How many estimates can I create on the free plan?",
    answer: "Free accounts can save up to 10 new estimates per UTC calendar day and 50 per UTC calendar month. Both counters reset by UTC. Editing an estimate, saving a browser-only draft, or a failed save does not use a slot. Existing estimates remain available.",
  },
  {
    question: "What are the Pro usage limits?",
    answer: "Pro ($9.99/month) includes estimates, cloud AI drafts, customer emails, and private media. Trial and paid Pro share the same email allowance; Free accounts may receive an estimate-email allowance. Email limits can change. Open Profile to see your current daily and monthly limits and what remains. Counters reset at 00:00 UTC or the start of each UTC month. Shared provider capacity may pause an action sooner.",
  },
  {
    question: "How does the free Pro trial work?",
    answer: "Eligible WorkCraft AI accounts can start one 14-day Pro trial from Profile → Your plan or from a trial offer shown on the Dashboard, Customers, Price Book, or a Pro feature. No payment method is required to start. Once the trial is active, these offers change to Upgrade to Pro; paid Pro accounts no longer see them. The trial ends automatically and the account returns to Free if you do not add billing details. To keep Pro, add a payment method in Manage billing before the trial ends; the subscription then costs $9.99/month. Saved estimates and other account data remain if the trial ends.",
  },
  {
    question: "Can my customer review a proposal without an account?",
    answer: "Yes. Share the proposal link from the estimate. Your customer can review the proposal and respond through its customer-facing page without signing in to WorkCraft AI.",
  },
  {
    question: "How do customer payments work in WorkCraft AI?",
    answer: "Online payments are a Pro feature. After Stripe verifies and activates your connected account, a customer can pay a deposit or balance from an accepted proposal using Stripe Checkout. The payment is processed directly on your Stripe account; WorkCraft AI does not receive or hold the funds.",
  },
  {
    question: "Do I need to set up Stripe to accept payments?",
    answer: "Yes. Open Profile and choose Connect Stripe. Stripe hosts the guided onboarding and collects your identity, business, and payout information. New connections use the Full Stripe Dashboard, which you access with your own Stripe credentials at dashboard.stripe.com. An existing connection may keep its previous Dashboard access method.",
  },
  {
    question: "Where do I manage payouts, refunds, and disputes?",
    answer: "Use your Stripe Dashboard to review payments and payouts, update payout details, and respond to refund or dispute matters. WorkCraft AI emails the account owner when Stripe reports a dispute on a payment recorded in the app; check Stripe directly for deadlines and evidence requirements. You remain responsible for your services, customer communication, and decisions about resolving service issues. Stripe manages payment processing and eligible connected-account risk under its terms.",
  },
  {
    question: "Does WorkCraft AI calculate sales tax automatically?",
    answer: "No. You enter the sales-tax percentage on an estimate, and WorkCraft AI calculates from that rate. It does not decide what is taxable, use Stripe Tax, or file taxes. Check local rules with a qualified tax professional before sharing a quote.",
  },
  {
    question: "What fees apply to customer payments?",
    answer: "Stripe applies its payment-processing fees to your connected account under Stripe’s pricing and agreement. WorkCraft AI does not add a per-payment fee. The WorkCraft AI Pro subscription is billed separately; check Stripe for the current rates that apply to your account and payment methods.",
  },
  {
    question: "Does my customer need a WorkCraft AI or Stripe account?",
    answer: "Customers do not need a WorkCraft AI account. They can open the proposal link, approve it, and pay through Stripe Checkout. Stripe collects their payment details; WorkCraft AI does not store card or bank-account numbers.",
  },
  {
    question: "Where can I find jobs, invoices, and reports?",
    answer: "Use Schedule & jobs to manage jobs and open an invoice from a job. Reports and your estimates are available from the app navigation.",
  },
  {
    question: "I can’t sign in. What should I do?",
    answer: "Use the password reset page to request a reset email. If you no longer have access to your account email or the reset email does not arrive, send us a message below.",
  },
  {
    question: "How do I manage my plan or billing?",
    answer: "Sign in and open your account menu to view your profile and plan options. If a charge or subscription change doesn’t look right, choose Billing in the contact form and include the email address on your WorkCraft AI account. Never send full payment card details.",
  },
  {
    question: "What happens if my Pro subscription payment is past due?",
    answer: "If a Pro payment fails, you keep Pro access for three business days from the first recorded failure, excluding weekends and measured in Eastern time. Stripe may retry the payment during or after this period. If it remains unpaid when the grace period ends, your account moves to Free but your saved data remains available. Open Profile → Manage billing to update your payment method or pay the open invoice. Pro returns after Stripe confirms payment. Stripe may email you about failed payments or an expiring card.",
  },
  {
    question: "Does WorkCraft AI send estimates or customer emails?",
    answer: "You can send estimate, proposal, and invoice emails from the app where the feature is available. If a message does not arrive, check the recipient address and spam folder, then contact us with the estimate number and the approximate time you sent it.",
  },
  {
    question: "What should I include in a support request?",
    answer: "Tell us the email on your account, what you were trying to do, what happened, and any on-screen error. Please leave out passwords, payment card details, and sensitive customer information.",
  },
];

export default function SupportFaq() {
  const { language } = useLanguage();
  const localize = (text: string) => translate(language, text);

  return (
    <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {questions.map(({ question, answer }) => (
        <details key={question} className="group px-5 py-4 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-sm font-bold text-slate-900 marker:hidden [&::-webkit-details-marker]:hidden">
            {localize(question)}
            <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-lg leading-none text-slate-600 transition group-open:rotate-45">+</span>
          </summary>
          <p className="mt-3 pr-8 text-sm leading-6 text-slate-600">
            {question === "How do I create an estimate?" ? (
              <>
                {localize("Sign in and choose")} {" "}
                <Link href="/estimate/new" className="font-semibold text-orange-800 underline underline-offset-2">{localize("New estimate")}</Link>
                {localize(". Add the customer and job details, review the line items and totals, then save. You can find saved estimates on your dashboard.")}
              </>
            ) : question === "I can’t sign in. What should I do?" ? (
              <>
                {localize("Use the")} {" "}
                <Link href="/forgot-password" className="font-semibold text-orange-800 underline underline-offset-2">{localize("password reset page")}</Link>
                {" "}{localize("to request a reset email. If you no longer have access to your account email or the reset email does not arrive, send us a message below.")}
              </>
            ) : localize(answer)}
          </p>
        </details>
      ))}
    </div>
  );
}
