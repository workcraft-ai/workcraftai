"use client";

import { useEffect, useState } from "react";

export default function EmailPreferences({ language }: { language: "en" | "es" }) {
  const es = language === "es";
  const [onboardingEnabled, setOnboardingEnabled] = useState(true);
  const [tipsOptedIn, setTipsOptedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/email-preferences", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("load_failed");
        return response.json() as Promise<{ onboardingEnabled: boolean; tipsOptedIn: boolean }>;
      })
      .then((result) => { if (active) { setOnboardingEnabled(result.onboardingEnabled); setTipsOptedIn(result.tipsOptedIn); } })
      .catch(() => { if (active) setError(es ? "No se pudieron cargar las preferencias." : "Email preferences could not load."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [es]);

  const save = async () => {
    setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/email-preferences", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingEnabled, tipsOptedIn }),
      });
      if (!response.ok) throw new Error("save_failed");
      setMessage(es ? "Preferencias de correo guardadas." : "Email preferences saved.");
    } catch { setError(es ? "No se pudieron guardar las preferencias." : "Email preferences could not be saved."); }
    finally { setSaving(false); }
  };

  return <section id="email-preferences" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <h2 className="text-xl font-bold text-slate-950">{es ? "Consejos por correo" : "Product emails"}</h2>
    <p className="mt-2 text-sm text-slate-600">{es ? "Elige los consejos que quieres recibir. Los avisos esenciales sobre tu cuenta, seguridad, pagos y clientes siguen activos." : "Choose which helpful tips to receive. Essential account, security, payment, and customer notices stay on."}</p>
    {loading ? <p className="mt-4 text-sm text-slate-600">{es ? "Cargando…" : "Loading…"}</p> : <div className="mt-4 space-y-4">
      <label className="flex items-start gap-3 text-sm text-slate-800"><input type="checkbox" checked={onboardingEnabled} onChange={(event) => setOnboardingEnabled(event.target.checked)} className="mt-1 h-4 w-4" /><span><strong>{es ? "Ayuda inicial y un recordatorio de regreso" : "Getting-started help and one return reminder"}</strong><br />{es ? "Consejos según los pasos que completes durante tu primer mes." : "Tips based on the steps you complete in your first month."}</span></label>
      <label className="flex items-start gap-3 text-sm text-slate-800"><input type="checkbox" checked={tipsOptedIn} onChange={(event) => setTipsOptedIn(event.target.checked)} className="mt-1 h-4 w-4" /><span><strong>{es ? "Una guía después del primer mes" : "One guide after your first month"}</strong><br />{es ? "Un consejo útil cerca del día 30, solo si sigues usando la aplicación." : "One useful tip around day 30, only while you are active."}</span></label>
      <button type="button" disabled={saving} onClick={() => void save()} className="min-h-11 rounded-lg bg-orange-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? (es ? "Guardando…" : "Saving…") : (es ? "Guardar preferencias" : "Save email preferences")}</button>
    </div>}
    {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
  </section>;
}
