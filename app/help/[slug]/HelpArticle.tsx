"use client";

import Link from "next/link";
import { useLanguage } from "@/app/components/LanguageProvider";
import type { HelpGuide } from "../guides";

export default function HelpArticle({ guide }: { guide: HelpGuide }) {
  const { language } = useLanguage();
  const locale = language === "es" ? "es" : "en";
  return <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
    <Link href="/help" className="inline-flex min-h-11 items-center text-sm font-semibold text-orange-800 underline">{locale === "es" ? "← Todas las guías" : "← All guides"}</Link>
    <p className="mt-6 text-xs font-bold uppercase tracking-[0.15em] text-orange-800">{locale === "es" ? "Guía paso a paso" : "Step-by-step guide"}</p>
    <h1 className="mt-2 text-3xl font-extrabold text-slate-900 sm:text-4xl">{guide.title[locale]}</h1>
    <p className="mt-3 text-base leading-7 text-slate-600">{guide.summary[locale]}</p>
    <ol className="mt-8 space-y-3">{guide.steps[locale].map((step, index) => <li key={index} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-100 text-sm font-bold text-orange-900">{index + 1}</span><p className="self-center text-sm leading-6 text-slate-800">{step}</p></li>)}</ol>
    <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">{guide.note[locale]}</p>
    <Link href={guide.action.href} className="mt-6 inline-flex min-h-12 items-center rounded-lg bg-orange-800 px-5 text-sm font-semibold text-white hover:bg-orange-900">{guide.action[locale]}</Link>
    <p className="mt-8 border-t border-slate-200 pt-6 text-sm text-slate-600">{locale === "es" ? "¿No se resolvió?" : "Still stuck?"} <Link href="/support#contact-support" className="font-semibold text-orange-800 underline">{locale === "es" ? "Escribe a soporte" : "Contact support"}</Link>.</p>
  </article>;
}
