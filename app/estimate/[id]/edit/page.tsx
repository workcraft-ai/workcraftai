"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { LocalizedTree } from "@/app/components/LanguageProvider";

interface LineItemInput {
  description: string;
  description_es?: string;
  quantity: number;
  unit_price: number;
}

interface EstimatePackage {
  name: "Good" | "Better" | "Best";
  description: string;
  description_es?: string;
  total: number;
}

export default function EditEstimatePage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isPro, setIsPro] = useState(false);

  // Form State
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [jobAddress, setJobAddress] = useState("");
  const [requireDeposit, setRequireDeposit] = useState(true);
  const [depositPercentage, setDepositPercentage] = useState(20);
  const [taxRate, setTaxRate] = useState(0);
  const [markupPercentage, setMarkupPercentage] = useState(0);
  const [proposalLanguage, setProposalLanguage] = useState<"en" | "es">("en");

  // Line Items State
  const [lineItems, setLineItems] = useState<LineItemInput[]>([]);
  const [packageOptions, setPackageOptions] = useState<EstimatePackage[]>([]);

  // Load existing Estimate and Line Items
  useEffect(() => {
    async function loadEstimate() {
      try {
        const res = await fetch(`/api/estimates/${id}`);
        const data = await res.json();

        if (data.error) {
          alert("Error loading estimate: " + data.error);
          router.push("/dashboard");
          return;
        }

        const { estimate, lineItems: items } = data;

        setClientName(estimate.client_name || "");
        setClientEmail(estimate.client_email || "");
        setClientPhone(estimate.client_phone || "");
        setJobAddress(estimate.job_address || "");
        setTaxRate(Number(estimate.tax_rate) || 0);
        setMarkupPercentage(Number(estimate.markup_percentage) || 0);
        setProposalLanguage(estimate.proposal_language === "es" ? "es" : "en");
        const { data: { user } } = await supabase.auth.getUser();
        const { data: plan } = user ? await supabase.from("subscriptions").select("status").eq("user_id", user.id).maybeSingle() : { data: null };
        const activePro = ["active", "trialing"].includes(plan?.status ?? "");
        setIsPro(activePro);
        setRequireDeposit(activePro ? (estimate.require_deposit ?? false) : false);
        setDepositPercentage(estimate.deposit_percentage || 20);
        setPackageOptions(activePro && Array.isArray(estimate.package_options) ? estimate.package_options : []);

        setLineItems(
          items.map((i: { description: string; description_es?: string; quantity: number; unit_price: number }) => ({
            description: i.description,
            description_es: i.description_es || "",
            quantity: i.quantity,
            unit_price: i.unit_price,
          }))
        );
      } catch {
        alert("Failed to fetch estimate data");
      } finally {
        setLoading(false);
      }
    }

    if (id) loadEstimate();
  }, [id, router]);

  const handleAddItem = () => {
    setLineItems([...lineItems, { description: "", description_es: "", quantity: 1, unit_price: 0 }]);
  };

  const handleRemoveItem = (index: number) => {
    if (lineItems.length === 1) {
      alert("An estimate must contain at least one line item.");
      return;
    }
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const handleItemChange = (
    index: number,
    field: keyof LineItemInput,
    value: string | number
  ) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  };

  const subtotal = lineItems.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
    0
  );

  const depositAmount = requireDeposit ? subtotal * (depositPercentage / 100) : 0;

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const res = await fetch(`/api/estimates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientName,
          client_email: clientEmail,
          client_phone: clientPhone,
          job_address: jobAddress,
          require_deposit: requireDeposit,
          deposit_percentage: depositPercentage,
          tax_rate: taxRate,
          markup_percentage: markupPercentage,
          proposal_language: proposalLanguage,
          package_options: isPro ? packageOptions : [],
          lineItems,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Return to the dashboard so the contractor can review and share the updated proposal.
      router.push("/dashboard");
    } catch (err: unknown) {
      alert("Error updating estimate: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm font-medium text-slate-500">
        Loading estimate details...
      </div>
    );
  }

  return (
    <LocalizedTree>
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-3xl mx-auto space-y-6">
        <form
          onSubmit={handleUpdate}
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Edit Estimate</h1>
              <p className="text-xs text-slate-500">
                Modifying estimate ID: <span className="font-mono">{id}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/estimate/${id}`)}
              className="text-xs text-slate-500 hover:text-slate-800 font-medium"
            >
              Cancel
            </button>
          </div>

          {/* Client Details */}
          <div className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Client Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Client Name *
                </label>
                <input
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Client Email *
                </label>
                <input
                  type="email"
                  required
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Client Phone
                </label>
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Job Address
                </label>
                <input
                  type="text"
                  value={jobAddress}
                  onChange={(e) => setJobAddress(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div><label className="block text-xs font-medium text-slate-700 mb-1">Customer proposal language</label><select value={proposalLanguage} onChange={(event) => setProposalLanguage(event.target.value === "es" ? "es" : "en")} className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm"><option value="en">English proposal</option><option value="es">Spanish proposal</option></select></div>
            </div>
          </div>

          {/* Line Items Editor */}
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-sm font-semibold text-slate-900">Estimate pricing</h2>
            <p className="mt-1 text-xs text-slate-600">Markup is applied before sales tax. Check local tax rules for taxable labor and materials.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-700">Markup (%)<input type="number" min="0" max="500" step="0.01" value={markupPercentage} onChange={(event) => setMarkupPercentage(Number(event.target.value) || 0)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" /></label><label className="text-xs font-medium text-slate-700">Sales tax (%)<input type="number" min="0" max="100" step="0.001" value={taxRate} onChange={(event) => setTaxRate(Number(event.target.value) || 0)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" /></label></div>
          </section>

          {/* Line Items Editor */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Scope & Line Items
              </h2>
              <button
                type="button"
                onClick={handleAddItem}
                className="text-xs font-semibold text-blue-600 hover:text-blue-500"
              >
                + Add Line Item
              </button>
            </div>

            <div className="space-y-3">
              {lineItems.map((item, index) => (
                <div
                  key={index}
                  className="space-y-2 rounded-lg border border-slate-200/80 bg-slate-50 p-2.5"
                >
                  <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) =>
                      handleItemChange(index, "description", e.target.value)
                    }
                    placeholder="Description"
                    className="flex-1 bg-white border border-slate-200 rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) =>
                      handleItemChange(
                        index,
                        "quantity",
                        parseFloat(e.target.value) || 0
                      )
                    }
                    className="w-16 bg-white border border-slate-200 rounded-md p-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unit_price}
                    onChange={(e) =>
                      handleItemChange(
                        index,
                        "unit_price",
                        parseFloat(e.target.value) || 0
                      )
                    }
                    className="w-24 bg-white border border-slate-200 rounded-md p-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <div className="w-20 text-right text-xs font-semibold text-slate-700">
                    ${((item.quantity || 0) * (item.unit_price || 0)).toFixed(2)}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(index)}
                    className="text-slate-400 hover:text-red-500 text-xs px-1"
                    title="Remove item"
                  >
                    ✕
                  </button>
                  </div>
                  <input type="text" value={item.description_es ?? ""} onChange={(event) => handleItemChange(index, "description_es", event.target.value)} placeholder="Spanish description (optional)" aria-label={`Spanish description for ${item.description || `line item ${index + 1}`}`} className="w-full rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
              ))}
            </div>
          </div>

          {isPro ? <section className="space-y-3 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Good / Better / Best</h2><p className="mt-1 text-xs text-slate-500">Add or adjust service options customers can choose from.</p></div><button type="button" onClick={() => setPackageOptions(packageOptions.length ? [] : ["Good", "Better", "Best"].map((name) => ({ name: name as EstimatePackage["name"], description: "", description_es: "", total: subtotal })))} className="text-xs font-semibold text-blue-700 underline">{packageOptions.length ? "Remove options" : "Add options"}</button></div>
            {packageOptions.length > 0 && <div className="grid gap-3 md:grid-cols-3">{packageOptions.map((option, index) => <div key={option.name} className="space-y-2 rounded-lg bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-600">{option.name}</p><input aria-label={`${option.name} description`} value={option.description} onChange={(event) => setPackageOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} placeholder="What's included?" className="w-full rounded-md border border-slate-300 bg-white p-2 text-xs" /><input aria-label={`${option.name} Spanish description`} value={option.description_es ?? ""} onChange={(event) => setPackageOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description_es: event.target.value } : item))} placeholder="Spanish description (optional)" className="w-full rounded-md border border-slate-300 bg-white p-2 text-xs" /><input aria-label={`${option.name} total`} type="number" min="0" step="0.01" value={option.total} onChange={(event) => setPackageOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, total: Number(event.target.value) || 0 } : item))} className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm" /></div>)}</div>}
          </section> : <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600"><span>Good / Better / Best options are included with Pro.</span>{" "}<a href="/profile" className="font-semibold text-blue-700 underline">Upgrade to Pro</a></section>}

          {/* Financial Totals */}
          <div className="bg-slate-50 p-4 rounded-xl space-y-4 border border-slate-200/60">
            <div className="flex items-center justify-between">
              <label className="flex items-center space-x-2 text-sm font-medium text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireDeposit}
                  onChange={(e) => setRequireDeposit(e.target.checked)}
                  disabled={!isPro}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span>{isPro ? "Require Down-Payment / Deposit" : "Require Down-Payment / Deposit (Pro)"}</span>
              </label>

              {requireDeposit && (
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    min="5"
                    max="100"
                    value={depositPercentage}
                    onChange={(e) => setDepositPercentage(Number(e.target.value))}
                    className="w-16 bg-white border border-slate-300 rounded-md p-1 text-center text-sm"
                  />
                  <span className="text-xs font-semibold text-slate-600">%</span>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-between items-center text-sm">
              <span className="text-slate-600">Updated Subtotal:</span>
              <span className="font-bold text-slate-900">${subtotal.toFixed(2)}</span>
            </div>

            {requireDeposit && (
              <div className="flex justify-between items-center text-sm font-semibold text-green-700">
                <span>Updated Deposit ({depositPercentage}%):</span>
                <span>${depositAmount.toFixed(2)}</span>
              </div>
            )}
          </div>

          <p className="text-center text-xs text-slate-600">Updating the proposal does not send an email. Share it from your Dashboard when you are ready.</p>
          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors shadow-sm disabled:opacity-50 text-sm"
            >
              {saving ? "Saving Changes..." : "Save Changes & Update Proposal"}
            </button>
          </div>
        </form>
      </div>
    </div>
    </LocalizedTree>
  );
}
