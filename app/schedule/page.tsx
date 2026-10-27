"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { readAllPages } from "@/lib/read-all-pages";
import { supabase } from "@/lib/supabase";
import { isLocalDateTimeAmbiguous, localDateTimeToIso, toLocalDateTimeInput } from "@/lib/localDateTime.mjs";
import { LocalizedTree, useLanguage } from "@/app/components/LanguageProvider";
import { ProPlanAction } from "@/app/components/ProPlanExperience";
import { getClientProEntitlement } from "@/lib/client-pro-access";
import { AddressMap } from "@/app/components/AddressMap";
import CalendarSyncSummary from "@/app/components/CalendarSyncSummary";

type JobStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
interface Job {
  id: string;
  estimate_id: string | null;
  title: string;
  client_name: string;
  client_email: string;
  job_address: string;
  scheduled_at: string | null;
  scheduled_end_at: string | null;
  schedule_timezone: string | null;
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
  const [durationHours, setDurationHours] = useState("2");
  const [notes, setNotes] = useState("");

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setIsPro(false); setLoading(false); return; }
    const entitlement = await getClientProEntitlement();
    const pro = entitlement?.has_pro === true;
    setIsPro(pro);
    if (!pro) { setJobs([]); setEstimates([]); setLoading(false); return; }
    const [jobsResult, estimatesResult] = await Promise.all([
      readAllPages((from, to) => supabase.from("jobs").select("*").order("scheduled_at", { ascending: true, nullsFirst: false }).order("id").range(from, to)),
      readAllPages((from, to) => supabase.from("estimates").select("id, client_name, client_email, job_address, trade, converted_job_id").in("status", ["accepted", "paid"]).is("converted_job_id", null).order("created_at", { ascending: false }).order("id").range(from, to)),
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
    let refreshTimer: number | undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => { void loadData(); }, 250);
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
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
    if (scheduledAt && !scheduledIso) { setError(isLocalDateTimeAmbiguous(scheduledAt) ? "That local time occurs twice because of the daylight-saving clock change. Choose a different time." : "That local time does not exist because of the daylight-saving clock change. Choose a different time."); setSaving(false); return; }
    const durationMinutes = Number(durationHours) * 60;
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 72 * 60) { setError("Choose a job duration between 15 minutes and 72 hours."); setSaving(false); return; }
    const scheduledEndIso = scheduledIso ? new Date(new Date(scheduledIso).getTime() + durationMinutes * 60_000).toISOString() : null;
    const scheduleTimezone = scheduledIso ? localTimeZone : null;

    if (estimateId) {
      const { data: convertedJobId, error: convertError } = await supabase.rpc("convert_accepted_estimate_to_job", {
        p_estimate_id: estimateId,
        p_scheduled_at: scheduledIso,
        p_title: title,
        p_notes: notes,
      });
      if (convertError) setError(convertError.message.includes("ESTIMATE_NOT_APPROVED")
        ? "Only an approved estimate can be scheduled as a job."
        : "Could not create this job from the estimate. Please try again.");
      else {
        if (convertedJobId && scheduledIso) {
          const { error: timingError } = await supabase.from("jobs")
            .update({ scheduled_end_at: scheduledEndIso, schedule_timezone: scheduleTimezone, updated_at: new Date().toISOString() })
            .eq("id", convertedJobId).eq("user_id", user.id);
          if (timingError) setError("The job was created, but its calendar duration could not be saved. Set the duration on the job board.");
        }
        setShowForm(false);
        setEstimateId(""); setTitle(""); setClientName(""); setClientEmail(""); setJobAddress(""); setScheduledAt(""); setDurationHours("2"); setNotes("");
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
      scheduled_end_at: scheduledEndIso,
      schedule_timezone: scheduleTimezone,
      notes,
      quoted_total: 0,
      status: "scheduled",
    });
    if (insertError) setError("Could not create this job. Please check the details and try again.");
    else {
      setShowForm(false);
      setEstimateId(""); setTitle(""); setClientName(""); setClientEmail(""); setJobAddress(""); setScheduledAt(""); setDurationHours("2"); setNotes("");
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
    if (localDate && !scheduled_at) { setError(isLocalDateTimeAmbiguous(localDate) ? "That local time occurs twice because of the daylight-saving clock change. Choose a different time." : "That local time does not exist because of the daylight-saving clock change. Choose a different time."); return; }
    const currentJob = jobs.find((job) => job.id === id);
    const oldDuration = currentJob?.scheduled_at && currentJob.scheduled_end_at
      ? new Date(currentJob.scheduled_end_at).getTime() - new Date(currentJob.scheduled_at).getTime() : 2 * 60 * 60 * 1000;
    const duration = oldDuration > 0 && oldDuration <= 72 * 60 * 60 * 1000 ? oldDuration : 2 * 60 * 60 * 1000;
    const scheduled_end_at = scheduled_at ? new Date(new Date(scheduled_at).getTime() + duration).toISOString() : null;
    const schedule_timezone = scheduled_at ? localTimeZone : null;
    const { error: updateError } = await supabase.from("jobs").update({ scheduled_at, scheduled_end_at, schedule_timezone, updated_at: new Date().toISOString() }).eq("id", id);
    if (updateError) setError("Could not update this job. Please try again.");
    else setJobs((current) => current.map((job) => job.id === id ? { ...job, scheduled_at, scheduled_end_at, schedule_timezone } : job).sort((a, b) => (a.scheduled_at || "9999").localeCompare(b.scheduled_at || "9999")));
  };

  const updateDuration = async (id: string, rawHours: string) => {
    const job = jobs.find((item) => item.id === id);
    if (!job?.scheduled_at) return;
    const minutes = Number(rawHours) * 60;
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 72 * 60) { setError("Choose a job duration between 15 minutes and 72 hours."); return; }
    const scheduled_end_at = new Date(new Date(job.scheduled_at).getTime() + minutes * 60_000).toISOString();
    const { error: updateError } = await supabase.from("jobs").update({ scheduled_end_at, updated_at: new Date().toISOString() }).eq("id", id);
    if (updateError) setError("Could not update the job duration. Please try again.");
    else setJobs((current) => current.map((item) => item.id === id ? { ...item, scheduled_end_at } : item));
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
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const nextJob = jobs
    .filter((job) => job.job_address?.trim() && (job.status === "in_progress" || (job.status === "scheduled" && job.scheduled_at && new Date(job.scheduled_at) >= startOfToday)))
    .sort((a, b) => {
      if (a.status === "in_progress" && b.status !== "in_progress") return -1;
      if (b.status === "in_progress" && a.status !== "in_progress") return 1;
      return (a.scheduled_at || "9999").localeCompare(b.scheduled_at || "9999");
    })[0];

  return (
    <LocalizedTree>
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {!loading && !isPro ? <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-blue-700">WorkCraft AI Pro</p>
          <h1 className="mt-2 text-2xl font-bold">Scheduling and job tracking are Pro features</h1>
          <p className="mt-3 text-sm text-slate-600">Upgrade to schedule jobs, track job costs, and manage invoice status. Your existing data is preserved and available again if Pro is reactivated.</p>
          <ProPlanAction className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-800" />
        </section> : <>
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-orange-800">Operations</p>
            <h1 className="mt-1 text-2xl font-bold">Schedule & job tracking</h1>
            <p className="mt-1 text-sm text-slate-600">Plan upcoming work and keep every job moving.</p>
          </div>
          <button type="button" onClick={() => setShowForm((open) => !open)} className={showForm ? "inline-flex min-h-12 items-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700" : "inline-flex min-h-12 items-center rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"}>{showForm ? "Close" : "+ Schedule a job"}</button>
        </header>

        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <section className="grid gap-4 sm:grid-cols-3">
          <Metric label="Active jobs" value={String(activeCount)} />
          <Metric label="On the schedule today" value={String(todayCount)} />
          <Metric label="Completed jobs" value={String(jobs.filter((job) => job.status === "completed").length)} />
        </section>

        <CalendarSyncSummary />

        {nextJob && <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm" aria-labelledby="next-job-heading">
          <p className="text-xs font-bold uppercase tracking-wide text-blue-800">{language === "es" ? "Próximo destino" : "Next destination"}</p>
          <h2 id="next-job-heading" className="mt-1 text-lg font-semibold text-slate-900">{nextJob.title}</h2>
          <p className="mt-1 text-sm text-slate-700">{nextJob.client_name ? `${nextJob.client_name} · ` : ""}{nextJob.job_address}</p>
          <p className="mt-1 text-sm text-slate-600">{nextJob.status === "in_progress" ? (language === "es" ? "En curso" : "In progress") : nextJob.scheduled_at ? new Date(nextJob.scheduled_at).toLocaleString(locale) : ""}</p>
          <div className="mt-4"><AddressMap address={nextJob.job_address} language={language} /></div>
        </section>}

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
              <Field label={language === "es" ? "Duración estimada (horas)" : "Estimated duration (hours)"}><input type="number" min="0.25" max="72" step="0.25" value={durationHours} onChange={(event) => setDurationHours(event.target.value)} className={inputClass} /></Field>
            </div>
            <p className="text-xs text-slate-600">{language === "es" ? "Zona horaria" : "Time zone"}: {localTimeZone}. {language === "es" ? "El trabajo guarda esta zona horaria y la duración indicada arriba." : "The job saves this time zone and the duration above."}</p>
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
                    {job.job_address?.trim() && <div className="mt-3"><AddressMap address={job.job_address} language={language} compact /></div>}
                    <label className="mt-2 inline-flex items-center gap-2 text-[11px] font-medium text-slate-600" title={`${language === "es" ? "Zona horaria" : "Time zone"}: ${localTimeZone}`}>{language === "es" ? "Reprogramar" : "Reschedule"} ({localTimeZone})<input type="datetime-local" defaultValue={toLocalDateTimeInput(job.scheduled_at)} onBlur={(event) => { const value = event.target.value; if (value !== toLocalDateTimeInput(job.scheduled_at)) void updateSchedule(job.id, value); }} className="min-h-12 rounded-md border border-slate-300 bg-white px-2 py-2 text-xs" /></label>
                    {job.scheduled_at && <label className="ml-2 mt-2 inline-flex items-center gap-2 text-[11px] font-medium text-slate-600">{language === "es" ? "Duración (horas)" : "Duration (hours)"}<input type="number" min="0.25" max="72" step="0.25" defaultValue={jobDurationHours(job)} onBlur={(event) => { if (Number(event.target.value) !== jobDurationHours(job)) void updateDuration(job.id, event.target.value); }} className="min-h-12 w-24 rounded-md border border-slate-300 bg-white px-2 py-2 text-xs" /></label>}
                    {job.scheduled_at && <p className="mt-1 text-xs text-slate-500">{language === "es" ? "Zona horaria guardada" : "Saved time zone"}: {job.schedule_timezone || (language === "es" ? "No registrada (trabajo anterior)" : "Not recorded (older job)")}</p>}
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

function jobDurationHours(job: Job): number {
  if (!job.scheduled_at || !job.scheduled_end_at) return 2;
  const hours = (new Date(job.scheduled_end_at).getTime() - new Date(job.scheduled_at).getTime()) / 3_600_000;
  return Number.isFinite(hours) && hours > 0 ? hours : 2;
}
