"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/app/components/LanguageProvider";

type Progress = {
  eligible: boolean;
  dismissed: boolean;
  profileComplete: boolean;
  estimateId: string | null;
  previewed: boolean;
  shared: boolean;
  priceBookReady: boolean;
  profile: { fullName: string; businessName: string; businessAddress: string; phone: string; logoUrl: string; brandColor: string; taxRate: number; markupPercentage: number };
};
type Action = "bootstrap" | "previewed" | "shared" | "dismiss" | "reopen";

const copy = {
  en: {
    kicker: "First 5 minutes", title: "Let's get your first estimate ready", intro: "Follow these steps at your own pace. You can skip setup and return later.",
    steps: ["Set your business preferences", "Create an estimate", "Preview the customer view", "Copy a test customer link", "Save a reusable rate"],
    name: "Your name (optional)", business: "Business name", address: "Business address (optional)", phone: "Business phone (optional)", tax: "Default sales tax %", markup: "Default markup %", logo: "Public logo URL (optional)", color: "Brand color",
    taxHelp: "Use rates you have verified for your location and work. These defaults can be changed on each estimate.",
    save: "Save preferences", saving: "Saving…", estimate: "Create an estimate", preview: "Preview my estimate", share: "Copy my test link",
    fallback: "Your link is ready. Select and copy it, then confirm below.", copied: "I copied the link", rate: "Add a Price Book rate",
    later: "Skip for now", resume: "Continue first-time setup", help: "Get step-by-step help", error: "We couldn't save that step. Please try again.", finishedTitle: "Your first estimate setup is ready", finishedBody: "You can keep creating estimates and reuse the rate you saved.",
    shareHelp: "Open it yourself first. Copying a link does not email a customer.", done: "Done", optional: "Optional after your first quote: add a logo, AI, or Stripe payments.",
  },
  es: {
    kicker: "Primeros 5 minutos", title: "Preparemos tu primera cotización", intro: "Sigue estos pasos a tu ritmo. Puedes omitir la configuración y volver después.",
    steps: ["Configura tu negocio", "Crea una cotización", "Revisa la vista del cliente", "Copia un enlace de prueba", "Guarda un precio reutilizable"],
    name: "Tu nombre (opcional)", business: "Nombre del negocio", address: "Dirección del negocio (opcional)", phone: "Teléfono del negocio (opcional)", tax: "Impuesto sobre ventas predeterminado %", markup: "Recargo predeterminado %", logo: "URL pública del logotipo (opcional)", color: "Color de marca",
    taxHelp: "Usa tasas que hayas verificado para tu ubicación y trabajo. Puedes cambiarlas en cada cotización.",
    save: "Guardar preferencias", saving: "Guardando…", estimate: "Crear una cotización", preview: "Revisar mi cotización", share: "Copiar mi enlace de prueba",
    fallback: "El enlace está listo. Selecciónalo y cópialo; después confirma abajo.", copied: "Copié el enlace", rate: "Agregar un precio a la lista",
    later: "Omitir por ahora", resume: "Continuar la configuración inicial", help: "Ver las guías paso a paso", error: "No pudimos guardar este paso. Inténtalo de nuevo.", finishedTitle: "La configuración inicial está lista", finishedBody: "Ya puedes seguir creando cotizaciones y reutilizar el precio que guardaste.",
    shareHelp: "Ábrelo tú primero. Copiar un enlace no envía un correo al cliente.", done: "Listo", optional: "Después de tu primera cotización puedes agregar logotipo, IA o pagos de Stripe.",
  },
};

export default function FirstFiveMinutes({ onVisibilityChange }: { onVisibilityChange?: (visible: boolean) => void }) {
  const { language } = useLanguage();
  const t = copy[language === "es" ? "es" : "en"];
  const router = useRouter();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [brandColor, setBrandColor] = useState("#c85b2d");
  const [taxRate, setTaxRate] = useState("0");
  const [markup, setMarkup] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "bootstrap" }), cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json() as Progress;
      setProgress(result);
      setFullName(result.profile.fullName);
      setBusinessName(result.profile.businessName);
      setBusinessAddress(result.profile.businessAddress);
      setPhone(result.profile.phone);
      setLogoUrl(result.profile.logoUrl);
      setBrandColor(result.profile.brandColor);
      setTaxRate(String(result.profile.taxRate));
      setMarkup(String(result.profile.markupPercentage));
    } catch { /* Setup is optional; the dashboard remains usable if it is unavailable. */ }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => { void refresh(); }, 0);
    window.addEventListener("workcraft-onboarding-refresh", refresh);
    return () => { window.clearTimeout(task); window.removeEventListener("workcraft-onboarding-refresh", refresh); };
  }, [refresh]);

  const complete = Boolean(progress?.profileComplete && progress?.estimateId && progress?.previewed && progress?.shared && progress?.priceBookReady);
  const visible = Boolean(progress?.eligible && !progress?.dismissed);
  useEffect(() => { onVisibilityChange?.(visible); }, [onVisibilityChange, visible]);

  async function mark(action: Exclude<Action, "bootstrap">) {
    const response = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }), cache: "no-store" });
    if (!response.ok) throw new Error("save failed");
    setProgress(await response.json() as Progress);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const tax = Number(taxRate), markupNumber = Number(markup);
      if (!businessName.trim() || !Number.isFinite(tax) || tax < 0 || tax > 100 || !Number.isFinite(markupNumber) || markupNumber < 0 || markupNumber > 500 || !/^#[0-9a-f]{6}$/i.test(brandColor)) throw new Error("invalid");
      if (logoUrl.trim() && new URL(logoUrl.trim()).protocol !== "https:") throw new Error("invalid logo URL");
      const { error: saveError } = await supabase.auth.updateUser({ data: {
        full_name: fullName.trim(), business_name: businessName.trim(), business_address: businessAddress.trim(), phone: phone.trim(), logo_url: logoUrl.trim(), brand_color: brandColor,
        tax_rate: tax, markup_percentage: markupNumber,
      } });
      if (saveError) throw saveError;
      await refresh();
    } catch { setError(t.error); } finally { setBusy(false); }
  }

  async function preview() {
    if (!progress?.estimateId) return;
    setBusy(true); setError("");
    try { await mark("previewed"); router.push(`/estimate/${encodeURIComponent(progress.estimateId)}`); }
    catch { setError(t.error); setBusy(false); }
  }

  async function share() {
    if (!progress?.estimateId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/estimates/${encodeURIComponent(progress.estimateId)}/share`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "copy" }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.url !== "string") throw new Error("share failed");
      try { await navigator.clipboard.writeText(result.url); await mark("shared"); }
      catch { setFallbackUrl(result.url); }
    } catch { setError(t.error); } finally { setBusy(false); }
  }

  async function dismiss() {
    setBusy(true); setError("");
    try { await mark("dismiss"); } catch { setError(t.error); } finally { setBusy(false); }
  }

  if (!progress?.eligible) return null;
  if (complete) return progress.dismissed ? null : <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-green-200 bg-green-50 p-5 text-green-950 shadow-sm"><div><h2 className="text-lg font-bold">{t.finishedTitle}</h2><p className="mt-1 text-sm">{t.finishedBody}</p>{error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}</div><button type="button" disabled={busy} onClick={() => void dismiss()} className="min-h-11 rounded-lg border border-green-700 px-4 text-sm font-semibold disabled:opacity-50">{t.done}</button></section>;
  if (progress.dismissed) return (
    <button type="button" onClick={() => void mark("reopen").catch(() => setError(t.error))} className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-left text-sm font-semibold text-orange-800 shadow-sm">{t.resume}</button>
  );

  const completed = [progress.profileComplete, Boolean(progress.estimateId), progress.previewed, progress.shared, progress.priceBookReady];
  const active = completed.findIndex((item) => !item);
  return (
    <section aria-labelledby="first-five-title" className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-orange-800">{t.kicker}</p><h2 id="first-five-title" className="mt-1 text-xl font-bold text-slate-900">{t.title}</h2><p className="mt-2 text-sm text-slate-600">{t.intro}</p></div>
        <button type="button" disabled={busy} onClick={() => void dismiss()} className="min-h-11 text-sm font-semibold text-slate-600 underline disabled:opacity-50">{t.later}</button>
      </div>
      <ol className="mt-5 grid gap-2 sm:grid-cols-5">{t.steps.map((label, index) => <li key={label} aria-current={active === index ? "step" : undefined} className={`rounded-lg border p-3 text-xs font-semibold ${completed[index] ? "border-green-200 bg-green-50 text-green-800" : active === index ? "border-orange-300 bg-orange-50 text-orange-900" : "border-slate-200 text-slate-500"}`}><span className="mr-1" aria-hidden="true">{completed[index] ? "✓" : `${index + 1}.`}</span>{label}</li>)}</ol>
      <div className="mt-5 rounded-xl bg-[#f7f5ef] p-4">
        {active === 0 && <form onSubmit={(event) => void saveProfile(event)} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-800">{t.name}<input maxLength={120} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">{t.business}<input required maxLength={120} autoComplete="organization" value={businessName} onChange={(event) => setBusinessName(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">{t.address}<input maxLength={300} autoComplete="street-address" value={businessAddress} onChange={(event) => setBusinessAddress(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">{t.phone}<input type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">{t.tax}<input type="number" min="0" max="100" step="0.01" inputMode="decimal" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">{t.markup}<input type="number" min="0" max="500" step="0.01" inputMode="decimal" value={markup} onChange={(event) => setMarkup(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800 sm:col-span-2">{t.logo}<input type="url" maxLength={2048} placeholder="https://" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal" /></label>
          <label className="text-sm font-semibold text-slate-800">{t.color}<input type="color" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} className="mt-1 h-12 w-full rounded-lg border border-slate-300 bg-white p-1" /></label>
          <p className="text-xs leading-5 text-slate-600 sm:col-span-2">{t.taxHelp}</p>
          <button type="submit" disabled={busy} className="min-h-12 rounded-lg bg-orange-800 px-4 font-semibold text-white disabled:opacity-50 sm:justify-self-start">{busy ? t.saving : t.save}</button>
        </form>}
        {active === 1 && <Link href="/estimate/new" className="inline-flex min-h-12 items-center rounded-lg bg-orange-800 px-4 font-semibold text-white">{t.estimate}</Link>}
        {active === 2 && <button type="button" disabled={busy} onClick={() => void preview()} className="min-h-12 rounded-lg bg-orange-800 px-4 font-semibold text-white disabled:opacity-50">{t.preview}</button>}
        {active === 3 && <div><p className="mb-3 text-sm text-slate-600">{t.shareHelp}</p><button type="button" disabled={busy} onClick={() => void share()} className="min-h-12 rounded-lg bg-orange-800 px-4 font-semibold text-white disabled:opacity-50">{t.share}</button>{fallbackUrl && <div className="mt-3"><label className="block text-sm text-slate-700">{t.fallback}<input readOnly value={fallbackUrl} onFocus={(event) => event.currentTarget.select()} className="mt-2 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3" /></label><button type="button" onClick={() => void mark("shared").catch(() => setError(t.error))} className="mt-2 min-h-12 font-semibold text-orange-800 underline">{t.copied}</button></div>}</div>}
        {active === 4 && <div><Link href="/pricebook" className="inline-flex min-h-12 items-center rounded-lg bg-orange-800 px-4 font-semibold text-white">{t.rate}</Link><p className="mt-2 text-xs text-slate-600">{t.optional}</p></div>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-red-800">{error}</p>}
      <p className="mt-4 text-xs text-slate-600"><Link href="/help" className="font-semibold text-orange-800 underline">{t.help}</Link></p>
    </section>
  );
}
