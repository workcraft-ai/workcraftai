"use client";

import { useEffect, useState, type ReactNode } from "react";

type Snapshot = {
  checked_at: string;
  errors: string[];
  supabase: { database_bytes: number; storage_payload_bytes: number; storage_objects: number } | null;
  connections: { connections: number; max_connections: number } | null;
  resend: { daily: { used: number; limit: number | null }; monthly: { used: number; limit: number | null } } | null;
  app: { email_today: number; email_daily_limit: number; ai_today: number; ai_daily_limit: number } | null;
  delivery: { failed_stripe_webhooks: number; failed_notifications: number } | null;
  heartbeats: { name: string; last_success_at: string }[] | null;
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

function quantity(value: number, unit: string) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

function Meter({ label, used, limit, unit, note, es }: { label: string; used: number | null; limit: number | null; unit?: string; note?: string; es: boolean }) {
  const ratio = used !== null && limit !== null && limit > 0 ? used / limit : null;
  const percent = ratio === null ? null : Math.round(ratio * 100);
  const color = ratio !== null && ratio >= 0.85 ? "bg-red-600" : ratio !== null && ratio >= 0.7 ? "bg-amber-500" : "bg-emerald-600";
  return <div className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-sm font-semibold text-slate-900">{label}</p><p className="text-sm font-bold tabular-nums text-slate-950">{used === null ? (es ? "No disponible" : "Unavailable") : quantity(used, unit ?? "")} {limit !== null && <span className="font-normal text-slate-600">/ {quantity(limit, unit ?? "")}</span>}</p></div>
    {percent !== null && <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="meter" aria-label={label} aria-valuenow={used ?? undefined} aria-valuemin={0} aria-valuemax={limit ?? undefined}><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div>}
    {percent !== null && <p className="mt-1 text-xs font-semibold text-slate-600">{percent}% {es ? "utilizado" : "used"}{percent >= 85 ? ` · ${es ? "revisar ahora" : "review now"}` : percent >= 70 ? ` · ${es ? "vigilar" : "watch"}` : ""}</p>}
    {note && <p className="mt-2 text-xs leading-5 text-slate-600">{note}</p>}
  </div>;
}

function Provider({ title, kind, href, children, es }: { title: string; kind: "live" | "app" | "manual"; href: string; children: ReactNode; es: boolean }) {
  const status = kind === "live" ? (es ? "Uso del proveedor" : "Provider usage") : kind === "app" ? (es ? "Datos de la aplicación" : "App data") : (es ? "Revisión manual" : "Dashboard check");
  return <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-lg font-bold text-slate-950">{title}</h3><p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-600">{status}</p></div><a href={href} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-orange-800 hover:bg-orange-50">{es ? "Abrir panel ↗" : "Open dashboard ↗"}</a></div>
    <div className="mt-4 space-y-3 text-sm leading-6 text-slate-700">{children}</div>
  </section>;
}

export default function InfrastructurePanel({ language, active }: { language: "en" | "es"; active: boolean }) {
  const es = language === "es";
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch("/api/admin/infrastructure", { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load infrastructure usage.");
      if (!cancelled) { setSnapshot(result); setError(""); }
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load infrastructure usage.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, revision]);

  const heartbeat = (name: string) => snapshot?.heartbeats?.find((item) => item.name === name)?.last_success_at;
  const lastRun = (name: string) => {
    const value = heartbeat(name);
    return value ? new Date(value).toLocaleString() : (es ? "Sin registro" : "No record");
  };

  return <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-950">{es ? "Resumen de infraestructura" : "Infrastructure overview"}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{es ? "Capacidad y salud de los servicios que ejecutan WorkCraft AI. Las cifras en vivo se distinguen de los límites de referencia del plan gratuito y de las revisiones manuales. Confirma el plan actual antes de decidir una ampliación." : "Capacity and health for the services running WorkCraft AI. Live figures are separate from free-plan reference limits and manual dashboard checks. Confirm the current plan before deciding to upgrade."}</p>{snapshot && <p className="mt-2 text-xs text-slate-500">{es ? "Actualizado" : "Updated"}: {new Date(snapshot.checked_at).toLocaleString()}</p>}</div><button type="button" onClick={() => { setLoading(true); setRevision((value) => value + 1); }} disabled={loading} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50">{loading ? (es ? "Actualizando…" : "Refreshing…") : (es ? "Actualizar" : "Refresh")}</button></div>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {!snapshot && !error && <p role="status" className="mt-4 text-sm text-slate-600">{es ? "Cargando uso…" : "Loading usage…"}</p>}
    {snapshot && <>
      {snapshot.errors.length > 0 && <p role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{es ? "Algunas fuentes no respondieron. Los valores faltantes se muestran como no disponibles; revisa sus paneles." : "Some sources did not respond. Missing values are shown as unavailable; check their dashboards."}</p>}
      <p className="mt-4 text-xs text-slate-600">{es ? "El color cambia al 70 % y al 85 %. Esto es una guía para revisar la capacidad, no una alerta automática ni una recomendación de compra." : "Bars change at 70% and 85%. This is a capacity review guide, not an automatic alert or purchase recommendation."}</p>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Provider title="Supabase" kind="app" href="https://supabase.com/dashboard/org/_/usage" es={es}>
          <Meter label={es ? "Base de datos de Production" : "Production database"} used={snapshot.supabase ? Number(snapshot.supabase.database_bytes) / MB : null} limit={500} unit="MB" note={es ? "Medición de PostgreSQL. 500 MB es la referencia del plan Free por proyecto; el panel de Supabase confirma el plan y la facturación." : "PostgreSQL measurement. 500 MB is the Free reference per project; Supabase confirms the actual plan and billing."} es={es} />
          <Meter label={es ? "Archivos almacenados" : "Stored file payloads"} used={snapshot.supabase ? Number(snapshot.supabase.storage_payload_bytes) / GB : null} limit={1} unit="GB" note={es ? "Suma aproximada de los archivos de Production; la facturación de Storage usa GB-horas y puede diferir. Free incluye 1 GB." : "Approximate Production file payload total; Storage billing uses GB-hours and can differ. Free includes 1 GB."} es={es} />
          <Meter label={es ? "Conexiones de base de datos" : "Database connections"} used={snapshot.connections?.connections ?? null} limit={snapshot.connections?.max_connections ?? null} es={es} />
          <p className="text-xs text-slate-600">{es ? "Archivos:" : "Objects:"} {snapshot.supabase?.storage_objects ?? "—"}. {es ? "Consulta también MAU y transferencia en Supabase Usage; no son equivalentes a las cuentas creadas." : "Check MAU and egress in Supabase Usage too; created accounts are not the same as billable MAU."}</p>
          <p className="text-xs text-slate-600">{es ? "Referencia Free: 50 000 MAU y 5 GB de transferencia mensual. Uso actual: consulta el panel." : "Free reference: 50,000 MAU and 5 GB monthly egress. Current usage: check the dashboard."}</p>
        </Provider>

        <Provider title="Resend" kind={snapshot.resend ? "live" : "manual"} href="https://resend.com/usage" es={es}>
          <Meter label={es ? "Correos del día" : "Emails today"} used={snapshot.resend?.daily.used ?? null} limit={snapshot.resend?.daily.limit ?? null} es={es} />
          <Meter label={es ? "Correos del mes" : "Emails this month"} used={snapshot.resend?.monthly.used ?? null} limit={snapshot.resend?.monthly.limit ?? null} es={es} />
          <p className="text-xs text-slate-600">{es ? "El plan Free publica 100 por día y 3000 por mes. Cuando la API de uso está disponible, las barras muestran los límites reales que devuelve Resend." : "The Free plan publishes 100/day and 3,000/month. When the Usage API is available, the bars use the limits Resend actually returns."}</p>
          <p className="text-xs text-slate-600">{es ? "Límite interno de la aplicación hoy:" : "App admission limit today:"} {snapshot.app ? `${snapshot.app.email_today} / ${snapshot.app.email_daily_limit}` : "—"}. {es ? "No equivale al total enviado por Resend." : "This is not Resend's sent total."}</p>
        </Provider>

        <Provider title="Vercel" kind="manual" href="https://vercel.com/dashboard/usage" es={es}>
          <p>{es ? "Revisa transferencia, solicitudes, tiempo de función y despliegues en Usage. No hay una credencial de uso de Vercel configurada para esta página." : "Review data transfer, requests, function time, and deployments in Usage. This page has no Vercel usage credential configured."}</p>
          <p className="text-xs text-slate-600">{es ? "Referencia Hobby: 100 GB de Fast Data Transfer y 1 millón de invocaciones. Si este proyecto está en Pro, se aplican otros límites y facturación." : "Hobby reference: 100 GB Fast Data Transfer and 1 million invocations. If this project is on Pro, different allowances and billing apply."}</p>
        </Provider>

        <Provider title="GitHub Actions" kind="app" href="https://github.com/organizations/workcraft-ai/settings/billing/usage" es={es}>
          <p>{es ? "Último monitor correcto:" : "Last successful availability monitor:"} <strong>{lastRun("availability_monitor")}</strong></p>
          <p>{es ? "Última copia de base de datos/Auth:" : "Last database/Auth backup:"} <strong>{lastRun("database_backup")}</strong></p>
          <p>{es ? "Última copia de archivos privados:" : "Last private-media backup:"} <strong>{lastRun("private_media_backup")}</strong></p>
          <p className="text-xs text-slate-600">{es ? "Referencia GitHub Free para repos privados: 2000 minutos/mes y 500 MB de artefactos. Los runners estándar de repos públicos son gratuitos. El uso de minutos y almacenamiento requiere revisar GitHub Billing." : "GitHub Free reference for private repositories: 2,000 minutes/month and 500 MB artifact storage. Standard runners for public repositories are free. Check GitHub Billing for actual minutes and storage."}</p>
        </Provider>

        <Provider title="Google AI (Gemini)" kind="app" href="https://aistudio.google.com/usage" es={es}>
          <Meter label={es ? "Intentos admitidos hoy por la aplicación" : "App-admitted attempts today"} used={snapshot.app?.ai_today ?? null} limit={snapshot.app?.ai_daily_limit ?? null} es={es} />
          <p className="text-xs text-slate-600">{es ? "Este contador incluye fallos del proveedor y no es el uso facturado de tokens. Los límites de Google varían por modelo y nivel; revisa las cuotas y el gasto reales en AI Studio." : "This includes provider failures and is not billed token usage. Google limits vary by model and tier; review actual quotas and spend in AI Studio."}</p>
        </Provider>

        <Provider title="Stripe" kind="app" href="https://dashboard.stripe.com/workbench/webhooks" es={es}>
          <p>{es ? "Webhooks con error en el registro de la aplicación:" : "Failed webhooks in the app ledger:"} <strong>{snapshot.delivery?.failed_stripe_webhooks ?? "—"}</strong></p>
          <p className="text-xs text-slate-600">{es ? "Stripe Standard cobra por transacción y no publica una cuota de transacciones gratuita comparable. Revisa pagos, disputas, saldos y entregas en Stripe." : "Stripe Standard is pay-as-you-go and has no comparable free transaction quota. Review payments, disputes, balances, and deliveries in Stripe."}</p>
        </Provider>

        <Provider title="Cloudflare Turnstile" kind="manual" href="https://dash.cloudflare.com/?to=/:account/turnstile" es={es}>
          <p>{es ? "Revisa verificaciones y resultados de Siteverify en Turnstile Analytics. Esta página no tiene un token de analítica de Cloudflare." : "Review Siteverify volume and outcomes in Turnstile Analytics. This page has no Cloudflare analytics token."}</p>
          <p className="text-xs text-slate-600">{es ? "El plan Free permite desafíos y verificaciones sin límite de volumen; limita el número de widgets a 20 y el historial de análisis a 7 días." : "Free allows unlimited challenge and verification volume; it limits widgets to 20 and analytics lookback to 7 days."}</p>
        </Provider>

        <Provider title={es ? "Salud de correos" : "Email delivery health"} kind="app" href="https://resend.com/emails" es={es}>
          <p>{es ? "Notificaciones fallidas en la aplicación:" : "Failed app notifications:"} <strong>{snapshot.delivery?.failed_notifications ?? "—"}</strong></p>
          <p className="text-xs text-slate-600">{es ? "Para rebotes, supresiones y entregas, compara con Resend y la pestaña de tareas programadas." : "For bounces, suppressions, and deliveries, compare with Resend and the Cron jobs tab."}</p>
        </Provider>
      </div>
      <p className="mt-5 text-xs leading-5 text-slate-600">{es ? "Los planes y límites pueden cambiar. Los datos internos son de Production y pueden diferir del ciclo de facturación del proveedor. Fuentes: " : "Plans and limits can change. Internal data is from Production and may differ from the provider billing cycle. Sources: "}
        <a className="underline" href="https://supabase.com/pricing" target="_blank" rel="noopener noreferrer">Supabase</a>, {" "}
        <a className="underline" href="https://resend.com/pricing" target="_blank" rel="noopener noreferrer">Resend</a>, {" "}
        <a className="underline" href="https://vercel.com/docs/limits" target="_blank" rel="noopener noreferrer">Vercel</a>, {" "}
        <a className="underline" href="https://docs.github.com/en/billing/concepts/product-billing/github-actions" target="_blank" rel="noopener noreferrer">GitHub</a>, {" "}
        <a className="underline" href="https://ai.google.dev/gemini-api/docs/rate-limits" target="_blank" rel="noopener noreferrer">Google AI</a>, {" "}
        <a className="underline" href="https://stripe.com/pricing" target="_blank" rel="noopener noreferrer">Stripe</a>, {" "}
        <a className="underline" href="https://developers.cloudflare.com/turnstile/plans/" target="_blank" rel="noopener noreferrer">Cloudflare</a>.
      </p>
    </>}
  </section>;
}
