"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { LocalizedTree, translate, useLanguage } from "@/app/components/LanguageProvider";
import { getClientProEntitlement } from "@/lib/client-pro-access";

type GreetingKey = "Good morning" | "Good afternoon" | "Good evening";

function getGreetingKey(hour: number): GreetingKey {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

interface Estimate {
  id: string;
  client_name: string;
  client_email: string;
  job_address: string;
  status: string;
  require_deposit: boolean;
  deposit_percentage: number;
  is_archived: boolean;
  created_at: string;
  followup_at: string | null;
  followup_sent_at: string | null;
  proposal_viewed_at: string | null;
}

type EstimateStatus = "pending" | "accepted" | "paid" | "declined";
const estimateStatuses: EstimateStatus[] = ["pending", "accepted", "paid", "declined"];
type EmailAllowance = { daily_used: number; daily_limit: number; monthly_used: number; monthly_limit: number };

interface ProposalQuestion { id: string; estimate_id: string; customer_name: string; customer_email: string; message: string; created_at: string; read_at: string | null; }

function estimateEmailEventLabel(event: string) {
  switch (event) {
    case "sent": return "Email sent";
    case "delivered": return "Email delivered";
    case "delivery_delayed": return "Email delivery delayed";
    case "bounced": return "Email bounced";
    case "complained": return "Email marked as spam";
    case "follow_up_sent": return "Follow-up sent";
    case "proposal_viewed": return "Proposal viewed";
    default: return event.replaceAll("_", " ");
  }
}

export default function DashboardPage() {
  const { language } = useLanguage();
  const locale = language === "es" ? "es-US" : "en-US";
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState<"active" | "archived">("active");
  const [isPro, setIsPro] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);
  const [sendMessage, setSendMessage] = useState("");
  const [emailEvents, setEmailEvents] = useState<Record<string, string>>({});
  const [questions, setQuestions] = useState<ProposalQuestion[]>([]);
  const [firstName, setFirstName] = useState("");
  const [greetingKey, setGreetingKey] = useState<GreetingKey | null>(null);
  const [emailAllowance, setEmailAllowance] = useState<EmailAllowance | null>(null);

  async function fetchEstimates() {
    try {
      const { data, error } = await supabase
        .from("estimates")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setEstimates(data || []);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const fullName = user.user_metadata?.full_name;
        setFirstName(typeof fullName === "string" ? fullName.trim().split(/\s+/)[0] ?? "" : "");
        const entitlement = await getClientProEntitlement();
        setIsPro(entitlement?.has_pro === true);
        void fetch("/api/account/usage", { cache: "no-store" }).then(async (response) => {
          if (!response.ok) return;
          const usage = await response.json();
          if (usage.email) setEmailAllowance(usage.email as EmailAllowance);
        }).catch(() => {});
      } else {
        setFirstName("");
        setEmailAllowance(null);
      }
      const { data: events } = await supabase.from("estimate_email_events").select("estimate_id, event, created_at").order("created_at", { ascending: false });
      const { data: questionRows } = await supabase.from("proposal_questions").select("id, estimate_id, customer_name, customer_email, message, created_at, read_at").order("created_at", { ascending: false }).limit(20);
      setQuestions((questionRows ?? []) as ProposalQuestion[]);
      const latest: Record<string, string> = {};
      for (const event of events ?? []) if (!latest[event.estimate_id]) latest[event.estimate_id] = event.event;
      setEmailEvents(latest);
    } catch (err: unknown) {
      console.error("Error fetching dashboard estimates:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const task = window.setTimeout(() => { void fetchEstimates(); }, 0);
    return () => window.clearTimeout(task);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => {
      setGreetingKey(getGreetingKey(new Date().getHours()));
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  const markQuestionRead = async (question: ProposalQuestion) => {
    const readAt = new Date().toISOString();
    const { error } = await supabase.from("proposal_questions").update({ read_at: readAt }).eq("id", question.id);
    if (!error) setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, read_at: readAt } : item));
  };

  const sendEstimate = async (id: string) => {
    setSendingId(id); setSendMessage("");
    try {
      const response = await fetch(`/api/estimates/${id}/send`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Email could not be sent.");
      setEmailEvents((current) => ({ ...current, [id]: "sent" }));
      if (typeof result.emailQuota?.remainingToday === "number" && typeof result.emailQuota?.remainingThisMonth === "number") {
        setEmailAllowance((current) => current ? {
          ...current,
          daily_used: current.daily_limit - result.emailQuota.remainingToday,
          monthly_used: current.monthly_limit - result.emailQuota.remainingThisMonth,
        } : current);
      }
      setSendMessage(typeof result.emailQuota?.remainingToday === "number" && typeof result.emailQuota?.remainingThisMonth === "number"
        ? `Estimate email sent. ${result.emailQuota.remainingToday} Pro emails remain today and ${result.emailQuota.remainingThisMonth} this month.`
        : "Estimate email sent.");
    } catch (error) {
      setSendMessage(error instanceof Error ? error.message : "Email could not be sent.");
      void fetch("/api/account/usage", { cache: "no-store" }).then(async (usageResponse) => {
        if (!usageResponse.ok) return;
        const usage = await usageResponse.json();
        if (usage.email) setEmailAllowance(usage.email as EmailAllowance);
      }).catch(() => {});
    } finally { setSendingId(null); }
  };

  const updateEstimateStatus = async (id: string, status: EstimateStatus) => {
    setStatusSavingId(id);
    setSendMessage("");
    try {
      const { error } = await supabase.rpc("workcraft_update_estimate_status", {
        p_estimate_id: id,
        p_status: status,
      });
      if (error) {
        setSendMessage(error.message.includes("SIGNED_APPROVAL_STATUS_LOCKED")
          ? "A customer-approved estimate can only stay accepted or be marked paid."
          : "Could not update estimate status. Please try again.");
      } else {
        setEstimates((current) => current.map((estimate) => estimate.id === id ? { ...estimate, status } : estimate));
        setSendMessage("Estimate status updated.");
      }
    } catch {
      setSendMessage("Could not update estimate status. Please try again.");
    } finally {
      setStatusSavingId(null);
    }
  };

  const toggleArchiveStatus = async (id: string, shouldArchive: boolean) => {
    try {
      const { error } = await supabase
        .from("estimates")
        .update({ is_archived: shouldArchive })
        .eq("id", id);

      if (error) throw error;

      setEstimates((prev) =>
        prev.map((est) =>
          est.id === id ? { ...est, is_archived: shouldArchive } : est
        )
      );
    } catch (err: unknown) {
      alert("Error updating estimate: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const deleteEstimate = async (id: string) => {
    if (!confirm("Are you sure you want to permanently delete this estimate?")) {
      return;
    }

    try {
      // First delete associated line items
      const { error: lineError } = await supabase
        .from("line_items")
        .delete()
        .eq("estimate_id", id);

      if (lineError) throw lineError;

      // Then delete the estimate
      const { error: estError } = await supabase
        .from("estimates")
        .delete()
        .eq("id", id);

      if (estError) throw estError;

      setEstimates((prev) => prev.filter((est) => est.id !== id));
    } catch (err: unknown) {
      alert("Error deleting estimate: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const filteredEstimates = estimates.filter((est) =>
    currentTab === "active" ? !est.is_archived : est.is_archived
  );

  return (
    <LocalizedTree>
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {greetingKey
                ? `${translate(language, greetingKey)}${firstName ? `, ${firstName}` : ""}`
                : "WorkCraft AI Dashboard"}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage estimates, tracking, and payments
            </p>
          </div>
          <Link
            href="/estimate/new"
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors shadow-sm"
          >
            + New Estimate
          </Link>
        </div>

        <nav aria-label="Business tools" className="grid gap-3 sm:grid-cols-3">
          <ToolLink href="/schedule" title="Schedule & jobs" description="Plan work and track job progress" />
          <ToolLink href="/pricebook" title="Price book & templates" description="Save your rates and reusable scopes" />
          <ToolLink href="/reports" title="Reports" description="See estimate pipeline and job totals" />
        </nav>
        {isPro && emailAllowance && <p role="status" className={`rounded-lg border bg-white px-4 py-3 text-sm ${Math.max(emailAllowance.daily_limit - emailAllowance.daily_used, 0) === 0 || Math.max(emailAllowance.monthly_limit - emailAllowance.monthly_used, 0) === 0 ? "border-red-200 font-semibold text-red-800" : Math.max(emailAllowance.daily_limit - emailAllowance.daily_used, 0) <= 1 || Math.max(emailAllowance.monthly_limit - emailAllowance.monthly_used, 0) <= 20 ? "border-amber-200 font-semibold text-amber-800" : "border-slate-200 text-slate-700"}`}>
          {translate(language, `Customer email allowance: ${Math.max(emailAllowance.daily_limit - emailAllowance.daily_used, 0)} of ${emailAllowance.daily_limit} left today · ${Math.max(emailAllowance.monthly_limit - emailAllowance.monthly_used, 0)} of ${emailAllowance.monthly_limit} left this month (UTC).`)}
        </p>}
        {sendMessage && <p role="status" className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{sendMessage}</p>}

        {questions.length > 0 && <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><h2 className="text-base font-bold text-slate-900">Customer questions</h2><span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-800">{`${questions.filter((item) => !item.read_at).length} unread`}</span></div>
          <div className="mt-3 divide-y divide-slate-100">{questions.map((question) => <article key={question.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-slate-900">{question.customer_name} <span className="font-normal text-slate-500">· {new Date(question.created_at).toLocaleString(locale)}</span></p><a className="inline-flex min-h-11 items-center text-xs text-blue-700 underline" href={`mailto:${encodeURIComponent(question.customer_email)}`} target="_blank" rel="noopener noreferrer">{question.customer_email}</a><p className="mt-1 text-xs text-slate-500">Click the customer’s email to reply from your email app.</p><p className="mt-1 text-sm text-slate-700">{question.message}</p></div><div className="flex gap-3 text-xs"><Link href={`/estimate/${encodeURIComponent(question.estimate_id)}`} className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline">View proposal</Link>{!question.read_at && <button type="button" onClick={() => void markQuestionRead(question)} className="inline-flex min-h-11 items-center font-semibold text-slate-600 underline">Mark read</button>}</div></div>
          </article>)}</div>
        </section>}

        {/* Dashboard Content Container */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Header Controls & Filter Tabs */}
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <div className="flex space-x-2">
              <button
                onClick={() => setCurrentTab("active")}
                className={`inline-flex min-h-11 items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  currentTab === "active"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-200/60"
                }`}
              >
                Active Estimates ({estimates.filter((e) => !e.is_archived).length})
              </button>
              <button
                onClick={() => setCurrentTab("archived")}
                className={`inline-flex min-h-11 items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  currentTab === "archived"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-200/60"
                }`}
              >
                Archived ({estimates.filter((e) => e.is_archived).length})
              </button>
            </div>
          </div>

          {/* Estimates Table */}
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Loading estimates...
            </div>
          ) : filteredEstimates.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              {currentTab === "active"
                ? "No active estimates found."
                : "No archived estimates found."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase font-semibold">
                  <tr>
                    <th className="p-3.5">Client</th>
                    <th className="p-3.5">Job Location</th>
                    <th className="p-3.5">Created</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEstimates.map((est) => (
                    <tr key={est.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-3.5">
                        <p className="font-semibold text-slate-900">{est.client_name}</p>
                        <p className="text-xs text-slate-500">{est.client_email}</p>
                      </td>
                      <td className="p-3.5 text-slate-600">
                        {est.job_address || "—"}
                      </td>
                      <td className="p-3.5 text-slate-500 text-xs">
                        {new Date(est.created_at).toLocaleDateString(locale)}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full font-semibold uppercase ${
                            est.status === "paid" || est.status === "accepted"
                              ? "bg-green-100 text-green-800 border border-green-200"
                              : "bg-yellow-100 text-yellow-800 border border-yellow-200"
                          }`}
                        >
                          {translate(language, est.status)}
                        </span>
                        <label className="mt-2 block">
                          <span className="sr-only">Change estimate status</span>
                          <select
                            aria-label={`${translate(language, "Change estimate status")} — ${est.client_name}`}
                            value={estimateStatuses.includes(est.status.toLowerCase() as EstimateStatus) ? est.status.toLowerCase() : "pending"}
                            disabled={statusSavingId !== null}
                            onChange={(event) => void updateEstimateStatus(est.id, event.target.value as EstimateStatus)}
                            className="min-h-11 max-w-36 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-60"
                          >
                            {estimateStatuses.map((status) => <option key={status} value={status}>{translate(language, status[0].toUpperCase() + status.slice(1))}</option>)}
                          </select>
                        </label>
                      </td>
                      <td className="p-3.5 text-right space-x-3">
                        <Link
                          href={`/estimate/${est.id}`}
                          className="inline-flex min-h-11 items-center text-xs font-semibold text-blue-600 hover:text-blue-500 underline"
                        >
                          View Link
                        </Link>
                        {isPro ? <button onClick={() => void sendEstimate(est.id)} disabled={sendingId === est.id} className="inline-flex min-h-11 items-center text-xs font-semibold text-blue-700 underline disabled:opacity-50">{sendingId === est.id ? "Sending…" : emailEvents[est.id] ? "Resend email" : "Email client"}</button> : <Link href="/profile" className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap text-xs font-semibold text-slate-600 underline" aria-label="Email client is a Pro feature">Email client <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-800 no-underline">Pro</span></Link>}
                        {emailEvents[est.id] && <span className="text-[10px] font-semibold uppercase text-slate-500">{estimateEmailEventLabel(emailEvents[est.id])}</span>}
                        {est.followup_at && <span className="text-[10px] text-slate-500">{est.followup_sent_at ? "Follow-up sent" : `Follow-up ${new Date(est.followup_at).toLocaleDateString(locale)}`}</span>}
                        {est.proposal_viewed_at && <span className="text-[10px] font-semibold text-green-700">Viewed</span>}

                        {est.is_archived ? (
                          <button
                            onClick={() => toggleArchiveStatus(est.id, false)}
                            className="inline-flex min-h-11 items-center text-xs font-semibold text-slate-600 hover:text-slate-900 underline"
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleArchiveStatus(est.id, true)}
                            className="inline-flex min-h-11 items-center text-xs font-semibold text-slate-500 hover:text-slate-700 underline"
                          >
                            Archive
                          </button>
                        )}

                        <button
                          onClick={() => deleteEstimate(est.id)}
                          className="inline-flex min-h-11 items-center text-xs font-semibold text-red-600 hover:text-red-500 underline"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Status changes are for your records and reports. They do not create a customer signature or process a payment.
          </p>
        </div>
      </div>
    </div>
    </LocalizedTree>
  );
}

function ToolLink({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link href={href} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
      <span className="text-sm font-semibold text-slate-900">{title}</span>
      <span className="mt-1 block text-xs text-slate-500">{description}</span>
    </Link>
  );
}
