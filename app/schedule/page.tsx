"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { localDateTimeToIso, toLocalDateTimeInput } from "@/lib/localDateTime.mjs";
import { LocalizedTree, useLanguage } from "@/app/components/LanguageProvider";
import { getClientProEntitlement } from "@/lib/client-pro-access";

type JobStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
interface Job {
  id: string;
  estimate_id: string | null;
  title: string;
  client_name: string;
  client_email: string;
  job_address: string;
  scheduled_at: string | null;
  status: JobStatus;
  notes: string;
  quoted_total: number;
  actual_cost: number;
}
interface Estimate {
  id: string;
  client_name: string;
  client_email: string;
  job_address: string;
  trade: string;
  converted_job_id: string | null;
}

const statusLabels: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function SchedulePage() {
  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { language } = useLanguage();
  const locale = language === "es" ? "es-US" : "en-US";
  const [jobs, setJobs] = useState<Job[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPro, setIsPro] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [estimateId, setEstimateId] = useState("");
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [jobAddress, setJobAddress] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setIsPro(false); setLoading(false); return; }
    const entitlement = await getClientProEntitlement();
    const pro = entitlement?.has_pro === true;
    setIsPro(pro);
    if (!pro) { setJobs([]); setEstimates([]); setLoading(false); return; }
    const [jobsResult, estimatesResult] = await Promise.all([
      supabase.from("jobs").select("*").order("scheduled_at", { ascending: true, nullsFirst: false }),
      supabase.from("estimates").select("id, client_name, client_email, job_address, trade, converted_job_id").eq("status", "accepted").is("converted_job_id", null).order("created_at", { ascending: false }),
    ]);
    if (jobsResult.error) setError("Could not load jobs. Refresh the page or contact support if the problem continues.");
    else setJobs((jobsResult.data ?? []) as Job[]);
    if (!estimatesResult.error) setEstimates((estimatesResult.data ?? []) as Estimate[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(task);
  }, [loadData]);

  useEffect(() => {
    const targetEstimate = new URLSearchParams(window.location.search).get("estimate");
    if (!targetEstimate || !estimates.length) return;
    const acceptedEstimate = estimates.find((estimate) => estimate.id === targetEstimate);
    if (acceptedEstimate) {
      startTransition(() => {
        setEstimateId(acceptedEstimate.id);
        setClientName(acceptedEstimate.client_name ?? "");
        setClientEmail(acceptedEstimate.client_email ?? "");
        setJobAddress(acceptedEstimate.job_address ?? "");
        setTitle(`${acceptedEstimate.client_name || "Customer"} ${acceptedEstimate.trade || "service"} job`);
        setShowForm(true);
      });
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [estimates]);

  const chooseEstimate = (id: string) => {
    setEstimateId(id);
    const estimate = estimates.find((item) => item.id === id);
    if (!estimate) return;
    setClientName(estimate.client_name ?? "");
    setClientEmail(estimate.client_email ?? "");
    setJobAddress(estimate.job_address ?? "");
    setTitle(`${estimate.client_name || "Customer"} job`);
  };

  const createJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Sign in to schedule jobs."); setSaving(false); return; }
    const scheduledIso = localDateTimeToIso(scheduledAt);
    if (scheduledAt && !scheduledIso) { setError("That local time does not exist because of the daylight-saving clock change. Choose a different time."); setSaving(false); return; }

    if (estimateId) {
      const { error: convertError } = await supabase.rpc("convert_accepted_estimate_to_job", {
        p_estimate_id: estimateId,
        p_scheduled_at: scheduledIso,
        p_title: title,
        p_notes: notes,
      });
      if (convertError) setError(convertError.message.includes("ESTIMATE_NOT_APPROVED")
        ? "Only an approved estimate can be scheduled as a job."
        : "Could not create this job from the estimate. Please try again.");
      else {
        setShowForm(false);
        setEstimateId(""); setTitle(""); setClientName(""); setClientEmail(""); setJobAddress(""); setScheduledAt(""); setNotes("");
        await loadData();
      }
      setSaving(false);
      return;
    }
    const { error: insertError } = await supabase.from("jobs").insert({
      user_id: user.id,
      estimate_id: null,
      title,
      client_name: clientName,
      client_email: clientEmail,
      job_address: jobAddress,
      scheduled_at: scheduledIso,
      notes,
      quoted_total: 0,
      status: "scheduled",
    });
    if (insertError) setError("Could not create this job. Please check the details and try again.");
    else {
      setShowForm(false);
      setEstimateId(""); setTitle(""); setClientName(""); setClientEmail(""); setJobAddress(""); setScheduledAt(""); setNotes("");
      await loadData();
    }
    setSaving(false);
  };

  const updateStatus = async (id: string, status: JobStatus) => {
    const { error: updateError } = await supabase.from("jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (updateError) setError("Could not update this job. Please try again.");
    else setJobs((current) => current.map((job) => job.id === id ? { ...job, status } : job));
  };

  const updateSchedule = async (id: string, localDate: string) => {
    const scheduled_at = localDateTimeToIso(localDate);
    if (localDate && !scheduled_at) { setError("That local time does not exist because of the daylight-saving clock change. Choose a different time."); return; }
    const { error: updateError } = await supabase.from("jobs").update({ scheduled_at, updated_at: new Date().toISOString() }).eq("id", id);
    if (updateError) setError("Could not update this job. Please try again.");
    else setJobs((current) => current.map((job) => job.id === id ? { ...job, scheduled_at } : job).sort((a, b) => (a.scheduled_at || "9999").localeCompare(b.scheduled_at || "9999")));
  };

  const updateActualCost = async (id: string, rawCost: string) => {
    const actual_cost = Math.max(0, Number(rawCost) || 0);
    const { error: updateError } = await supabase.from("jobs").update({ actual_cost, updated_at: new Date().toISOString() }).eq("id", id);
    if (updateError) setError("Could not update this job. Please try again.");
    else setJobs((current) => current.map((job) => job.id === id ? { ...job, actual_cost } : job));
  };

  const deleteJob = async (id: string) => {
    const { error: deleteError } = await supabase.from("jobs").delete().eq("id", id);
    if (deleteError) setError("Could not delete this job. Please try again.");
    else setJobs((current) => current.filter((job) => job.id !== id));
  };

  const activeCount = jobs.filter((job) => job.status === "scheduled" || job.status === "in_progress").length;
  const today = new Date().toDateString();
  const todayCount = jobs.filter((job) => job.scheduled_at && new Date(job.scheduled_at).toDateString() === today && job.status !== "cancelled").length;

  return (
    <LocalizedTree>
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {!loading && !isPro ? <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-blue-700">WorkCraft AI Pro</p>
          <h1 className="mt-2 text-2xl font-bold">Scheduling and job tracking are Pro features</h1>
          <p className="mt-3 text-sm text-slate-600">Upgrade to schedule jobs, track job costs, and manage invoice status. Your existing data is preserved and available again if Pro is reactivated.</p>
          <Link href="/profile" className="mt-5 inline-flex rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">View plans and upgrade</Link>
        </section> : <>
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-blue-700">Operations</p>
            <h1 className="mt-1 text-2xl font-bold">Schedule & job tracking</h1>
            <p className="mt-1 text-sm text-slate-600">Plan upcoming work and keep every job moving.</p>
          </div>
          <button onClick={() => setShowForm((open) => !open)} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">{showForm ? "Close" : "+ Schedule a job"}</button>
        </header>

        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <section className="grid gap-4 sm:grid-cols-3">
          <Metric label="Active jobs" value={String(activeCount)} />
          <Metric label="On the schedule today" value={String(todayCount)} />
          <Metric label="Completed jobs" value={String(jobs.filter((job) => job.status === "completed").length)} />
        </section>

        {showForm && (
          <form onSubmit={createJob} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Schedule work</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From estimate (optional)">
                <select value={estimateId} onChange={(event) => chooseEstimate(event.target.value)} className={inputClass}>
                  <option value="">Create a job without an estimate</option>
                  {estimates.map((estimate) => <option key={estimate.id} value={estimate.id}>{estimate.client_name} · {estimate.job_address || estimate.client_email}</option>)}
                </select>
              </Field>
              <Field label="Job name"><input required value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} placeholder="Replace kitchen faucet" /></Field>
              <Field label="Customer"><input value={clientName} onChange={(event) => setClientName(event.target.value)} className={inputClass} /></Field>
              <Field label="Customer email"><input type="email" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} className={inputClass} /></Field>
              <Field label="Job address"><input value={jobAddress} onChange={(event) => setJobAddress(event.target.value)} className={inputClass} /></Field>
              <Field label="Date and time"><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className={inputClass} /></Field>
            </div>
            <Field label="Job notes"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} className={`${inputClass} min-h-24`} placeholder="Access details, materials to bring, or customer requests" /></Field>
            <button disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60">{saving ? "Saving…" : "Save scheduled job"}</button>
          </form>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">Job board</h2></div>
          {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading jobs…</p> : jobs.length === 0 ? (
            <div className="p-10 text-center"><p className="font-semibold">No jobs scheduled yet</p><p className="mt-1 text-sm text-slate-500">Create a job or schedule work from one of your estimates.</p></div>
          ) : (
            <div className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <article key={job.id} className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{job.title}</h3><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{statusLabels[job.status]}</span></div>
                    <p className="mt-1 text-sm text-slate-600">{job.client_name || "No customer"}{job.job_address ? ` · ${job.job_address}` : ""}</p>
                    <p className="mt-1 text-xs text-slate-500">{job.scheduled_at ? new Date(job.scheduled_at).toLocaleString(locale) : "No date set"}{job.quoted_total ? ` · ${new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(Number(job.quoted_total))}` : ""}</p>
                    <label className="mt-2 inline-flex items-center gap-2 text-[11px] font-medium text-slate-600" title={`Times use ${localTimeZone}`}>Reschedule ({localTimeZone})<input type="datetime-local" defaultValue={toLocalDateTimeInput(job.scheduled_at)} onBlur={(event) => { const value = event.target.value; if (value !== toLocalDateTimeInput(job.scheduled_at)) void updateSchedule(job.id, value); }} className="min-h-12 rounded-md border border-slate-300 bg-white px-2 py-2 text-xs" /></label>
                    {job.notes && <p className="mt-2 text-sm text-slate-600">{job.notes}</p>}
                    <label className="mt-2 inline-flex items-center gap-2 text-[11px] font-medium text-slate-600">Actual job cost<input type="number" min="0" step="0.01" defaultValue={Number(job.actual_cost || 0)} onBlur={(event) => { if (Number(event.target.value) !== Number(job.actual_cost || 0)) void updateActualCost(job.id, event.target.value); }} className="w-28 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs" /></label>
                    {job.estimate_id && <Link href={`/estimate/${job.estimate_id}`} className="mt-2 inline-block text-xs font-semibold text-blue-700 underline">Open estimate</Link>}
                    <Link href={`/invoice/${job.id}`} className="ml-3 mt-2 inline-block text-xs font-semibold text-blue-700 underline">Create / view invoice</Link>
                  </div>
                  <label className="text-xs text-slate-600">Update status <select value={job.status} onChange={(event) => void updateStatus(job.id, event.target.value as JobStatus)} className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <button onClick={() => void deleteJob(job.id)} className="text-left text-xs font-semibold text-red-700 underline md:text-right">Delete job</button>
                </article>
              ))}
            </div>
          )}
        </section>
        </>}
      </div>
    </main>
    </LocalizedTree>
  );
}

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5 text-xs font-medium text-slate-700"><span>{label}</span>{children}</label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-slate-900">{value}</p></div>;
}
