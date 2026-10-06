"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Logo from "@/app/components/Logo";
import { LocalizedTree } from "@/app/components/LanguageProvider";

function ConfirmResetLink() {
  const searchParams = useSearchParams();
  const tokenHash = searchParams.get("token_hash");
  const isRecovery = searchParams.get("type") === "recovery";

  return (
    <LocalizedTree>
    <main className="flex min-h-screen flex-col justify-center bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-md flex-col items-center">
        <Logo className="h-10 w-10" />
        <h1 className="mt-6 text-center text-2xl font-bold tracking-tight text-white">Continue password reset</h1>
        <p className="mt-3 text-center text-sm leading-6 text-slate-400">
          Click below to verify your email and choose a new password. This extra step helps prevent email security scanners from using your reset link first.
        </p>
      </div>
      <section className="mx-auto mt-8 w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 text-center shadow sm:px-10">
        {tokenHash && isRecovery ? (
          <form action="/auth/confirm" method="post">
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value="recovery" />
        <button type="submit" className="block w-full rounded-lg bg-orange-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-800">
              Verify email and continue
            </button>
          </form>
        ) : (
          <p role="alert" className="text-sm text-red-300">This reset link is incomplete or invalid. Request a fresh password reset email.</p>
        )}
      </section>
    </main>
    </LocalizedTree>
  );
}

export default function ConfirmResetPage() {
  return <Suspense fallback={<main className="min-h-screen bg-slate-950" />}><ConfirmResetLink /></Suspense>;
}
