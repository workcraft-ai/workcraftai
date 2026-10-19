"use client";

import { useEffect, useState } from "react";

type Metrics = {
  generated_lines: number;
  auto_matched: number;
  needs_choice: number;
  ai_priced: number;
  contractor_priced: number;
  saved_lines: number;
  auto_match_kept: number;
  auto_match_changed: number;
  suggestions_chosen: number;
  suggestions_ai_used: number;
  lines_removed: number;
  quantities_changed: number;
  rates_changed: number;
  active_learned_aliases: number;
  pending_learned_aliases: number;
};

function percent(part: number, total: number) {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "—";
}

export default function AiMatchMetricsPanel({ language, active }: { language: "en" | "es"; active: boolean }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch("/api/admin/ai-match-metrics", { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load match metrics.");
      if (!cancelled) { setMetrics(result); setError(""); }
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load match metrics.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, refresh]);

  const es = language === "es";
  const stats = metrics ? [
    { label: es ? "Partidas generadas" : "Generated lines", value: metrics.generated_lines },
    { label: es ? "Coincidencias automáticas" : "Automatic Price Book matches", value: metrics.auto_matched, detail: percent(metrics.auto_matched, metrics.generated_lines) },
    { label: es ? "Necesitaron elegir" : "Needed a Price Book choice", value: metrics.needs_choice, detail: percent(metrics.suggestions_chosen, metrics.needs_choice) + (es ? " eligieron una tarifa guardada" : " chose a saved rate") },
    { label: es ? "Sin coincidencia; precio de IA" : "No match; AI starting rate", value: metrics.ai_priced },
    { label: es ? "Coincidencias aceptadas al guardar" : "Automatic matches kept when saved", value: metrics.auto_match_kept, detail: percent(metrics.auto_match_kept, metrics.auto_match_kept + metrics.auto_match_changed) },
    { label: es ? "Coincidencias cambiadas" : "Automatic matches changed", value: metrics.auto_match_changed },
    { label: es ? "Cantidades modificadas" : "Quantities changed", value: metrics.quantities_changed },
    { label: es ? "Precios de IA/manuales modificados" : "AI/manual rates changed", value: metrics.rates_changed },
    { label: es ? "Nombres aprendidos activos" : "Active learned names", value: metrics.active_learned_aliases, detail: `${metrics.pending_learned_aliases} ${es ? "pendientes" : "pending"}` },
  ] : [];

  return <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-bold text-slate-900">{es ? "Calidad de coincidencias de IA" : "AI matching quality"}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{es ? "Últimos 30 días. Se registran recuentos y decisiones al guardar, sin el texto de trabajos ni clientes. Los nombres aprendidos permanecen privados en cada cuenta." : "Last 30 days. Counts and saved choices are recorded without job or customer text. Learned names stay private to each account."}</p></div>
      <button type="button" onClick={() => { setLoading(true); setRefresh((value) => value + 1); }} disabled={loading} className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50">{es ? "Actualizar" : "Refresh"}</button>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {!metrics && !error && <p role="status" className="mt-3 text-sm text-slate-600">{es ? "Cargando métricas…" : "Loading metrics…"}</p>}
    {!!metrics && <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{stats.map((stat) => <div key={stat.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-600">{stat.label}</p><p className="mt-1 text-2xl font-bold tabular-nums text-slate-950">{stat.value}</p>{stat.detail && <p className="mt-1 text-xs text-slate-600">{stat.detail}</p>}</div>)}</div>
      <p className="mt-3 text-xs text-slate-600">{es ? `${metrics.saved_lines} partidas guardadas; ${metrics.lines_removed} eliminadas; ${metrics.suggestions_ai_used} usaron el precio inicial de IA pese a una posible coincidencia. Las correcciones se registran solo después de guardar la cotización.` : `${metrics.saved_lines} lines saved; ${metrics.lines_removed} removed; ${metrics.suggestions_ai_used} used an AI starting price despite a possible match. Corrections are recorded after an estimate is saved.`}</p>
    </>}
  </section>;
}
