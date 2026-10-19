"use client";

import { useEffect, useState } from "react";

type Summary = { campaign: string; queued: number; sent: number; failed: number; delivered: number; delivery_issues: number; seven_day_cohort: number; seven_day_actions: number };
type Recent = { email: string; campaign: string; created_at: string; status: string | null; sent_at: string | null; delivery: string | null; action_within_7d: boolean; reason: string | null };
type Snapshot = { enabled: boolean; mailingAddressConfigured: boolean; opted_in_to_monthly_tips: number; summary: Summary[]; recent: Recent[] };

const names: Record<string, { en: string; es: string }> = {
  first_estimate: { en: "First estimate", es: "Primera cotización" },
  preview_estimate: { en: "Preview estimate", es: "Revisar cotización" },
  price_book: { en: "Price Book", es: "Lista de precios" },
  reactivation: { en: "Return reminder", es: "Recordatorio de regreso" },
  monthly_tip: { en: "Monthly guide", es: "Guía mensual" },
};

export default function EngagementEmailsPanel({ language, active }: { language: "en" | "es"; active: boolean }) {
  const es = language === "es";
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    let canceled = false;
    fetch("/api/admin/engagement", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("load_failed");
        return response.json() as Promise<Snapshot>;
      })
      .then((result) => { if (!canceled) { setData(result); setError(""); } })
      .catch(() => { if (!canceled) setError(es ? "No se pudo cargar el historial de correos." : "Email history could not load."); });
    return () => { canceled = true; };
  }, [active, es, revision]);

  return <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-950">{es ? "Correos de seguimiento" : "Engagement emails"}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{es ? "La bienvenida se gestiona por separado. Aquí se muestran los correos de ayuda y regreso de los últimos 90 días. Las acciones observadas no prueban que el correo las haya causado." : "Welcome remains separate. This shows getting-started and return emails from the last 90 days. Observed actions do not prove that an email caused them."}</p></div><button type="button" onClick={() => setRevision((value) => value + 1)} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">{es ? "Actualizar" : "Refresh"}</button></div>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {!data && !error && <p role="status" className="mt-4 text-sm text-slate-600">{es ? "Cargando…" : "Loading…"}</p>}
    {data && <>
      <p className={`mt-4 rounded-lg p-3 text-sm ${data.enabled ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}>{data.enabled
        ? (es ? "La secuencia está habilitada. Se ejecuta una vez al día y solo envía correos elegibles." : "The sequence is enabled. It runs daily and sends only eligible messages.")
        : (es ? "No se puede enviar esta secuencia porque Resend no está configurado. La bienvenida y los avisos esenciales siguen sus rutas actuales." : "This sequence cannot send because Resend is not configured. Welcome and essential notices retain their existing paths.")}</p>
      {!data.mailingAddressConfigured && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950">{es ? "Pendiente: estos correos de producto no incluyen una dirección postal física. El enlace de baja y el correo de soporte están disponibles, pero eso no sustituye el requisito de dirección postal de CAN-SPAM en EE. UU. Agrega una dirección comercial o apartado postal en ENGAGEMENT_POSTAL_ADDRESS cuando lo tengas." : "Open compliance gap: these product emails do not include a physical mailing address. The unsubscribe link and support email are available, but they do not replace the U.S. CAN-SPAM postal-address requirement. Add a business address or PO box in ENGAGEMENT_POSTAL_ADDRESS when available."}</p>}
      <p className="mt-3 text-sm text-slate-700">{es ? "Cuentas que aceptaron guías ocasionales:" : "Accounts opted into occasional guides:"} <strong>{data.opted_in_to_monthly_tips}</strong></p>
      <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-slate-200 text-slate-700"><th className="px-3 py-2">{es ? "Correo" : "Email"}</th><th className="px-3 py-2">{es ? "En cola" : "Queued"}</th><th className="px-3 py-2">{es ? "Enviados" : "Sent"}</th><th className="px-3 py-2">{es ? "Entregados" : "Delivered"}</th><th className="px-3 py-2">{es ? "Fallidos" : "Failed"}</th><th className="px-3 py-2">{es ? "Problemas de entrega" : "Delivery issues"}</th><th className="px-3 py-2">{es ? "Acción en 7 días" : "Action in 7 days"}</th></tr></thead><tbody>{data.summary.map((row) => <tr key={row.campaign} className="border-b border-slate-100"><th className="px-3 py-2 font-medium">{names[row.campaign]?.[es ? "es" : "en"] ?? row.campaign}</th><td className="px-3 py-2">{row.queued}</td><td className="px-3 py-2">{row.sent}</td><td className="px-3 py-2">{row.delivered}</td><td className="px-3 py-2">{row.failed}</td><td className="px-3 py-2">{row.delivery_issues}</td><td className="px-3 py-2">{row.seven_day_actions} / {row.seven_day_cohort}</td></tr>)}</tbody></table></div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{es ? "El grupo de 7 días incluye solo correos enviados hace al menos 7 días. La acción es crear una cotización, revisar o compartir, guardar un precio, o volver a usar la aplicación, según el correo. Un enlace copiado no confirma entrega al cliente." : "The seven-day cohort includes only emails sent at least seven days ago. The action is creating an estimate, previewing or sharing, saving a rate, or returning to the app, depending on the email. A copied link does not confirm customer delivery."}</p>
      <h3 className="mt-6 text-lg font-bold text-slate-950">{es ? "Actividad reciente" : "Recent activity"}</h3>
      <div className="mt-2 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-slate-200 text-slate-700"><th className="px-3 py-2">{es ? "Cuenta" : "Account"}</th><th className="px-3 py-2">{es ? "Correo" : "Email"}</th><th className="px-3 py-2">{es ? "Creado" : "Created"}</th><th className="px-3 py-2">{es ? "Estado" : "Status"}</th><th className="px-3 py-2">{es ? "Entrega" : "Delivery"}</th><th className="px-3 py-2">{es ? "Acción" : "Action"}</th></tr></thead><tbody>{data.recent.map((row, index) => <tr key={`${row.email}-${row.created_at}-${index}`} className="border-b border-slate-100"><td className="px-3 py-2">{row.email}</td><td className="px-3 py-2">{names[row.campaign]?.[es ? "es" : "en"] ?? row.campaign}</td><td className="px-3 py-2">{new Date(row.created_at).toLocaleString()}</td><td className="px-3 py-2">{row.reason === "superseded_or_unsubscribed" ? (es ? "Omitido: cambió la elegibilidad" : "Skipped: eligibility changed") : row.status ?? "pending"}</td><td className="px-3 py-2">{row.delivery ?? "—"}</td><td className="px-3 py-2">{row.action_within_7d ? (es ? "Sí" : "Yes") : "—"}</td></tr>)}</tbody></table></div>
      {data.recent.length === 0 && <p className="mt-3 text-sm text-slate-600">{es ? "Todavía no hay correos de esta secuencia." : "No emails in this sequence yet."}</p>}
    </>}
  </section>;
}
