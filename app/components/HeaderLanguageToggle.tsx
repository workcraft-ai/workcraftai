"use client";

import { useLanguage } from "@/app/components/LanguageProvider";

export default function HeaderLanguageToggle() {
  const { language, setLanguage } = useLanguage();
  const nextLanguage = language === "en" ? "es" : "en";
  const label = language === "en" ? "Cambiar a español" : "Switch to English";

  return (
    <button
      type="button"
      onClick={() => setLanguage(nextLanguage)}
      className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-xs font-bold text-slate-100 transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
      aria-label={label}
      title={label}
    >
      {language === "en" ? "ES" : "EN"}
    </button>
  );
}
