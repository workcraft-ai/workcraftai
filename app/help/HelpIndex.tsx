"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/app/components/LanguageProvider";
import { createClient } from "@/app/utils/supabase/client";
import { helpGuides } from "./guides";

export default function HelpIndex() {
  const { language } = useLanguage();
  const locale = language === "es" ? "es" : "en";
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.user));
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setSignedIn(Boolean(session?.user));
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  return <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
    <Link href={signedIn ? "/dashboard" : "/support"} className="inline-flex min-h-11 items-center text-sm font-semibold text-orange-800 underline">{signedIn
      ? (locale === "es" ? "← Volver al Panel" : "← Back to Dashboard")
      : (locale === "es" ? "← Volver al centro de soporte" : "← Back to support center")}</Link>
    <p className="mt-6 text-xs font-bold uppercase tracking-[0.15em] text-orange-800">{locale === "es" ? "Centro de ayuda" : "Help center"}</p>
    <h1 className="mt-2 text-3xl font-extrabold text-slate-900 sm:text-4xl">{locale === "es" ? "Respuestas para seguir trabajando" : "Quick answers for the workday"}</h1>
    <p className="mt-3 max-w-2xl text-base text-slate-600">{locale === "es" ? "Guías breves que puedes seguir desde tu teléfono. Elige la tarea que necesitas hacer." : "Short guides you can follow from your phone. Pick the task you need to do."}</p>
    <ul className="mt-8 grid gap-3 sm:grid-cols-2">{helpGuides.map((guide) => <li key={guide.slug}>
      <Link href={`/help/${guide.slug}`} className="block min-h-28 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-orange-300 hover:shadow-md">
        <h2 className="text-base font-bold text-slate-900">{guide.title[locale]}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{guide.summary[locale]}</p>
        <span className="mt-3 inline-block text-sm font-semibold text-orange-800">{locale === "es" ? "Ver pasos →" : "View steps →"}</span>
      </Link>
    </li>)}</ul>
    <p className="mt-8 text-sm text-slate-700">{locale === "es" ? "¿Aún necesitas ayuda?" : "Still need a hand?"} <Link href="/support#contact-support" className="font-semibold text-orange-800 underline">{locale === "es" ? "Escribe a soporte" : "Contact support"}</Link>.</p>
  </main>;
}
