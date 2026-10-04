"use client";

import Link from "next/link";
import { translate, useLanguage } from "@/app/components/LanguageProvider";

const questions = [
  {
    question: "How do I create an estimate?",
    answer: "Sign in and choose New estimate. Add the customer and job details, review the line items and totals, then save. You can find saved estimates on your dashboard.",
  },
  {
    question: "How many estimates can I create on the free plan?",
    answer: "Free accounts can save up to 10 new estimates per UTC calendar day. The counter resets at 00:00 UTC. Editing an estimate, saving a browser-only draft, or a failed save does not use a slot. Existing estimates remain available.",
  },
  {
    question: "Can my customer review a proposal without an account?",
    answer: "Yes. Share the proposal link from the estimate. Your customer can review the proposal and respond through its customer-facing page without signing in to WorkCraft AI.",
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
    question: "Does WorkCraft AI send estimates or customer emails?",
    answer: "You can send estimate and proposal emails from the app where the feature is available. If a message does not arrive, check the recipient address and spam folder, then contact us with the estimate number and the approximate time you sent it.",
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
