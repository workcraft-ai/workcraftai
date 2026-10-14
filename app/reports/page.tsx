"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { LocalizedTree, useLanguage } from "@/app/components/LanguageProvider";
import { getClientProEntitlement } from "@/lib/client-pro-access";
import { ProPlanAction } from "@/app/components/ProPlanExperience";

type Estimate = { id: string; reference_number: string; status: string; created_at: string; total_cents: number };
type FinancialSummary = { completed_count: number; completed_total_cents: number; revenue_cents: number; cost_cents: number; unknown_tax_count: number };
const emptySummary: FinancialSummary = { completed_count: 0, completed_total_cents: 0, revenue_cents: 0, cost_cents: 0, unknown_tax_count: 0 };

export default function ReportsPage() {
  const { language } = useLanguage();
  const locale = language === "es" ? "es-US" : "en-US";
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [summary, setSummary] = useState<FinancialSummary>(emptySummary);
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReport = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const entitlement = user ? await getClientProEntitlement() : null;
    const pro = entitlement?.has_pro === true;
    setIsPro(pro);
    const { data, error: reportError } = await supabase.rpc("workcraft_report_snapshot");
    if (reportError || !data || !Array.isArray(data.estimates)) {
      setError(language === "es" ? "No se pudieron cargar los informes completos. Actualiza la página o contacta a soporte." : "Could not load complete report data. Refresh the page or contact support.");
      setEstimates([]); setSummary(emptySummary);
    } else {
      setEstimates(data.estimates as Estimate[]);
      setSummary(data as FinancialSummary);
      setError("");
    }
    setLoading(false);
  }, [language]);

  useEffect(() => {
    const task = window.setTimeout(() => { void loadReport(); }, 0);
    return () => window.clearTimeout(task);
  }, [loadReport]);

  const estimateTotal = (estimate: Estimate) => Number(estimate.total_cents) / 100;
  const accepted = estimates.filter((estimate) => ["accepted", "paid"].includes(estimate.status.toLowerCase()));
  const sentOrDecided = estimates.filter((estimate) => !["draft", "archived"].includes(estimate.status.toLowerCase()));
  const acceptanceRate = sentOrDecided.length ? Math.round(accepted.length / sentOrDecided.length * 100) : 0;
  const pipeline = estimates.reduce((sum, estimate) => sum + estimateTotal(estimate), 0);
  const wonValue = accepted.reduce((sum, estimate) => sum + estimateTotal(estimate), 0);
  const completedValue = Number(summary.completed_total_cents) / 100;
  const completedCost = Number(summary.cost_cents) / 100;
  const grossProfit = (Number(summary.revenue_cents) - Number(summary.cost_cents)) / 100;
  const grossMargin = Number(summary.revenue_cents) > 0
    ? Math.round((Number(summary.revenue_cents) - Number(summary.cost_cents)) / Number(summary.revenue_cents) * 100) : 0;
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
          <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-orange-800">Business overview</p><h1 className="mt-1 text-2xl font-bold">Reports</h1><p className="mt-1 text-sm text-slate-600">Estimate pipeline reports are included with Free. Pro adds job-value and gross-profit reports.</p></div>
          <div className="flex flex-wrap gap-2">{!isPro && <ProPlanAction />}<button type="button" onClick={() => void loadReport()} className="inline-flex min-h-12 items-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700">Refresh</button></div>
        </header>

        {error && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
        {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">Calculating reports…</div> : <>
          <section className={`grid gap-4 sm:grid-cols-2 ${isPro ? "xl:grid-cols-5" : "xl:grid-cols-3"}`}>
            <Metric label="Estimated pipeline" value={money(pipeline, locale)} note={`${estimates.length} estimates`} />
            <Metric label="Accepted estimate value" value={money(wonValue, locale)} note={`${accepted.length} accepted or paid`} />
            <Metric label="Acceptance rate" value={`${acceptanceRate}%`} note={`${sentOrDecided.length} active decisions`} />
            {isPro && <Metric label="Completed job value" value={money(completedValue, locale)} note={`${summary.completed_count} completed jobs`} />}
            {isPro && <Metric label="Gross profit" value={money(grossProfit, locale)} note={summary.unknown_tax_count ? (language === "es" ? `${summary.unknown_tax_count} trabajos excluidos: impuestos no verificados` : `${summary.unknown_tax_count} jobs excluded: tax not verified`) : completedCost ? (language === "es" ? `${grossMargin}% de margen · costos registrados` : `${grossMargin}% margin · costs entered`) : "Enter actual costs on the job board"} />}
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
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Recent estimates</h2><p className="mt-1 text-xs text-slate-500">Your largest opportunities at a glance</p></div><Link href="/dashboard" className="inline-flex min-h-12 items-center text-xs font-semibold text-blue-700 underline">All estimates</Link></div>
            {estimates.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">Create your first estimate to see business reports here.</p> : <div className="mt-4 divide-y divide-slate-100">{[...estimates].sort((a, b) => estimateTotal(b) - estimateTotal(a)).slice(0, 5).map((estimate) => <div key={estimate.id} className="flex items-center justify-between gap-3 py-3"><div><p className="text-sm font-semibold">Estimate #{estimate.reference_number}</p><p className="text-xs capitalize text-slate-500">{estimate.status} · {new Date(estimate.created_at).toLocaleDateString(locale)}</p></div><div className="flex items-center gap-4"><span className="text-sm font-bold">{money(estimateTotal(estimate), locale)}</span><Link href={`/estimate/${estimate.id}`} className="inline-flex min-h-12 items-center text-xs font-semibold text-blue-700 underline">View</Link></div></div>)}</div>}
          </section>
          <p className="text-xs text-slate-500">{language === "es" ? "Los informes usan cotizaciones y trabajos guardados. El valor del trabajo incluye impuestos; la ganancia bruta los excluye según los datos guardados al crear el trabajo. Los trabajos con impuestos sin verificar quedan fuera de la ganancia." : "Estimate reports use saved estimates and jobs. Completed job value includes tax; gross profit excludes tax using the saved job snapshot. Jobs with unverified tax are excluded from profit."}</p>
        </>}
      </div>
    </main>
    </LocalizedTree>
  );
}

function money(value: number, locale: string) { return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value); }
function moneyShort(value: number) { return value >= 1000 ? `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : `$${Math.round(value)}`; }
function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-3 text-3xl font-bold tabular-nums text-slate-900">{value}</p><p className="mt-2 text-xs text-slate-500">{note}</p></div>; }
