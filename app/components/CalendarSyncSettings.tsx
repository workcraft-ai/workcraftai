"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/app/components/LanguageProvider";
import type { CalendarFeedPreferences } from "@/lib/job-calendar-feed";

type CalendarSettings = {
  enabled: boolean;
  url: string | null;
  preferences: CalendarFeedPreferences;
};

const defaultPreferences: CalendarFeedPreferences = {
  include_estimate_jobs: true,
  include_standalone_jobs: true,
  include_completed_jobs: false,
  show_customer_name: false,
};

export default function CalendarSyncSettings() {
  const { language } = useLanguage();
  const spanish = language === "es";
  const [settings, setSettings] = useState<CalendarSettings | null>(null);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (window.location.hash !== "#calendar-subscription") return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("calendar-subscription")?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let active = true;
    // A language change only changes labels; it must not overwrite edits the
    // contractor has made to checkboxes before pressing Save.
    fetch("/api/calendar/subscription", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("load");
        return response.json() as Promise<CalendarSettings>;
      })
      .then((result) => {
        if (!active) return;
        setSettings(result);
        setPreferences(result.preferences);
      })
      .catch(() => { if (active) setError("load"); });
    return () => { active = false; };
  }, [reloadKey]);

  async function changeSettings(method: "POST" | "PUT" | "DELETE") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/calendar/subscription", {
        method,
        headers: method === "PUT" ? { "Content-Type": "application/json" } : undefined,
        body: method === "PUT" ? JSON.stringify(preferences) : undefined,
      });
      const result = await response.json() as CalendarSettings & { error?: string };
      if (!response.ok) throw new Error(result.error || "Calendar sync could not be updated.");
      setSettings(result);
      setPreferences(result.preferences);
      setMessage(method === "DELETE"
        ? (spanish ? "La sincronización del calendario está desactivada." : "Calendar sync is off.")
        : method === "PUT"
          ? (spanish ? "Opciones del calendario guardadas." : "Calendar options saved.")
          : (spanish ? "Enlace del calendario listo. Copia y guarda este enlace privado." : "Calendar link ready. Copy and save this private link."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Calendar sync could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!settings?.url) return;
    try {
      await navigator.clipboard.writeText(settings.url);
      setMessage(spanish ? "Enlace copiado." : "Link copied.");
    } catch {
      setError(spanish ? "No se pudo copiar. Selecciona y copia el enlace." : "Could not copy automatically. Select and copy the link.");
    }
  }

  const labels: { key: keyof CalendarFeedPreferences; en: string; es: string; helpEn: string; helpEs: string }[] = [
    { key: "include_estimate_jobs", en: "Jobs created from estimates", es: "Trabajos creados desde cotizaciones", helpEn: "Include approved estimates you scheduled as jobs.", helpEs: "Incluye cotizaciones aprobadas que programaste como trabajos." },
    { key: "include_standalone_jobs", en: "Jobs created directly", es: "Trabajos creados directamente", helpEn: "Include jobs entered on this schedule without an estimate.", helpEs: "Incluye trabajos ingresados aquí sin una cotización." },
    { key: "include_completed_jobs", en: "Completed jobs", es: "Trabajos completados", helpEn: "Keep completed jobs visible on their original dates.", helpEs: "Muestra los trabajos completados en sus fechas originales." },
    { key: "show_customer_name", en: "Show customer name", es: "Mostrar nombre del cliente", helpEn: "When off, calendar titles say only “WorkCraft AI job.” Job notes and customer emails are never included.", helpEs: "Si está apagado, el título solo dice «Trabajo de WorkCraft AI». Nunca se incluyen notas ni correos del cliente." },
  ];

  return <section id="calendar-subscription" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6" aria-labelledby="calendar-sync-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="calendar-sync-heading" className="text-lg font-semibold text-slate-900">{spanish ? "Sincronizar calendario" : "Calendar sync"}</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{spanish
          ? "Muestra tus trabajos en Apple Calendar, Google Calendar u otra aplicación compatible. Los cambios se hacen en WorkCraft AI; la aplicación de calendario decide cuándo actualizarse."
          : "See your jobs in Apple Calendar, Google Calendar, or another calendar app. Make changes in WorkCraft AI; your calendar app decides when to refresh."}</p>
      </div>
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{spanish ? "Solo lectura" : "One-way, read-only"}</span>
    </div>

    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error === "load" ? (spanish ? "No se pudo cargar la conexión del calendario." : "Could not load calendar sync.") : error}</p>}
    {message && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}

    {!settings ? error === "load" ? <button type="button" onClick={() => { setError(""); setReloadKey((value) => value + 1); }} className="mt-5 min-h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800">{spanish ? "Reintentar" : "Try again"}</button> : <p className="mt-5 text-sm text-slate-500">{spanish ? "Cargando opciones…" : "Loading options…"}</p> : <>
      {!settings.enabled ? <button type="button" disabled={busy} onClick={() => void changeSettings("POST")}
        className="mt-5 min-h-12 rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-60">
        {spanish ? "Crear enlace de calendario" : "Create calendar link"}
      </button> : <>
        <div className="mt-5 space-y-2">
          <label htmlFor="calendar-feed-url" className="block text-sm font-semibold text-slate-800">{spanish ? "Enlace privado de suscripción" : "Private subscription link"}</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="calendar-feed-url" value={settings.url ?? ""} readOnly onFocus={(event) => event.currentTarget.select()}
              className="min-h-12 min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-800" />
            <button type="button" onClick={() => void copyLink()} className="min-h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">{spanish ? "Copiar enlace" : "Copy link"}</button>
          </div>
          <p className="text-xs text-slate-600">{spanish ? "Cualquiera que tenga este enlace puede ver los horarios y direcciones de los trabajos seleccionados. No lo compartas públicamente." : "Anyone with this link can see times and addresses for the jobs you select. Keep it private."}</p>
        </div>
        <fieldset className="mt-6 space-y-3">
          <legend className="text-sm font-semibold text-slate-900">{spanish ? "Mostrar en el calendario" : "Include in calendar"}</legend>
          {labels.map(({ key, en, es, helpEn, helpEs }) => <label key={key} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3">
            <input type="checkbox" checked={preferences[key]} onChange={(event) => setPreferences((current) => ({ ...current, [key]: event.target.checked }))}
              className="mt-1 h-5 w-5 accent-orange-700" />
            <span><span className="block text-sm font-semibold text-slate-800">{spanish ? es : en}</span><span className="block text-xs text-slate-600">{spanish ? helpEs : helpEn}</span></span>
          </label>)}
        </fieldset>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy || (!preferences.include_estimate_jobs && !preferences.include_standalone_jobs)} onClick={() => void changeSettings("PUT")}
            className="min-h-12 rounded-lg bg-orange-700 px-4 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-50">{spanish ? "Guardar opciones" : "Save options"}</button>
          <button type="button" disabled={busy} onClick={() => { if (window.confirm(spanish ? "¿Reemplazar el enlace? Tendrás que eliminar la suscripción anterior y agregar el enlace nuevo en tu aplicación de calendario." : "Replace this link? Remove the old subscription and add the new link in your calendar app.")) void changeSettings("POST"); }}
            className="min-h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{spanish ? "Reemplazar enlace" : "Replace link"}</button>
          <button type="button" disabled={busy} onClick={() => { if (window.confirm(spanish ? "¿Desactivar la sincronización? Elimina también la suscripción anterior en tu aplicación de calendario." : "Turn off calendar sync? Also remove the old subscription in your calendar app.")) void changeSettings("DELETE"); }}
            className="min-h-12 rounded-lg border border-red-300 px-4 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50">{spanish ? "Desactivar" : "Turn off"}</button>
        </div>
      </>}
      <div className="mt-6 border-t border-slate-200 pt-5 text-sm text-slate-700">
        <h3 className="font-semibold text-slate-900">{spanish ? "Conectar tu aplicación" : "Add it to your calendar"}</h3>
        <p className="mt-2">{spanish ? "Apple Calendar: Calendarios → Agregar calendario → Agregar calendario de suscripción. Pega el enlace y elige iCloud para verlo en tus dispositivos." : "Apple Calendar: Calendars → Add Calendar → Add Subscription Calendar. Paste the link and choose iCloud to see it across your devices."}</p>
        <p className="mt-2">{spanish ? "Google Calendar: en una computadora, Otros calendarios → + → Desde URL. Pega el enlace. La actualización de Google puede tardar varias horas." : "Google Calendar: on a computer, Other calendars → + → From URL. Paste the link. Google may take hours to refresh changes."}</p>
      </div>
    </>}
  </section>;
}
