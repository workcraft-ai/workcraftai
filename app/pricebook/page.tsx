"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { LocalizedTree } from "@/app/components/LanguageProvider";
import { parsePriceBookCsv } from "@/lib/priceBookCsv.mjs";
import type { ImportedPriceBookItem } from "@/lib/priceBookCsv.mjs";

type PriceItem = { id: string; name: string; description: string; trade: string; unit: string; unit_price: number };
type EstimateLine = { description: string; quantity: number; unit_price: number };
type EstimateTemplate = { id: string; name: string; trade: string; line_items: EstimateLine[]; package_options?: { name: string; description: string; total: number }[]; require_deposit: boolean; deposit_percentage: number };

const trades = ["Plumbing", "Electrical", "Roofing", "HVAC", "Painting", "Carpentry", "General", "Other"];
const fieldClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

export default function PriceBookPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"items" | "templates">("items");
  const [items, setItems] = useState<PriceItem[]>([]);
  const [templates, setTemplates] = useState<EstimateTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trade, setTrade] = useState("Plumbing");
  const [unit, setUnit] = useState("each");
  const [unitPrice, setUnitPrice] = useState("0");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportedPriceBookItem[]>([]);
  const [importing, setImporting] = useState(false);

  const loadData = useCallback(async () => {
    const [itemResult, templateResult] = await Promise.all([
      supabase.from("price_book_items").select("id, name, description, trade, unit, unit_price").order("name"),
      supabase.from("estimate_templates").select("id, name, trade, line_items, package_options, require_deposit, deposit_percentage").order("name"),
    ]);
    if (itemResult.error || templateResult.error) {
      setError("WorkCraft AI setup is needed for the price book and templates. Apply the operations migration in supabase/migrations.");
    } else {
      setItems((itemResult.data ?? []) as PriceItem[]);
      setTemplates((templateResult.data ?? []) as EstimateTemplate[]);
      setError("");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(task);
  }, [loadData]);

  const addItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(""); setError("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Sign in to manage your price book."); return; }
    const item = { name, description, trade, unit, unit_price: Number(unitPrice), updated_at: new Date().toISOString() };
    const { error: insertError } = editingId
      ? await supabase.from("price_book_items").update(item).eq("id", editingId).eq("user_id", user.id)
      : await supabase.from("price_book_items").insert({ ...item, user_id: user.id });
    if (insertError) setError(insertError.message);
    else { setName(""); setDescription(""); setUnitPrice("0"); setEditingId(null); setNotice(editingId ? "Price book item updated." : "Price book item added."); await loadData(); }
  };

  const editItem = (item: PriceItem) => {
    setEditingId(item.id); setName(item.name); setDescription(item.description); setTrade(item.trade); setUnit(item.unit); setUnitPrice(String(item.unit_price)); setTab("items");
  };

  const removeItem = async (id: string) => {
    const { error: deleteError } = await supabase.from("price_book_items").delete().eq("id", id);
    if (deleteError) setError(deleteError.message); else setItems((current) => current.filter((item) => item.id !== id));
  };

  const selectImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const parsedRows = parsePriceBookCsv(await file.text());
      setImportRows(parsedRows);
      setError("");
      setNotice(`Ready to import ${parsedRows.length} price book items. Review the file, then choose Import.`);
    } catch (importError) {
      setImportRows([]);
      setError(importError instanceof Error ? importError.message : "Unable to read this CSV file.");
    }
  };

  const importPriceBook = async () => {
    if (!importRows.length) return;
    setImporting(true); setError(""); setNotice("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Sign in to import price book items.");
      setImporting(false);
      return;
    }

    let imported = 0;
    for (let index = 0; index < importRows.length; index += 100) {
      const batch = importRows.slice(index, index + 100).map((item) => ({ ...item, user_id: user.id }));
      const { error: insertError } = await supabase.from("price_book_items").insert(batch);
      if (insertError) {
        setError(imported ? `Imported ${imported} items. The rest failed: ${insertError.message}` : insertError.message);
        setImporting(false);
        await loadData();
        return;
      }
      imported += batch.length;
    }
    setImportRows([]);
    setNotice(`Imported ${imported} price book items.`);
    setImporting(false);
    await loadData();
  };

  const applyTemplate = (template: EstimateTemplate) => {
    sessionStorage.setItem("tradeflow-estimate-template", JSON.stringify(template));
    router.push("/estimate/new");
  };

  return (
    <LocalizedTree>
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-blue-700">Free tools</p><h1 className="mt-1 text-2xl font-bold">Price book & templates</h1><p className="mt-1 text-sm text-slate-600">Set your own rates and reuse the work you quote most.</p></div>
          <Link href="/estimate/new" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Create estimate</Link>
        </header>

        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

        <div className="flex gap-2">
          <TabButton active={tab === "items"} onClick={() => setTab("items")}>Price book ({items.length})</TabButton>
          <TabButton active={tab === "templates"} onClick={() => setTab("templates")}>Estimate templates ({templates.length})</TabButton>
        </div>

        {tab === "items" ? (
          <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            <form onSubmit={addItem} className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">{editingId ? "Edit price book item" : "Add a price book item"}</h2>
              <Field label="Item or service"><input required value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} placeholder="Faucet installation" /></Field>
              <Field label="Description"><input value={description} onChange={(event) => setDescription(event.target.value)} className={fieldClass} placeholder="Standard fixture install" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Trade"><select value={trade} onChange={(event) => setTrade(event.target.value)} className={fieldClass}>{trades.map((value) => <option key={value}>{value}</option>)}</select></Field>
                <Field label="Unit"><input required value={unit} onChange={(event) => setUnit(event.target.value)} className={fieldClass} placeholder="each, hour, sq ft" /></Field>
              </div>
              <Field label="Your price per unit"><input type="number" required min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className={fieldClass} /></Field>
              <button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">{editingId ? "Save rate" : "Add to my price book"}</button>
              {editingId && <button type="button" onClick={() => { setEditingId(null); setName(""); setDescription(""); setUnitPrice("0"); }} className="w-full text-xs font-semibold text-slate-600 underline">Cancel edit</button>}
            </form>
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h2 className="font-semibold">Your rates</h2><p className="mt-1 text-xs text-slate-500">These are your business rates and can be edited on every estimate.</p></div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <a download="tradeflow-pricebook-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent("name,description,trade,unit,unit_price\nFaucet installation,Standard faucet install,Plumbing,each,245.00")}`} className="font-semibold text-blue-700 underline">Download CSV template</a>
                    <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50">Choose CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void selectImportFile(event)} className="sr-only" /></label>
                  </div>
                </div>
                {importRows.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-blue-50 p-3"><p className="text-xs text-blue-900">{importRows.length} rows ready to import.</p><div className="flex items-center gap-3"><button type="button" onClick={() => { setImportRows([]); setNotice(""); }} className="text-xs font-semibold text-slate-600 underline">Cancel</button><button type="button" disabled={importing} onClick={() => void importPriceBook()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{importing ? "Importing…" : `Import ${importRows.length} items`}</button></div></div>}
              </div>
              {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading price book…</p> : items.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">Add your first labor or material rate.</p> : <div className="divide-y divide-slate-100">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 p-4"><div><p className="font-semibold">{item.name}</p><p className="text-xs text-slate-500">{item.trade} · per {item.unit}{item.description ? ` · ${item.description}` : ""}</p></div><div className="flex items-center gap-3"><span className="font-semibold tabular-nums">${Number(item.unit_price).toFixed(2)}</span><button onClick={() => editItem(item)} className="text-xs font-semibold text-blue-700 underline">Edit</button><button onClick={() => void removeItem(item.id)} aria-label={`Delete ${item.name}`} className="text-xs font-semibold text-red-700 underline">Remove</button></div></div>)}</div>}
            </section>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            <section className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Build a reusable template</h2>
              <p className="text-sm text-slate-600">Set up the scope, quantities, and rates in the estimate builder, then save the complete estimate as a template.</p>
              <Link href="/estimate/new" className="inline-flex rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">Open estimate builder</Link>
            </section>
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5"><h2 className="font-semibold">Reusable templates</h2></div>
              {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading templates…</p> : templates.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No templates yet.</p> : <div className="divide-y divide-slate-100">{templates.map((template) => <div key={template.id} className="flex items-center justify-between gap-3 p-4"><div><p className="font-semibold">{template.name}</p><p className="text-xs text-slate-500">{template.trade} · {template.line_items?.length ?? 0} starter line items</p></div><div className="flex gap-3"><button onClick={() => applyTemplate(template)} className="text-xs font-semibold text-blue-700 underline">Use template</button><button onClick={async () => { const { error: deleteError } = await supabase.from("estimate_templates").delete().eq("id", template.id); if (deleteError) setError(deleteError.message); else setTemplates((current) => current.filter((item) => item.id !== template.id)); }} className="text-xs font-semibold text-red-700 underline">Delete</button></div></div>)}</div>}
            </section>
          </div>
        )}
      </div>
    </main>
    </LocalizedTree>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block space-y-1.5 text-xs font-medium text-slate-700"><span>{label}</span>{children}</label>; }
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) { return <button onClick={onClick} className={`rounded-lg px-4 py-2 text-sm font-semibold ${active ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>{children}</button>; }
