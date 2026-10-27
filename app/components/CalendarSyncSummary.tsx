"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/app/components/LanguageProvider";

type CalendarStatus = "loading" | "active" | "inactive" | "unavailable";

export default function CalendarSyncSummary() {
  const { language } = useLanguage();
  const spanish = language === "es";
  const [status, setStatus] = useState<CalendarStatus>("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/calendar/subscription", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Calendar status unavailable");
        return response.json() as Promise<{ enabled: boolean }>;
      })
      .then((result) => { if (!controller.signal.aborted) setStatus(result.enabled ? "active" : "inactive"); })
      .catch(() => { if (!controller.signal.aborted) setStatus("unavailable"); });
    return () => controller.abort();
  }, []);

  const detail = status === "active"
    ? (spanish ? "Enlace privado activo" : "Private link active")
    : status === "inactive"
      ? (spanish ? "Agrega tus trabajos a Apple o Google Calendar" : "Add jobs to Apple or Google Calendar")
      : status === "unavailable"
        ? (spanish ? "No se pudo verificar el estado del calendario" : "Calendar status unavailable")
        : (spanish ? "Comprobando estado…" : "Checking status…");

  return <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm" aria-label={spanish ? "Suscripción de calendario" : "Calendar subscription"}>
    <div className="min-w-0">
      <h2 className="text-sm font-semibold text-slate-900">{spanish ? "Suscripción de calendario" : "Calendar subscription"}</h2>
      <p role="status" className="mt-0.5 text-sm text-slate-600">{detail}</p>
    </div>
    <Link href="/profile#calendar-subscription" className="inline-flex min-h-12 items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700">
      {status === "inactive" ? (spanish ? "Configurar" : "Set up") : (spanish ? "Administrar en Preferencias" : "Manage in Preferences")}
    </Link>
  </section>;
}
