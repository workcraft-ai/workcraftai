"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/app/utils/supabase/client";
import Logo from "@/app/components/Logo";
import { useLanguage } from "@/app/components/LanguageProvider";

type FactorChoice = { id: string; friendly_name?: string | null };

export default function MfaPage() {
  const { language } = useLanguage();
  const es = language === "es";
  const [factors, setFactors] = useState<FactorChoice[]>([]);
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const supabase = createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) { window.location.replace("/login"); return; }
        const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assuranceError || !assurance) throw assuranceError ?? new Error("Assurance unavailable");
        if (assurance.currentLevel === "aal2" || assurance.nextLevel !== "aal2") { window.location.replace("/dashboard"); return; }
        const { data, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;
        if (!active) return;
        const verified = (data?.totp ?? []).filter((factor) => factor.status === "verified");
        if (!verified.length) throw new Error("No verified authenticator available");
        setFactors(verified);
        setFactorId(verified[0].id);
        setLoading(false);
      } catch {
        if (active) {
          setError(es ? "No pudimos cargar tu autenticador. Actualiza la página o contacta con soporte." : "We could not load your authenticator. Refresh this page or contact support.");
          setLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [es]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError || !challenge) throw challengeError ?? new Error("Challenge unavailable");
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
      if (verifyError) throw verifyError;
      // The MFA response saves an AAL2 session. A full navigation makes the
      // server read the updated cookies instead of reusing an AAL1 route cache.
      window.location.replace("/dashboard");
    } catch {
      setError(es ? "No se pudo verificar el código. Revisa tu autenticador e inténtalo de nuevo." : "The code could not be verified. Check your authenticator and try again.");
      setCode("");
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await createClient().auth.signOut({ scope: "local" });
    window.location.replace("/login");
  }

  return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-100">
    <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-lg sm:p-8">
      <Logo className="h-10 w-10" />
      <h1 className="mt-5 text-2xl font-bold">{es ? "Verifica tu identidad" : "Verify your identity"}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-300">{es ? "Ingresa el código de seis dígitos de tu aplicación de autenticación para continuar." : "Enter the six-digit code from your authenticator app to continue."}</p>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-700 bg-red-950 p-3 text-sm text-red-200">{error}</p>}
      {loading ? <p role="status" className="mt-5 text-sm text-slate-300">{es ? "Cargando…" : "Loading…"}</p> : factors.length > 0 && <form onSubmit={verify} className="mt-5 space-y-4">
        {factors.length > 1 && <label className="block text-sm font-semibold">{es ? "Autenticador" : "Authenticator"}<select value={factorId} onChange={(event) => setFactorId(event.target.value)} className="mt-2 min-h-12 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 text-white">{factors.map((factor, index) => <option key={factor.id} value={factor.id}>{factor.friendly_name || `${es ? "Autenticador" : "Authenticator"} ${index + 1}`}</option>)}</select></label>}
        <label htmlFor="mfa-code" className="block text-sm font-semibold">{es ? "Código de autenticación" : "Authenticator code"}</label>
        <input id="mfa-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="min-h-12 w-full rounded-lg border border-slate-600 bg-slate-800 px-4 text-lg tracking-[0.25em] text-white" />
        <button disabled={busy || code.length !== 6} className="min-h-12 w-full rounded-lg bg-orange-700 px-4 font-semibold text-white disabled:opacity-50">{busy ? (es ? "Verificando…" : "Verifying…") : (es ? "Verificar y continuar" : "Verify and continue")}</button>
      </form>}
      <div className="mt-6 flex flex-wrap gap-x-5 gap-y-3 text-sm">
        <button type="button" disabled={busy} onClick={() => void signOut()} className="text-slate-200 underline disabled:opacity-50">{es ? "Usar otra cuenta" : "Use another account"}</button>
        <Link href="/support" className="text-slate-200 underline">{es ? "¿Perdiste tu autenticador? Contacta con soporte" : "Lost your authenticator? Contact support"}</Link>
      </div>
    </section>
  </main>;
}
