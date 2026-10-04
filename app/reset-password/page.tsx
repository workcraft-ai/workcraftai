"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/utils/supabase/client";
import Logo from "@/app/components/Logo";
import { LocalizedTree } from "@/app/components/LanguageProvider";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [leavingReset, setLeavingReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleBackToSignIn = async () => {
    setLeavingReset(true);
    setError(null);
    const supabase = createClient();
    const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
    if (signOutError) {
      setError("Could not safely end the password reset session. Please try again.");
      setLeavingReset(false);
      return;
    }
    router.replace("/login");
  };

  const handleUpdatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    router.push("/login?message=Password%20updated%20successfully");
    router.refresh();
  };

  return (
    <LocalizedTree>
    <main className="flex min-h-screen flex-col justify-center bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-md flex-col items-center">
        <Logo className="h-10 w-10" />
        <h1 className="mt-6 text-center text-2xl font-bold tracking-tight text-white">Choose a new password</h1>
        <p className="mt-2 text-center text-sm text-slate-400">Use at least 8 characters for your new password.</p>
      </div>

      <section className="mx-auto mt-8 w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 shadow sm:px-10">
        <form className="space-y-5" onSubmit={handleUpdatePassword}>
          {error && <p role="alert" className="rounded-md border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300">New password</label>
            <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300">Confirm new password</label>
            <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <button type="submit" disabled={loading} className="flex w-full justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:opacity-50">
            {loading ? "Updating password…" : "Update password"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-400"><button type="button" onClick={() => void handleBackToSignIn()} disabled={leavingReset} className="font-medium text-blue-400 hover:text-blue-300 disabled:opacity-50">{leavingReset ? "Ending reset session…" : "Back to sign in"}</button></p>
      </section>
    </main>
    </LocalizedTree>
  );
}
