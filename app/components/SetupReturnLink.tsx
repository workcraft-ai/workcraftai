"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/app/components/LanguageProvider";

type Step = "estimate" | "proposal" | "pricebook";

const copy = {
  en: {
    title: "First 5 Minutes setup",
    estimate: "Save this estimate to complete the step, then return to your checklist.",
    proposal: "After reviewing the customer view, return to your checklist to copy a test link.",
    pricebook: "After saving a rate, return to your checklist to finish setup.",
    action: "Back to setup checklist",
  },
  es: {
    title: "Configuración de los primeros 5 minutos",
    estimate: "Guarda esta cotización para completar el paso y vuelve a la lista.",
    proposal: "Después de revisar la vista del cliente, vuelve a la lista para copiar un enlace de prueba.",
    pricebook: "Después de guardar un precio, vuelve a la lista para terminar la configuración.",
    action: "Volver a la lista de configuración",
  },
};

export default function SetupReturnLink({ step }: { step: Step }) {
  const { language } = useLanguage();
  const [fromSetup, setFromSetup] = useState(false);
  useEffect(() => {
    const task = window.setTimeout(() => setFromSetup(new URLSearchParams(window.location.search).get("setup") === "1"), 0);
    return () => window.clearTimeout(task);
  }, []);
  if (!fromSetup) return null;
  const t = copy[language === "es" ? "es" : "en"];
  return <aside className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-950">
    <div><p className="font-bold">{t.title}</p><p className="mt-1">{t[step]}</p></div>
    <Link href="/dashboard#first-five-minutes" className="inline-flex min-h-11 items-center rounded-lg bg-orange-800 px-4 font-semibold text-white hover:bg-orange-900">{t.action}</Link>
  </aside>;
}
