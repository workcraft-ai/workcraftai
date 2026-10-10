"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/utils/supabase/client";
import { LocalizedTree, translate, useLanguage } from "@/app/components/LanguageProvider";
import TurnstileCaptcha, { TURNSTILE_ENABLED } from "@/app/components/TurnstileCaptcha";

export default function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const { language } = useLanguage();

  const router = useRouter();

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    setError(null);
    setMessage(false);

    if (password !== confirmPassword) {
      setError(translate(language, "Passwords do not match."));
      return;
    }

    if (TURNSTILE_ENABLED && !captchaToken) {
      setError(translate(language, "Complete the security check to continue."));
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
          ...(captchaToken ? { captchaToken } : {}),
        },
      });

      if (signUpError) {
        const code = signUpError.code?.toLowerCase() ?? "";
        const alreadyRegistered =
          code === "user_already_exists" ||
          code === "email_exists" ||
          code === "over_email_send_rate_limit";

        if (alreadyRegistered) {
          // Match the successful confirmation state so this page doesn't reveal
          // whether an email address already has an account.
          setMessage(true);
        } else if (code === "captcha_failed") {
          setError(translate(language, "Security verification did not complete. Please try again."));
        } else if (code === "weak_password") {
          setError(translate(language, "Choose a stronger password and try again."));
        } else if (signUpError.status === 429 || code === "over_request_rate_limit") {
          setError(translate(language, "Signup is temporarily limited. Wait a few minutes and try again."));
        } else {
          // Supabase error text can disclose account state and may change between
          // providers. Keep server details out of the public response.
          setError(translate(language, "We could not create your account. Please try again."));
        }
        return;
      }

      if (data.user && !data.session) {
        setMessage(true);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError(translate(language, "We could not create your account. Please try again."));
    } finally {
      setCaptchaToken(null);
      setCaptchaResetSignal((signal) => signal + 1);
      setLoading(false);
    }
  };

  return (
    <LocalizedTree>
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <h1 className="text-3xl font-extrabold text-white">
          Create Account
        </h1>

        <p className="mt-2 text-sm text-[#c8d1ca]">
          Sign up to get started with your account
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 py-8 px-4 shadow-xl border border-slate-800 sm:rounded-xl sm:px-10">
          <form
            method="post"
            className="space-y-6"
            onSubmit={handleSignup}
          >
            {error && (
              <div
                role="alert"
                className="rounded-md bg-red-900/30 border border-red-500/50 p-3 text-xs text-red-200"
              >
                {error}
              </div>
            )}

            {message && (
              <div
                role="status"
                className="rounded-md bg-green-900/30 border border-green-500/50 p-3 text-xs text-green-200"
              >
                <p>
                  If an account can be created for this email, we’ll send a confirmation link. If you requested one recently, wait a minute before trying again.
                </p>
                <p className="mt-2">
                  If you already have an account, you can{" "}
                  <Link href="/login" className="font-semibold underline">
                    sign in
                  </Link>{" "}
                  ·{" "}
                  <Link href="/forgot-password" className="font-semibold underline">
                    reset your password
                  </Link>.
                </p>
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium text-slate-300"
              >
                Email Address
              </label>

              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-slate-300"
              >
                Password
              </label>

              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-xs font-medium text-slate-300"
              >
                Confirm Password
              </label>

              <div className="mt-1">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <TurnstileCaptcha onToken={setCaptchaToken} resetSignal={captchaResetSignal} />

            <button
              type="submit"
              disabled={loading || (TURNSTILE_ENABLED && !captchaToken)}
              className="w-full flex justify-center py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition-colors disabled:opacity-50"
            >
              {loading ? "Creating Account..." : "Sign Up"}
            </button>
          </form>

          <div className="mt-6 text-center text-xs text-[#c8d1ca]">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-[#f3b28f] underline underline-offset-4 hover:text-white"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
    </LocalizedTree>
  );
}
