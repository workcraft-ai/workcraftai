"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { LocalizedTree, useLanguage } from "@/app/components/LanguageProvider";
import { amountToCents, calculateEstimateMoney } from "@/lib/estimate-money.mjs";
import { getClientProEntitlement } from "@/lib/client-pro-access";

interface JobInvoice {
  id: string;
  estimate_id: string | null;
  title: string;
  client_name: string;
  client_email: string;
  job_address: string;
  scheduled_at: string | null;
  status: string;
  invoice_status: "draft" | "sent" | "paid";
  quoted_total: number;
  created_at: string;
}
interface InvoiceLine { id: string; description: string; quantity: number; unit?: string; unit_price: number }

const subscribeToLocation = () => () => {};
const cameFromEstimateOnClient = () => new URLSearchParams(window.location.search).get("from") === "estimate";
const cameFromEstimateOnServer = () => false;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function InvoicePage() {
  const params = useParams<{ id: string }>();
  const { language } = useLanguage();
  const cameFromEstimate = useSyncExternalStore(subscribeToLocation, cameFromEstimateOnClient, cameFromEstimateOnServer);
  const [job, setJob] = useState<JobInvoice | null>(null);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [invoiceEmailAddress, setInvoiceEmailAddress] = useState("");
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailNotice, setEmailNotice] = useState("");
  const [isPro, setIsPro] = useState(false);
  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const entitlement = await getClientProEntitlement();
      setIsPro(entitlement?.has_pro === true);
    }
    const { data, error: jobError } = await supabase.from("jobs").select("*").eq("id", params.id).single();
    if (jobError || !data) { setError("Job not found. Check that the operations migration has been applied and that you own this job."); setLoading(false); return; }
    setJob(data as JobInvoice);
    setInvoiceEmailAddress(String(data.client_email ?? ""));
    if (data.estimate_id) {
      const { data: estimate } = await supabase.from("estimates").select("selected_package").eq("id", data.estimate_id).maybeSingle();
      setSelectedPackage(estimate?.selected_package ?? null);
      const { data: itemData } = await supabase.from("line_items").select("id, description, quantity, unit, unit_price").eq("estimate_id", data.estimate_id);
      setLines((itemData ?? []) as InvoiceLine[]);
    }
    setLoading(false);
  }, [params.id]);
  useEffect(() => {
    const task = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const invoiceMoney = calculateEstimateMoney({}, lines);
  const lineItemTotalCents = invoiceMoney.subtotalCents;
  const subtotalCents = amountToCents(job?.quoted_total || 0) || lineItemTotalCents;
  const canSendInvoice = EMAIL_PATTERN.test(invoiceEmailAddress.trim());
  const setStatus = async (invoice_status: JobInvoice["invoice_status"]) => {
    if (!job) return;
    setSaving(true);
    const { error: updateError } = await supabase.from("jobs").update({ invoice_status, updated_at: new Date().toISOString() }).eq("id", job.id);
    if (updateError) setError("Could not update this invoice status. Please try again."); else setJob({ ...job, invoice_status });
    setSaving(false);
  };

  const sendInvoiceEmail = async () => {
    if (!job) return;
    setEmailSending(true);
    setError("");
    setEmailNotice("");
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/invoice-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: invoiceEmailAddress.trim(), language }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof result.error === "string" ? result.error : "Could not send the invoice email. Please try again.");
        return;
      }
      setJob({ ...job, invoice_status: "sent", client_email: invoiceEmailAddress.trim() });
      const remainingToday = Number(result.emailQuota?.remainingToday ?? 0);
      const remainingThisMonth = Number(result.emailQuota?.remainingThisMonth ?? 0);
      setEmailNotice(language === "es"
        ? `Resend aceptó el correo de factura para enviarlo a ${invoiceEmailAddress.trim()}. Te quedan ${remainingToday} hoy y ${remainingThisMonth} este mes.`
        : `Resend accepted the invoice email for delivery to ${invoiceEmailAddress.trim()}. ${remainingToday} left today and ${remainingThisMonth} this month.`);
      if (!result.statusUpdated) setEmailNotice((current) => `${current} ${language === "es" ? "Actualiza la página para ver el estado de la factura." : "Refresh to see the invoice status."}`);
    } catch {
      setError("Could not send the invoice email. Please try again.");
    } finally {
      setEmailSending(false);
    }
  };

  if (loading) return <main className="p-12 text-center text-sm text-slate-500">Preparing invoice…</main>;
  if (!job) return <main className="mx-auto max-w-xl p-8"><div className="rounded-xl border border-red-200 bg-white p-6 text-sm text-red-800">{error}</div></main>;

  const returnHref = cameFromEstimate && job.estimate_id
    ? `/estimate/${encodeURIComponent(job.estimate_id)}`
    : "/schedule";
  const returnLabel = returnHref === "/schedule" ? "← Back to jobs" : "← Back to estimate";

  return (
    <LocalizedTree>
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        {error && <p role="alert" className="print:hidden rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {emailNotice && <p role="status" aria-live="polite" className="print:hidden rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{emailNotice}</p>}
        <div className="print:hidden flex flex-wrap items-center justify-between gap-3">
          <Link href={returnHref} className="text-sm font-semibold text-blue-700 underline">{returnLabel}</Link>
          <div className="flex flex-wrap items-center gap-2">
            {isPro ? (
              <select aria-label="Invoice status" value={job.invoice_status} onChange={(event) => void setStatus(event.target.value as JobInvoice["invoice_status"])} className="min-h-12 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="draft">Draft</option><option value="sent">Sent</option><option value="paid">Paid</option>
              </select>
            ) : <Link href="/profile" className="self-center text-xs font-semibold text-blue-700 underline">Manage invoice status with Pro</Link>}
            {isPro && (
              <button type="button" aria-busy={emailSending} disabled={emailSending || !canSendInvoice} onClick={() => void sendInvoiceEmail()} className="min-h-12 rounded-lg bg-[#c85b2d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a94724] disabled:cursor-not-allowed disabled:opacity-60">
                {emailSending ? "Sending invoice email…" : job.invoice_status === "sent" ? "Resend invoice email" : "Send invoice email"}
              </button>
            )}
            <button disabled={saving || emailSending} onClick={() => window.print()} className="min-h-12 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">Print / Save PDF</button>
          </div>
        </div>
        {isPro && <p className="print:hidden text-right text-xs text-slate-500">{canSendInvoice
          ? language === "es" ? `Se enviará a ${invoiceEmailAddress.trim()}. Las respuestas del cliente llegarán al correo de tu cuenta.` : `This will be sent to ${invoiceEmailAddress.trim()}. Customer replies will go to your account email.`
          : language === "es" ? "Ingresa un correo válido del cliente para enviar esta factura." : "Enter a valid customer email address to send this invoice."}</p>}
        <article className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-10">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-blue-700">WorkCraft AI · Invoice</p><h1 className="mt-1 text-3xl font-bold">Invoice</h1><p className="mt-2 text-sm text-slate-500">Invoice for {job.title}</p></div><div className="text-right"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase text-slate-700">{job.invoice_status}</span><p className="mt-3 text-xs text-slate-500">Created {new Date(job.created_at).toLocaleDateString()}</p><p className="text-xs text-slate-500">Job status: {job.status.replaceAll("_", " ")}</p></div></header>
          <section className="grid gap-6 py-6 sm:grid-cols-2"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Bill to</p><p className="mt-2 font-semibold">{job.client_name || "Customer"}</p>{isPro ? <><label className="print:hidden mt-2 block text-xs font-semibold text-slate-600">Invoice email address<input type="email" inputMode="email" autoComplete="email" value={invoiceEmailAddress} onChange={(event) => setInvoiceEmailAddress(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900" /></label><p className="hidden text-sm text-slate-600 print:block">{invoiceEmailAddress}</p></> : <p className="text-sm text-slate-600">{job.client_email}</p>}<p className="text-sm text-slate-600">{job.job_address}</p></div><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Job</p><p className="mt-2 font-semibold">{job.title}</p><p className="text-sm text-slate-600">{job.scheduled_at ? new Date(job.scheduled_at).toLocaleDateString() : "Date not scheduled"}</p></div></section>
          {selectedPackage && <p className="mb-3 text-xs text-slate-500">This invoice reflects the accepted {selectedPackage} package. The lines below show the original estimate scope.</p>}
          <div className="overflow-hidden rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Description</th><th className="p-3 text-center">Qty / Unit</th><th className="p-3 text-right">Rate</th><th className="p-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-slate-100">{lines.length ? lines.map((item, index) => <tr key={item.id}><td className="p-3">{item.description}</td><td className="p-3 text-center">{item.quantity} {item.unit || "each"}</td><td className="p-3 text-right">${Number(item.unit_price).toFixed(2)}</td><td className="p-3 text-right font-semibold">${(invoiceMoney.lineItemCents[index] / 100).toFixed(2)}</td></tr>) : <tr><td className="p-4 text-slate-500" colSpan={4}>No line items are attached. Invoice total uses the saved job amount.</td></tr>}</tbody></table></div>
          <div className="ml-auto mt-5 max-w-xs border-t border-slate-200 pt-4"><div className="flex justify-between text-lg font-bold"><span>Total due</span><span>${(subtotalCents / 100).toFixed(2)}</span></div><p className="mt-2 text-xs text-slate-500">Customers can pay from the accepted estimate proposal link after you connect Stripe. Stripe sends payments directly to your connected account.</p>{job.estimate_id && <Link href={`/estimate/${encodeURIComponent(job.estimate_id)}`} className="mt-3 inline-block text-xs font-semibold text-blue-700 underline print:hidden">Open payment proposal</Link>}</div>
        </article>
      </div>
    </main>
    </LocalizedTree>
  );
}
