import type { Metadata } from "next";
import Link from "next/link";
import { emailAddressFromConfig } from "@/lib/email-address";
import SupportForm from "./SupportForm";
import SupportFaq from "./SupportFaq";
import LocalizedText from "@/app/components/LocalizedText";
import { LocalizedTree } from "@/app/components/LanguageProvider";

export const metadata: Metadata = {
  title: "WorkCraft AI Support | Help and FAQs",
  description: "Find answers about WorkCraft AI estimates, proposals, billing, and accounts, or contact our support team.",
  alternates: { canonical: "https://app.workcraftai.com/support" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "WorkCraft AI",
    title: "WorkCraft AI Support | Help and FAQs",
    description: "Find answers about WorkCraft AI estimates, proposals, billing, and accounts, or contact our support team.",
    url: "https://app.workcraftai.com/support",
  },
};

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ form?: string | string[] }>;
}) {
  const params = await searchParams;
  const formResult = Array.isArray(params.form) ? params.form[0] : params.form;
  const supportEmail = emailAddressFromConfig(process.env.NEXT_PUBLIC_SUPPORT_EMAIL) || "support@workcraftai.com";

  return (
    <LocalizedTree>
    <div className="min-h-full bg-[linear-gradient(180deg,#f1eee5_0%,#fffdf8_420px)]">
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-12 sm:px-6 sm:pt-16 lg:px-8">
        <Link href="https://workcraftai.com/" className="text-sm font-semibold text-slate-600 transition hover:text-orange-800">← WorkCraft AI home</Link>
        <div className="mt-10 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-800">We’re here to help</p>
          <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-slate-950 sm:text-5xl">WorkCraft AI Support</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">Start with the answers below. If you still need a hand, send our team a message and we’ll follow up by email.</p>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1.05fr_.95fr] lg:items-start">
          <section aria-labelledby="faq-heading">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500"><LocalizedText text="Quick answers" /></p>
                <h2 id="faq-heading" className="mt-1 text-2xl font-bold tracking-tight text-slate-900"><LocalizedText text="Frequently asked questions" /></h2>
              </div>
              <span className="hidden rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 shadow-sm sm:inline">WorkCraft AI</span>
            </div>
            <SupportFaq />
          </section>

          <section id="contact-support" aria-labelledby="contact-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-800"><LocalizedText text="Still need help?" /></p>
            <h2 id="contact-heading" className="mt-2 text-2xl font-bold tracking-tight text-slate-900"><LocalizedText text="Send us a message" /></h2>
            <p className="mt-2 mb-6 text-sm leading-6 text-slate-600"><LocalizedText text="Share a few details and our support team will reply to the email address you provide." /></p>
            <SupportForm fallbackResult={formResult === "sent" || formResult === "error" ? formResult : undefined} />
            <p className="mt-6 border-t border-slate-100 pt-5 text-sm text-slate-600">Prefer email? <a href={`mailto:${supportEmail}`} className="font-semibold text-orange-800 underline underline-offset-2">{supportEmail}</a></p>
          </section>
        </div>
      </section>
    </div>
    </LocalizedTree>
  );
}
