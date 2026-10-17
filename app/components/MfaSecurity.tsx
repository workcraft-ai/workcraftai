"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/app/utils/supabase/client";
import { useLanguage } from "@/app/components/LanguageProvider";

type TotpFactor = { id: string; friendly_name?: string | null; status: string };
type PendingFactor = { id: string; qr: string; secret: string };

export function MfaInvite() {
  const { language } = useLanguage();
  const es = language === "es";
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      const [{ data: { user } }, { data: factors }] = await Promise.all([
        supabase.auth.getUser(), supabase.auth.mfa.listFactors(),
      ]);
      if (active) setVisible(Boolean(user && !user.user_metadata?.mfa_prompt_dismissed_at && !(factors?.totp ?? []).some((factor) => factor.status === "verified")));
    })();
    return () => { active = false; };
  }, []);

  async function dismiss() {
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ data: { mfa_prompt_dismissed_at: new Date().toISOString() } });
    if (!error) setVisible(false);
    setBusy(false);
  }

  if (!visible) return null;
  return <section aria-labelledby="mfa-invite-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <h2 id="mfa-invite-title" className="text-lg font-bold text-slate-900">{es ? "Protege tu cuenta" : "Protect your account"}</h2>
    <p className="mt-1 text-sm leading-6 text-slate-600">{es ? "Agrega una aplicación de autenticación para proteger tus cotizaciones y datos de clientes. Es opcional y toma aproximadamente un minuto." : "Add an authenticator app to protect your estimates and customer details. It is optional and takes about a minute."}</p>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Link href="/profile#security" className="inline-flex min-h-11 items-center rounded-lg bg-orange-800 px-4 text-sm font-semibold text-white">{es ? "Configurar autenticador" : "Set up authenticator"}</Link>
      <button type="button" disabled={busy} onClick={() => void dismiss()} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-50">{es ? "Quizás más tarde" : "Maybe later"}</button>
    </div>
  </section>;
}

export default function MfaSecurity() {
  const { language } = useLanguage();
  const es = language === "es";
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [pending, setPending] = useState<PendingFactor | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    const { data, error: listError } = await createClient().auth.mfa.listFactors();
    if (listError) throw listError;
    setFactors((data?.totp ?? []).filter((factor) => factor.status === "verified"));
  }

  useEffect(() => {
    let active = true;
    void createClient().auth.mfa.listFactors().then(({ data, error: listError }) => {
      if (!active) return;
      if (listError) setError(es ? "No pudimos cargar los autenticadores." : "We could not load your authenticators.");
      else setFactors((data?.totp ?? []).filter((factor) => factor.status === "verified"));
      setLoading(false);
    });
    return () => { active = false; };
  }, [es]);

  useEffect(() => {
    if (window.location.hash !== "#security") return;
    const task = window.setTimeout(() => document.getElementById("security")?.scrollIntoView({ block: "start" }), 0);
    return () => window.clearTimeout(task);
  }, []);

  async function begin() {
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: enrollError } = await createClient().auth.mfa.enroll({ factorType: "totp", friendlyName: "WorkCraft AI" });
      if (enrollError || !data?.totp) throw enrollError ?? new Error("Enrollment unavailable");
      setPending({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setCode("");
    } catch { setError(es ? "No pudimos iniciar la configuración. Inténtalo de nuevo." : "Could not start setup. Please try again."); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!pending) return;
    setBusy(true);
    await createClient().auth.mfa.unenroll({ factorId: pending.id });
    setPending(null); setCode(""); setBusy(false);
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending || !/^\d{6}$/.test(code)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const supabase = createClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: pending.id });
      if (challengeError || !challenge) throw challengeError ?? new Error("Challenge unavailable");
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: pending.id, challengeId: challenge.id, code });
      if (verifyError) throw verifyError;
      setPending(null); setCode("");
      await refresh();
      setNotice(es ? "Autenticador activado. Se te pedirá un código cuando vuelvas a iniciar sesión." : "Authenticator enabled. You will be asked for a code at your next sign-in.");
    } catch { setError(es ? "No se pudo verificar el código. Revisa el autenticador e inténtalo de nuevo." : "Could not verify the code. Check your authenticator and try again."); }
    finally { setBusy(false); }
  }

  async function remove(factor: TotpFactor) {
    if (!window.confirm(es ? "¿Quitar este autenticador de tu cuenta?" : "Remove this authenticator from your account?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { error: removeError } = await createClient().auth.mfa.unenroll({ factorId: factor.id });
      if (removeError) throw removeError;
      await refresh();
      setNotice(es ? "Se quitó el autenticador." : "Authenticator removed.");
    } catch { setError(es ? "No se pudo quitar. Vuelve a verificar tu sesión o contacta con soporte." : "Could not remove it. Verify your session again or contact support."); }
    finally { setBusy(false); }
  }

  return <section id="security" aria-labelledby="security-heading" className="mb-6 scroll-mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 id="security-heading" className="text-lg font-bold text-slate-900">{es ? "Seguridad de la cuenta" : "Account security"}</h2>
    <p className="mt-1 text-sm leading-6 text-slate-600">{es ? "La verificación con una aplicación de autenticación es opcional. Al activarla, se solicitará un código en los nuevos inicios de sesión." : "Authenticator verification is optional. Once enabled, new sign-ins require a code."}</p>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {loading ? <p className="mt-3 text-sm text-slate-500">{es ? "Cargando…" : "Loading…"}</p> : <>
      {factors.length > 0 ? <ul className="mt-4 space-y-2">{factors.map((factor, index) => <li key={factor.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm"><span className="font-semibold text-slate-800">{factor.friendly_name || `${es ? "Autenticador" : "Authenticator"} ${index + 1}`}</span><button type="button" disabled={busy} onClick={() => void remove(factor)} className="min-h-11 rounded-lg border border-red-300 px-3 font-semibold text-red-800 disabled:opacity-50">{es ? "Quitar" : "Remove"}</button></li>)}</ul> : <p className="mt-3 text-sm text-slate-700">{es ? "Aún no tienes un autenticador configurado." : "No authenticator is set up yet."}</p>}
      {!pending ? <button type="button" disabled={busy} onClick={() => void begin()} className="mt-4 min-h-11 rounded-lg bg-orange-800 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? (es ? "Preparando…" : "Preparing…") : factors.length ? (es ? "Agregar otro autenticador" : "Add another authenticator") : (es ? "Configurar autenticador" : "Set up authenticator")}</button> : <div className="mt-5 rounded-xl border border-orange-200 bg-orange-50 p-4">
        <p className="text-sm font-semibold text-slate-900">{es ? "Escanea este código QR con tu aplicación de autenticación." : "Scan this QR code with your authenticator app."}</p>
        <Image unoptimized src={pending.qr} alt={es ? "Código QR para WorkCraft AI" : "WorkCraft AI setup QR code"} width={192} height={192} className="mt-3 h-48 w-48 rounded-lg bg-white p-2" />
        <p className="mt-3 break-all text-xs text-slate-700">{es ? "Clave de configuración manual:" : "Manual setup key:"} <code>{pending.secret}</code></p>
        <form onSubmit={verify} className="mt-4"><label htmlFor="security-mfa-code" className="block text-sm font-semibold text-slate-800">{es ? "Código de seis dígitos" : "Six-digit code"}</label><input id="security-mfa-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-2 min-h-12 w-full max-w-xs rounded-lg border border-slate-300 px-4 text-lg tracking-[0.25em]" /><div className="mt-3 flex flex-wrap gap-3"><button disabled={busy || code.length !== 6} className="min-h-11 rounded-lg bg-orange-800 px-4 text-sm font-semibold text-white disabled:opacity-50">{es ? "Verificar y activar" : "Verify and enable"}</button><button type="button" disabled={busy} onClick={() => void cancel()} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800">{es ? "Cancelar" : "Cancel"}</button></div></form>
      </div>}
      <p className="mt-4 text-xs leading-5 text-slate-600">{es ? "Antes de cambiar de teléfono, agrega otro autenticador. Si pierdes acceso a todos, contacta con soporte; nunca envíes tus códigos." : "Before changing phones, add another authenticator. If you lose access to every factor, contact support; never send your codes."}</p>
    </>}
  </section>;
}
