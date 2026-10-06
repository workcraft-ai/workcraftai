"use client";

import { useState, type FormEvent } from "react";
import { LocalizedTree } from "@/app/components/LanguageProvider";

type SubmissionState = { kind: "success" | "error"; message: string } | null;

export default function SupportForm({
  fallbackResult,
}: {
  fallbackResult?: "sent" | "error";
}) {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<SubmissionState>(() => {
    if (fallbackResult === "sent") {
      return { kind: "success", message: "Thanks for reaching out. Your message is on its way to our support team." };
    }
    if (fallbackResult === "error") {
      return { kind: "error", message: "We could not send your message. Please try again." };
    }
    return null;
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setState(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formData)),
      });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "We could not send your message. Please try again.");
      form.reset();
      setState({ kind: "success", message: "Thanks for reaching out. Your message is on its way to our support team." });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "We could not send your message. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <LocalizedTree>
    <form method="post" action="/api/support" onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-slate-800">
          Your name
          <input name="name" autoComplete="name" required minLength={2} maxLength={120} className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-200" />
        </label>
        <label className="block text-sm font-semibold text-slate-800">
          Email address
          <input name="email" type="email" autoComplete="email" required maxLength={254} className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-200" />
        </label>
      </div>
      <label className="block text-sm font-semibold text-slate-800">
        What can we help with?
        <select name="topic" required defaultValue="" className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-200">
          <option value="" disabled>Select a topic</option>
          <option>Account access</option>
          <option>Estimates</option>
          <option>Proposals and invoices</option>
          <option>Billing</option>
          <option>Other</option>
        </select>
      </label>
      <label className="block text-sm font-semibold text-slate-800">
        Message
        <textarea name="message" required minLength={10} maxLength={4000} rows={6} placeholder="Tell us what happened and what you were trying to do." className="mt-2 block w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal leading-6 outline-none transition placeholder:text-slate-400 focus:border-orange-600 focus:ring-2 focus:ring-orange-200" />
      </label>
      <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="support-company-website">Leave this field empty</label>
        <input id="support-company-website" name="company_website" tabIndex={-1} autoComplete="off" />
      </div>
      <p className="text-xs leading-5 text-slate-500">Please don’t include passwords, payment card details, or sensitive customer information.</p>
      {state && <p role={state.kind === "error" ? "alert" : "status"} aria-live="polite" className={`rounded-xl px-4 py-3 text-sm ${state.kind === "error" ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>{state.message}</p>}
      <button type="submit" disabled={pending} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-orange-700 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-orange-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 disabled:cursor-wait disabled:opacity-60">
        {pending ? "Sending…" : "Send message"}
      </button>
    </form>
    </LocalizedTree>
  );
}
