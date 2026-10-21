"use client";

import { useState } from "react";

export default function UnsubscribeClient({ token, es }: { token: string; es: boolean }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const stop = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/email-preferences/unsubscribe", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error("save_failed");
      setDone(true);
    } catch {
      setError(es ? "No pudimos actualizar tu preferencia. Comunícate con soporte." : "We couldn't update your preference. Please contact support.");
    } finally { setBusy(false); }
  };

  return <main className="mx-auto max-w-xl px-4 py-16">
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold text-slate-950">{es ? "Consejos por correo" : "Product tips by email"}</h1>
      <p className="mt-3 text-slate-700">{done
        ? (es ? "Ya no recibirás consejos de producto. Los avisos esenciales de cuenta, seguridad y pagos seguirán llegando." : "Product tips are turned off. Essential account, security, and payment notices will still arrive.")
        : (es ? "Puedes dejar de recibir correos de ayuda y funciones con un solo paso." : "You can stop help and feature emails in one step.")}</p>
      {!done && <button type="button" onClick={() => void stop()} disabled={busy || !/^[a-f0-9]{48}$/.test(token)} className="mt-6 min-h-11 rounded-lg bg-orange-800 px-5 py-2 font-semibold text-white disabled:opacity-50">{busy ? (es ? "Guardando…" : "Saving…") : (es ? "Dejar de recibir consejos" : "Stop product tips")}</button>}
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
      <p className="mt-5 text-sm"><a href="/support" className="font-semibold text-orange-800 underline">{es ? "Contactar soporte" : "Contact support"}</a></p>
    </section>
  </main>;
}
