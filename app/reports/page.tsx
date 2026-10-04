"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { LocalizedTree, useLanguage } from "@/app/components/LanguageProvider";

type Estimate = { id: string; status: string; created_at: string };
type LineItem = { estimate_id: string; quantity: number; unit_price: number };
type Job = { status: string; quoted_total: number; actual_cost: number; scheduled_at: string | null };

export default function ReportsPage() {
  const { language } = useLanguage();
  const locale = language === "es" ? "es-US" : "en-US";
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReport = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: subscription } = user
      ? await supabase.from("subscriptions").select("status").eq("user_id", user.id).maybeSingle()
      : { data: null };
    const pro = subscription?.status === "active" || subscription?.status === "trialing";
    setIsPro(pro);
    const [estimateResult, lineResult, jobResult] = await Promise.all([
      supabase.from("estimates").select("id, status, created_at").order("created_at", { ascending: false }),
      supabase.from("line_items").select("estimate_id, quantity, unit_price"),
      pro ? supabase.from("jobs").select("status, quoted_total, actual_cost, scheduled_at") : Promise.resolve({ data: [], error: null }),
    ]);
    if (estimateResult.error || lineResult.error) setError("Could not load estimate data. Check your Supabase connection and permissions.");
    else {
      setEstimates((estimateResult.data ?? []) as Estimate[]);
      setLines((lineResult.data ?? []) as LineItem[]);
      setError("");
    }
    if (jobResult.error && !jobResult.error.message.includes("jobs")) setError(jobResult.error.message);
    else setJobs((jobResult.data ?? []) as Job[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => { void loadReport(); }, 0);
    return () => window.clearTimeout(task);
  }, [loadReport]);

  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.estimate_id, (totals.get(line.estimate_id) ?? 0) + Number(line.quantity || 0) * Number(line.unit_price || 0));
  const estimateTotal = (estimate: Estimate) => totals.get(estimate.id) ?? 0;
  const accepted = estimates.filter((estimate) => ["accepted", "paid"].includes(estimate.status.toLowerCase()));
  const sentOrDecided = estimates.filter((estimate) => !["draft", "archived"].includes(estimate.status.toLowerCase()));
  const acceptanceRate = sentOrDecided.length ? Math.round(accepted.length / sentOrDecided.length * 100) : 0;
  const pipeline = estimates.reduce((sum, estimate) => sum + estimateTotal(estimate), 0);
  const wonValue = accepted.reduce((sum, estimate) => sum + estimateTotal(estimate), 0);
  const completedJobs = jobs.filter((job) => job.status === "completed");
  const completedValue = completedJobs.reduce((sum, job) => sum + Number(job.quoted_total || 0), 0);
  const completedCost = completedJobs.reduce((sum, job) => sum + Number(job.actual_cost || 0), 0);
  const grossProfit = completedValue - completedCost;
  const grossMargin = completedValue > 0 ? Math.round(grossProfit / completedValue * 100) : 0;
  const monthBuckets = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - (5 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const label = date.toLocaleDateString(locale, { month: "short" });
    const amount = estimates.filter((estimate) => estimate.created_at?.startsWith(key)).reduce((sum, estimate) => sum + estimateTotal(estimate), 0);
    return { key, label, amount };
  });
  const maxMonth = Math.max(1, ...monthBuckets.map((month) => month.amount));

  return (
    <LocalizedTree>
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-blue-700">Business overview</p><h1 className="mt-1 text-2xl font-bold">Reports</h1><p className="mt-1 text-sm text-slate-600">Understand your estimate pipeline and completed work.</p></div>
          <div className="flex gap-2"><Link href={isPro ? "/schedule" : "/profile"} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">{isPro ? "Jobs & schedule" : "Unlock job reports"}</Link><button onClick={() => void loadReport()} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">Refresh</button></div>
        </header>

        {error && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
        {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">Calculating reports…</div> : <>
          <section className={`grid gap-4 sm:grid-cols-2 ${isPro ? "xl:grid-cols-5" : "xl:grid-cols-3"}`}>
            <Metric label="Estimated pipeline" value={money(pipeline, locale)} note={`${estimates.length} estimates`} />
            <Metric label="Accepted estimate value" value={money(wonValue, locale)} note={`${accepted.length} accepted or paid`} />
            <Metric label="Acceptance rate" value={`${acceptanceRate}%`} note={`${sentOrDecided.length} active decisions`} />
            {isPro && <Metric label="Completed job value" value={money(completedValue, locale)} note={`${completedJobs.length} completed jobs`} />}
            {isPro && <Metric label="Gross profit" value={money(grossProfit, locale)} note={completedCost ? `${grossMargin}% margin · costs entered` : "Enter actual costs on the job board"} />}
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between"><div><h2 className="font-semibold">Estimate value by month</h2><p className="mt-1 text-xs text-slate-500">Based on the date each estimate was created</p></div><span className="text-xs text-slate-500">Last 6 months</span></div>
              <div className="mt-8 grid h-56 grid-cols-6 items-end gap-3 sm:gap-5">
                {monthBuckets.map((month) => <div key={month.key} className="flex h-full flex-col items-center justify-end gap-2"><span className="text-[10px] font-medium text-slate-500">{month.amount ? moneyShort(month.amount) : "—"}</span><div className="flex w-full flex-1 items-end"><div className="w-full rounded-t-md bg-blue-500 transition-all" style={{ height: `${Math.max(month.amount ? 8 : 0, month.amount / maxMonth * 100)}%` }} /></div><span className="text-xs font-semibold text-slate-600">{month.label}</span></div>)}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="font-semibold">Estimate status</h2><p className="mt-1 text-xs text-slate-500">All saved estimates</p>
              <div className="mt-5 space-y-4">{["pending", "accepted", "paid", "declined"].map((status) => { const count = estimates.filter((estimate) => estimate.status.toLowerCase() === status).length; const percent = estimates.length ? count / estimates.length * 100 : 0; return <div key={status}><div className="mb-1 flex justify-between text-xs"><span className="capitalize text-slate-600">{status}</span><span className="font-semibold">{count}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: `${percent}%` }} /></div></div>; })}</div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Recent estimates</h2><p className="mt-1 text-xs text-slate-500">Your largest opportunities at a glance</p></div><Link href="/dashboard" className="text-xs font-semibold text-blue-700 underline">All estimates</Link></div>
            {estimates.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">Create your first estimate to see business reports here.</p> : <div className="mt-4 divide-y divide-slate-100">{[...estimates].sort((a, b) => estimateTotal(b) - estimateTotal(a)).slice(0, 5).map((estimate) => <div key={estimate.id} className="flex items-center justify-between gap-3 py-3"><div><p className="text-sm font-semibold">Estimate #{estimate.id.slice(0, 8)}</p><p className="text-xs capitalize text-slate-500">{estimate.status} · {new Date(estimate.created_at).toLocaleDateString(locale)}</p></div><div className="flex items-center gap-4"><span className="text-sm font-bold">{money(estimateTotal(estimate), locale)}</span><Link href={`/estimate/${estimate.id}`} className="text-xs font-semibold text-blue-700 underline">View</Link></div></div>)}</div>}
          </section>
          <p className="text-xs text-slate-500">Reports are calculated from estimates and jobs saved in WorkCraft AI. Completed job value uses the estimate total recorded when the job was created.</p>
        </>}
      </div>
    </main>
    </LocalizedTree>
  );
}

function money(value: number, locale: string) { return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value); }
function moneyShort(value: number) { return value >= 1000 ? `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : `$${Math.round(value)}`; }
function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-3 text-3xl font-bold tabular-nums text-slate-900">{value}</p><p className="mt-2 text-xs text-slate-500">{note}</p></div>; }
