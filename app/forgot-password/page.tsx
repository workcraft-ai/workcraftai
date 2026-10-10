"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/app/utils/supabase/client";
import Logo from "@/app/components/Logo";
import { LocalizedTree, translate, useLanguage } from "@/app/components/LanguageProvider";
import TurnstileCaptcha, { TURNSTILE_ENABLED } from "@/app/components/TurnstileCaptcha";
import { authResetOutcome } from "@/lib/auth-reset-response.mjs";

export default function ForgotPasswordPage() {
  return <Suspense fallback={<main className="min-h-screen bg-slate-950" />}><ForgotPasswordForm /></Suspense>;
}

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const { language } = useLanguage();
  const searchParams = useSearchParams();
  const expiredLink = searchParams.get("error") === "expired";

  const handleResetRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (TURNSTILE_ENABLED && !captchaToken) {
      setError(translate(language, "Complete the security check to continue."));
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/confirm?next=%2Freset-password`,
        ...(captchaToken ? { captchaToken } : {}),
      });

      const outcome = authResetOutcome(resetError);
      if (outcome === "captcha") {
        setError(translate(language, "Security verification did not complete. Please try again."));
      } else if (outcome === "unavailable") {
        setError(translate(language, "We could not process this request right now. Please wait a moment and try again."));
      } else {
        // Use the same response for accepted and rate-limited requests so the
        // page cannot be used to infer whether an address has an account.
        setMessage("If an account exists for that email, a password reset link is on its way. If you requested one recently, wait a minute before trying again.");
      }
    } catch {
      setError(translate(language, "We could not process this request right now. Please wait a moment and try again."));
    } finally {
      setCaptchaToken(null);
      setCaptchaResetSignal((signal) => signal + 1);
      setLoading(false);
    }
  };

  return (
    <LocalizedTree>
    <main className="flex min-h-screen flex-col justify-center bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-md flex-col items-center">
        <Logo className="h-10 w-10" />
        <h1 className="mt-6 text-center text-2xl font-bold tracking-tight text-white">Reset your password</h1>
        <p className="mt-2 text-center text-sm text-slate-400">We’ll email you a secure link to choose a new password.</p>
      </div>

      <section className="mx-auto mt-8 w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 shadow sm:px-10">
        <form className="space-y-5" onSubmit={handleResetRequest}>
          {(error || (expiredLink && !message)) && <p role="alert" className="rounded-md border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">{error || "That password reset link has expired or was already used. Enter your email below to get a fresh link."}</p>}
          {message && <p role="status" className="rounded-md border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">{message}</p>}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-300">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            className="mt-2 block min-h-12 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="you@example.com"
            />
          </div>
          <TurnstileCaptcha onToken={setCaptchaToken} resetSignal={captchaResetSignal} />
          <button type="submit" disabled={loading || (TURNSTILE_ENABLED && !captchaToken)} className="flex min-h-12 w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:opacity-50">
            {loading ? "Sending link…" : "Send reset link"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-400">
          Remembered your password? <Link href="/login" className="inline-flex min-h-12 items-center font-medium text-blue-400 underline hover:text-blue-300">Sign in</Link>
        </p>
      </section>
    </main>
    </LocalizedTree>
  );
}
