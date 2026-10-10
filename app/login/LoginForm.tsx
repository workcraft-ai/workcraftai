"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/utils/supabase/client";
import Logo from "@/app/components/Logo";
import { LocalizedTree, translate, useLanguage } from "@/app/components/LanguageProvider";
import TurnstileCaptcha, { TURNSTILE_ENABLED } from "@/app/components/TurnstileCaptcha";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const { language } = useLanguage();

  const router = useRouter();

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    setLoading(true);
    setError(null);

    if (TURNSTILE_ENABLED && !captchaToken) {
      setError(translate(language, "Complete the security check to continue."));
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      });

      if (signInError) {
        const code = signInError.code?.toLowerCase() ?? "";
        if (signInError.status === 429 || code === "over_request_rate_limit") {
          setError(translate(language, "Too many sign-in requests right now. Wait a few minutes and try again."));
        } else {
          setError(translate(language, "Email or password was not accepted. Check your details or reset your password."));
        }
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(translate(language, "We could not sign you in. Please try again."));
    } finally {
      setCaptchaToken(null);
      setCaptchaResetSignal((signal) => signal + 1);
      setLoading(false);
    }
  };

  return (
    <LocalizedTree>
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md flex flex-col items-center">
        <Logo className="h-10 w-10" />

        <h1 className="mt-6 text-center text-2xl font-bold tracking-tight text-white">
          Sign in to your account
        </h1>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 py-8 px-4 shadow border border-slate-800 sm:rounded-xl sm:px-10">
          <form method="post" className="space-y-6" onSubmit={handleSignIn}>
            {error && (
              <div
                role="alert"
                className="rounded-md bg-red-950/50 border border-red-800 p-4 text-xs text-red-300"
              >
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium text-slate-300"
              >
                Email address
              </label>

              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-xs"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="block text-xs font-medium text-slate-300"
                >
                  Password
                </label>

                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Forgot password?
                </Link>
              </div>

              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-xs"
                />
              </div>
            </div>

            <TurnstileCaptcha onToken={setCaptchaToken} resetSignal={captchaResetSignal} />

            <button
              type="submit"
              disabled={loading || (TURNSTILE_ENABLED && !captchaToken)}
              className="flex w-full justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div className="mt-6 text-center text-xs text-slate-400">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="font-medium text-blue-400 hover:text-blue-300 transition-colors"
            >
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </div>
    </LocalizedTree>
  );
}
