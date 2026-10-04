"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { LocalizedTree, type Language } from "@/app/components/LanguageProvider";

interface LineItem {
  id: string;
  description: string;
  description_es?: string | null;
  quantity: number;
  unit_price: number;
}

interface Estimate {
  id: string;
  client_name: string;
  client_email: string;
  client_phone?: string;
  job_address?: string;
  status: string;
  require_deposit: boolean;
  deposit_percentage: number;
  tax_rate: number;
  markup_percentage: number;
  proposal_language: Language;
  created_at: string;
  package_options?: EstimatePackage[];
  signature_name?: string | null;
  selected_package?: string | null;
  accepted_at?: string | null;
}

interface ContractorBrand { businessName: string; phone: string; address: string; logoUrl: string; brandColor: string; }
interface ProposalPhoto { id: string; url: string; }
interface OwnerAttachment { id: string; media_type: "photo" | "voice"; url: string; }
interface PaymentSummary { amountPaidCents: number; totalCents: number; available: boolean; }

interface EstimatePackage {
  name: string;
  description: string;
  description_es?: string;
  total: number;
}

export default function ClientEstimatePage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
  const [signatureName, setSignatureName] = useState("");
  const [contractor, setContractor] = useState<ContractorBrand>({ businessName: "Your Contractor", phone: "", address: "", logoUrl: "", brandColor: "#c85b2d" });
  const [photos, setPhotos] = useState<ProposalPhoto[]>([]);
  const [ownerAttachments, setOwnerAttachments] = useState<OwnerAttachment[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [wasConverted, setWasConverted] = useState(false);
  const [questionName, setQuestionName] = useState("");
  const [questionEmail, setQuestionEmail] = useState("");
  const [questionMessage, setQuestionMessage] = useState("");
  const [questionStatus, setQuestionStatus] = useState("");
  const [sendingQuestion, setSendingQuestion] = useState(false);
  const [questionHoneypot, setQuestionHoneypot] = useState("");
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary>({ amountPaidCents: 0, totalCents: 0, available: false });
  const [startingPayment, setStartingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  useEffect(() => {
    async function fetchEstimateDetails() {
      if (!id) return;
      setLoading(true);
      try {
        const response = await fetch(`/api/proposals/${encodeURIComponent(id)}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Estimate not found or link has expired.");
        const estData = result.estimate as Estimate;

        setEstimate(estData);
        if (result.paymentSummary) setPaymentSummary(result.paymentSummary as PaymentSummary);
        setWasConverted(result.converted === true);
        if (result.contractor) setContractor(result.contractor as ContractorBrand);
        if (Array.isArray(result.photos)) setPhotos(result.photos as ProposalPhoto[]);
        let estimateOwner = false;
        try {
          const ownerResponse = await fetch(`/api/estimates/${encodeURIComponent(id)}`, { cache: "no-store" });
          if (ownerResponse.ok) {
            estimateOwner = true;
            setIsOwner(true);
            const ownerData = await ownerResponse.json();
            if (Array.isArray(ownerData.attachments)) setOwnerAttachments(ownerData.attachments as OwnerAttachment[]);
          }
        } catch { /* Customer proposal access does not depend on owner-only recordings. */ }
        setSignatureName(estData.signature_name || "");
        const savedPackageIndex = Array.isArray(estData.package_options) ? estData.package_options.findIndex((option: EstimatePackage) => option.name === estData.selected_package) : -1;
        if (savedPackageIndex >= 0) setSelectedPackage(savedPackageIndex);
        if (!estimateOwner) void fetch(`/api/estimates/${id}/view`, { method: "POST" });

        setLineItems(result.lineItems || []);
      } catch (err: unknown) {
        console.error("Error loading proposal:", (err instanceof Error ? err.message : String(err)));
        setErrorMsg("Failed to load estimate details.");
      } finally {
        setLoading(false);
      }
    }

    fetchEstimateDetails();
  }, [id]);

  const lineItemTotal = lineItems.reduce(
    (sum, item) => sum + (item.quantity || 0) * (item.unit_price || 0),
    0
  );
  const subtotal = selectedPackage !== null && estimate?.package_options?.[selectedPackage]
    ? Number(estimate.package_options[selectedPackage].total)
    : lineItemTotal;
  const markupAmount = selectedPackage === null ? subtotal * Number(estimate?.markup_percentage || 0) / 100 : 0;
  const taxAmount = (subtotal + markupAmount) * Number(estimate?.tax_rate || 0) / 100;
  const total = subtotal + markupAmount + taxAmount;

  const depositAmount = estimate?.require_deposit ? total * ((estimate.deposit_percentage || 0) / 100) : 0;

  const sendQuestion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSendingQuestion(true); setQuestionStatus("");
    try {
      const response = await fetch(`/api/proposals/${encodeURIComponent(id)}/questions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: questionName, email: questionEmail, message: questionMessage, company_website: questionHoneypot }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your question could not be sent.");
      setQuestionStatus(result.emailSent
        ? "Your question was sent to the contractor. They can reply to your email address."
        : "Your question was saved. The contractor can see it in WorkCraft AI; email notification is not currently available.");
      setQuestionName(""); setQuestionEmail(""); setQuestionMessage("");
    } catch (error) { setQuestionStatus(error instanceof Error ? error.message : "Your question could not be sent."); }
    finally { setSendingQuestion(false); }
  };

  const startCustomerPayment = async (kind: "deposit" | "balance") => {
    setStartingPayment(true); setPaymentError("");
    try {
      const response = await fetch(`/api/proposals/${encodeURIComponent(id)}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Checkout could not be started.");
      window.location.assign(result.url);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Checkout could not be started.");
      setStartingPayment(false);
    }
  };

  const handleApproveAndPay = async () => {
    if (signatureName.trim().length < 2) {
      setErrorMsg("Enter your full name to approve this estimate.");
      return;
    }
    setPaying(true);
    try {
      const approval = await fetch(`/api/estimates/${id}/accept`, {
        method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signatureName, selectedPackage: selectedPackage === null ? null : estimate?.package_options?.[selectedPackage]?.name }),
      });
      const approvalData = await approval.json();
      if (!approval.ok) throw new Error(approvalData.error || "Approval could not be recorded.");
      setEstimate((current) => current ? { ...current, signature_name: signatureName.trim(), selected_package: selectedPackage === null ? null : estimate?.package_options?.[selectedPackage]?.name, accepted_at: new Date().toISOString(), status: "accepted" } : current);

      setPaying(false);
    } catch (err: unknown) {
      alert("Error processing approval: " + (err instanceof Error ? err.message : String(err)));
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Loading Proposal...
          </p>
        </div>
      </div>
    );
  }

  if (errorMsg || !estimate) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm max-w-md text-center space-y-3">
          <div className="text-red-500 text-2xl">⚠️</div>
          <h1 className="text-base font-bold text-slate-900">Unable to View Proposal</h1>
          <p className="text-xs text-slate-500">{errorMsg || "Invalid estimate request."}</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="text-xs font-semibold text-blue-600 hover:text-blue-500 underline pt-2 block mx-auto"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <LocalizedTree languageOverride={estimate.proposal_language}>
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Contractor Admin Bar (Edit & Navigation Controls) */}
        <div className="bg-slate-900 text-white p-3.5 rounded-xl flex items-center justify-between text-xs shadow-sm">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-300">Status:</span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                estimate.status === "paid" || estimate.status === "accepted"
                  ? "bg-green-500 text-white"
                  : "bg-yellow-500 text-slate-900"
              }`}
            >
              {estimate.status}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => router.push(`/estimate/${id}/edit`)}
              className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center space-x-1 shadow-sm"
            >
              <span>✏️</span>
              <span>Edit Estimate</span>
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg font-medium border border-slate-700 transition-colors"
            >
              Dashboard
            </button>
          </div>
        </div>

        {/* Client Proposal Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
          {/* Proposal Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-4 gap-2">
            <div>
              <div className="flex items-center gap-3">
                {contractor.logoUrl && <Image unoptimized width={128} height={48} src={contractor.logoUrl} alt={`${contractor.businessName} logo`} className="h-12 w-32 object-contain" />}
                <div><h1 className="text-xl font-bold" style={{ color: contractor.brandColor }}>{contractor.businessName}</h1><p className="text-sm font-semibold text-slate-900">Service Estimate</p>{contractor.phone && <p className="text-xs text-slate-600">{contractor.phone}</p>}{contractor.address && <p className="text-xs text-slate-600">{contractor.address}</p>}</div>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Created on {new Date(estimate.created_at).toLocaleDateString()}
              </p>
            </div>
            <div className="text-left sm:text-right">
              <span className="text-xs font-semibold text-slate-400 block uppercase tracking-wider">
                Total Estimate
              </span>
                <span className="text-2xl font-black text-slate-900">
                ${total.toFixed(2)}
              </span>
            </div>
          </div>

          {photos.length > 0 && <section className="space-y-3"><h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Job photos</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map((photo) => <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><Image unoptimized width={480} height={240} src={photo.url} alt="Job site" className="h-36 w-full rounded-lg border border-slate-200 object-cover" /></a>)}</div></section>}
          {ownerAttachments.some((item) => item.media_type === "voice") && <section className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4"><h2 className="text-xs font-bold uppercase tracking-wider text-amber-900">Private contractor voice notes</h2>{ownerAttachments.filter((item) => item.media_type === "voice").map((item) => <audio key={item.id} controls src={item.url} className="w-full" />)}<p className="text-[11px] text-amber-900">Only signed-in account owners can load these recordings.</p></section>}

          <div className="flex justify-end print:hidden">
            <button type="button" onClick={() => window.print()} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Print / Save PDF</button>
          </div>

          {estimate.package_options?.length ? (
            <section className="space-y-3">
              <div><h2 className="text-sm font-semibold text-slate-900">Choose the option that fits your home</h2><p className="mt-1 text-xs text-slate-500">Select one package to approve. Package totals are treated as final pre-tax prices; default markup is not added a second time. Applicable tax is added below.</p></div>
              <div className="grid gap-3 md:grid-cols-3">
                {estimate.package_options.map((option, index) => (
                  <button key={`${option.name}-${index}`} type="button" onClick={() => setSelectedPackage(index)} className={`rounded-xl border p-4 text-left transition ${selectedPackage === index ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : "border-slate-200 bg-white hover:border-slate-400"}`}>
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{option.name}</span>
                    <span className="mt-2 block text-xl font-bold text-slate-900">${Number(option.total).toFixed(2)}</span>
                    {(estimate.proposal_language === "es" ? option.description_es || option.description : option.description) && <span className="mt-2 block text-xs leading-5 text-slate-600">{estimate.proposal_language === "es" ? option.description_es || option.description : option.description}</span>}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {/* Client & Job Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 text-xs">
            <div>
              <span className="font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                Prepared For
              </span>
              <p className="font-bold text-slate-900 text-sm">{estimate.client_name}</p>
              <p className="text-slate-600">{estimate.client_email}</p>
              {estimate.client_phone && (
                <p className="text-slate-600">{estimate.client_phone}</p>
              )}
            </div>

            <div>
              <span className="font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                Job Location
              </span>
              <p className="font-medium text-slate-800">
                {estimate.job_address || "Address not specified"}
              </p>
            </div>
          </div>

          {/* Scope of Work Table */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Scope of Work
            </h2>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
                  <tr>
                    <th className="p-3">Description</th>
                    <th className="p-3 text-center">Qty</th>
                    <th className="p-3 text-right">Rate</th>
                    <th className="p-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lineItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/50">
                      <td className="p-3 font-medium text-slate-800">
                        {estimate.proposal_language === "es" ? item.description_es || item.description : item.description}
                      </td>
                      <td className="p-3 text-center text-slate-600">
                        {item.quantity}
                      </td>
                      <td className="p-3 text-right text-slate-600">
                        ${Number(item.unit_price).toFixed(2)}
                      </td>
                      <td className="p-3 text-right font-semibold text-slate-900">
                        ${((item.quantity || 0) * (item.unit_price || 0)).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {estimate.proposal_language === "es" && (lineItems.some((item) => !item.description_es) || estimate.package_options?.some((option) => !option.description_es)) && <p className="text-xs text-slate-500">Some work descriptions remain in the contractor’s original language because Spanish wording was not provided.</p>}
          </div>

          {/* Deposit & Summary Box */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3 text-sm">
            <div className="flex justify-between items-center text-slate-600">
              <span>Subtotal</span>
              <span className="font-semibold text-slate-900">${subtotal.toFixed(2)}</span>
            </div>
            {markupAmount > 0 && <div className="flex justify-between items-center text-slate-600"><span>Markup ({estimate.markup_percentage}%)</span><span>${markupAmount.toFixed(2)}</span></div>}
            {taxAmount > 0 && <div className="flex justify-between items-center text-slate-600"><span>Tax ({estimate.tax_rate}%)</span><span>${taxAmount.toFixed(2)}</span></div>}
            <div className="flex justify-between items-center border-t border-slate-200 pt-2 font-bold text-slate-900"><span>Total</span><span>${total.toFixed(2)}</span></div>

            {estimate.require_deposit && (
              <div className="flex justify-between items-center text-green-700 font-semibold pt-2 border-t border-slate-200">
                <span>Required Down-Payment ({estimate.deposit_percentage}%)</span>
                <span>${depositAmount.toFixed(2)}</span>
              </div>
            )}
          </div>

          {!isOwner && <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-bold text-slate-900">Have a question about this proposal?</h2>
            <p className="mt-1 text-xs text-slate-600">Send it directly to {contractor.businessName}. Your email will be used so they can reply.</p>
            <form onSubmit={sendQuestion} className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-700">Your name<input required maxLength={160} autoComplete="name" value={questionName} onChange={(event) => setQuestionName(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label><label className="text-xs font-medium text-slate-700">Email<input required type="email" maxLength={320} autoComplete="email" value={questionEmail} onChange={(event) => setQuestionEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label></div>
              <label className="block text-xs font-medium text-slate-700">Question<textarea required minLength={5} maxLength={2000} rows={3} value={questionMessage} onChange={(event) => setQuestionMessage(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
              <label className="hidden" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={questionHoneypot} onChange={(event) => setQuestionHoneypot(event.target.value)} /></label>
              <button type="submit" disabled={sendingQuestion} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: contractor.brandColor }}>{sendingQuestion ? "Sending…" : "Send question"}</button>
              {questionStatus && <p role="status" className="text-xs text-slate-700">{questionStatus}</p>}
            </form>
          </section>}

          {/* Client Action Button */}
          {!isOwner && (estimate.status === "paid" ? (
            <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-xl text-center font-semibold text-sm">
              ✓ Estimate paid in full. Thank you.
            </div>
          ) : estimate.status === "accepted" ? (
            <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-xl text-center font-semibold text-sm">
              ✓ Your approval has been recorded. The contractor will contact you about payment and next steps.
              {isOwner && (wasConverted ? <p className="mt-2 text-xs font-medium">This estimate has already been added to your job schedule.</p> : <button type="button" onClick={() => router.push(`/schedule?estimate=${encodeURIComponent(id)}`)} className="mt-3 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white">Schedule this approved job</button>)}
              {paymentSummary.available && paymentSummary.totalCents > paymentSummary.amountPaidCents && <div className="mt-4 border-t border-green-200 pt-4 text-left">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>Paid so far</span><strong>${(paymentSummary.amountPaidCents / 100).toFixed(2)}</strong></div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs"><span>Remaining balance</span><strong>${((paymentSummary.totalCents - paymentSummary.amountPaidCents) / 100).toFixed(2)}</strong></div>
                {paymentError && <p role="alert" className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-800">{paymentError}</p>}
                <div className="mt-3 flex flex-col justify-center gap-2 sm:flex-row">
                  {estimate.require_deposit && paymentSummary.amountPaidCents === 0 && <button type="button" disabled={startingPayment} onClick={() => void startCustomerPayment("deposit")} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{startingPayment ? "Opening Stripe…" : `Pay down payment · $${depositAmount.toFixed(2)}`}</button>}
                  <button type="button" disabled={startingPayment} onClick={() => void startCustomerPayment("balance")} className="rounded-lg border border-blue-700 px-4 py-2.5 text-sm font-semibold text-blue-800 disabled:opacity-50">{startingPayment ? "Opening Stripe…" : paymentSummary.amountPaidCents > 0 ? `Pay remaining balance · $${((paymentSummary.totalCents - paymentSummary.amountPaidCents) / 100).toFixed(2)}` : `Pay in full · $${(paymentSummary.totalCents / 100).toFixed(2)}`}</button>
                </div>
              </div>}
            </div>
          ) : (
            <>
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                {Boolean(estimate.package_options?.length) && selectedPackage === null && <p className="text-xs font-semibold text-amber-800">Select a package above to continue.</p>}
                <label className="block text-xs font-semibold text-slate-700">Type your full name to approve<input value={signatureName} onChange={(event) => { setSignatureName(event.target.value); setErrorMsg(""); }} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" autoComplete="name" placeholder="Full name" /></label>
                <p className="text-[11px] leading-5 text-slate-500">Typing your name records your approval of this estimate.</p>
                {estimate.signature_name && <p className="text-xs font-medium text-green-700">Approved by {estimate.signature_name}{estimate.accepted_at ? ` on ${new Date(estimate.accepted_at).toLocaleDateString()}` : ""}</p>}
                {errorMsg && <p role="alert" className="text-xs text-red-700">{errorMsg}</p>}
              </div>
              <button
                type="button"
                onClick={handleApproveAndPay}
                disabled={paying || signatureName.trim().length < 2 || Boolean(estimate.package_options?.length && selectedPackage === null)}
              className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm disabled:opacity-50 text-sm"
            >
              {paying
                ? "Recording Approval..."
                : estimate.require_deposit
                ? `Approve Estimate · Deposit Due Later ($${depositAmount.toFixed(2)})`
                : `Approve Proposal ($${subtotal.toFixed(2)})`}
            </button>
            </>
          ))}
        </div>
      </div>
    </div>
    </LocalizedTree>
  );
}
