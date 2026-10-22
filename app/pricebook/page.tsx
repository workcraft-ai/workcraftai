"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import Link from "next/link";
import { readAllPages } from "@/lib/read-all-pages";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { LocalizedTree, useLanguage } from "@/app/components/LanguageProvider";
import { parsePriceBookCsv } from "@/lib/priceBookCsv.mjs";
import type { ImportedPriceBookItem } from "@/lib/priceBookCsv.mjs";
import SetupReturnLink from "@/app/components/SetupReturnLink";
import { DEFAULT_ESTIMATE_TRADES, parseEstimateTradeOptions } from "@/lib/estimate-trades";
import { hasAtMostTwoDecimalPlaces } from "@/lib/estimate-money.mjs";

type PriceItem = { id: string; name: string; description: string; aliases: string[]; trade: string; unit: string; unit_price: number; pricing_basis?: string };
type LearnedAlias = { price_book_item_id: string; alias: string; selections: number };
type EstimateLine = { description: string; description_es?: string; quantity: number; unit?: string; unit_price: number };
type EstimateTemplate = { id: string; name: string; trade: string; line_items: EstimateLine[]; package_options?: { name: string; description: string; total: number }[]; require_deposit: boolean; deposit_percentage: number };

const fieldClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

export default function PriceBookPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const [tab, setTab] = useState<"items" | "templates">("items");
  const [items, setItems] = useState<PriceItem[]>([]);
  const [learnedAliases, setLearnedAliases] = useState<LearnedAlias[]>([]);
  const [templates, setTemplates] = useState<EstimateTemplate[]>([]);
  const [trades, setTrades] = useState(() => DEFAULT_ESTIMATE_TRADES.map((option) => option.value));
  const initialTradeSelected = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [aliasesInput, setAliasesInput] = useState("");
  const [trade, setTrade] = useState("Plumbing");
  const [unit, setUnit] = useState("each");
  const [pricingBasis, setPricingBasis] = useState("unknown");
  const [unitPrice, setUnitPrice] = useState("0");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportedPriceBookItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const savingItemRef = useRef(false);

  const loadData = useCallback(async () => {
    const [itemResult, templateResult, aliasResult, tradeResult] = await Promise.all([
      readAllPages((from, to) => supabase.from("price_book_items").select("id, name, description, aliases, trade, unit, unit_price, pricing_basis").order("name").order("id").range(from, to)),
      readAllPages((from, to) => supabase.from("estimate_templates").select("id, name, trade, line_items, package_options, require_deposit, deposit_percentage").order("name").order("id").range(from, to)),
      readAllPages((from, to) => supabase.from("tradeflow_price_book_learned_aliases").select("price_book_item_id, alias, selections").order("price_book_item_id").order("alias").range(from, to)),
      fetch("/api/estimate/trades", { cache: "no-store" }).then(async (response) => response.ok ? response.json() : null).catch(() => null),
    ]);
    const configuredTrades = parseEstimateTradeOptions(tradeResult?.trades);
    if (configuredTrades?.length) {
      setTrades(configuredTrades.map((option) => option.value));
      if (!initialTradeSelected.current) {
        setTrade(configuredTrades[0].value);
        initialTradeSelected.current = true;
      }
    }
    if (itemResult.error || templateResult.error || aliasResult.error) {
      setError("WorkCraft AI setup is needed for the price book and templates. Apply the operations migration in supabase/migrations.");
    } else {
      setItems((itemResult.data ?? []) as PriceItem[]);
      setTemplates((templateResult.data ?? []) as EstimateTemplate[]);
      setLearnedAliases((aliasResult.data ?? []) as LearnedAlias[]);
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
    const aliases = [...new Set(aliasesInput.split(",").map((alias) => alias.trim()).filter(Boolean))];
    if (aliases.length > 20 || aliases.some((alias) => alias.length > 160 || /[\x00-\x1f\x7f]/.test(alias))) {
      setError(language === "es" ? "Agrega como máximo 20 nombres alternativos de hasta 160 caracteres cada uno." : "Add at most 20 alternate names of up to 160 characters each.");
      return;
    }
    if (!name.trim() || name.trim().length > 200 || description.length > 500 || trade.length > 60 || unit.trim().length > 40
      || !hasAtMostTwoDecimalPlaces(Number(unitPrice)) || Number(unitPrice) < 0 || Number(unitPrice) > 100000000) {
      setError(language === "es" ? "Usa un nombre de hasta 200 caracteres, descripción de hasta 500, oficio de hasta 60, unidad de hasta 40 y precio con un máximo de dos decimales." : "Use a name up to 200 characters, description up to 500, trade up to 60, unit up to 40, and a price with at most two decimal places.");
      return;
    }
    if (savingItemRef.current) return;
    savingItemRef.current = true;
    setSavingItem(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError(language === "es" ? "Inicia sesión para administrar tu lista de precios." : "Sign in to manage your price book."); return; }
      const item = { name: name.trim(), description: description.trim(), aliases, trade, unit: unit.trim(), pricing_basis: pricingBasis, unit_price: Number(unitPrice), updated_at: new Date().toISOString() };
      const { error: insertError } = editingId
        ? await supabase.from("price_book_items").update(item).eq("id", editingId).eq("user_id", user.id)
        : await supabase.from("price_book_items").insert({ ...item, user_id: user.id });
      if (insertError) setError(language === "es" ? "No se pudo guardar este artículo. Revisa los datos e inténtalo de nuevo." : "Could not save this Price Book item. Please check the details and try again.");
      else {
        setName(""); setDescription(""); setAliasesInput(""); setUnitPrice("0"); setEditingId(null);
        setNotice(editingId ? "Price book item updated." : "Price book item added.");
        await loadData();
        if (new URLSearchParams(window.location.search).get("setup") === "1") window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setError(language === "es" ? "No se pudo guardar este artículo. Inténtalo de nuevo." : "Could not save this Price Book item. Please try again.");
    } finally {
      savingItemRef.current = false;
      setSavingItem(false);
    }
  };

  const editItem = (item: PriceItem) => {
    setEditingId(item.id); setName(item.name); setDescription(item.description); setAliasesInput((item.aliases ?? []).join(", ")); setTrade(item.trade); setUnit(item.unit); setPricingBasis(item.pricing_basis || "unknown"); setUnitPrice(String(item.unit_price)); setTab("items");
  };

  const removeItem = async (id: string) => {
    const { error: deleteError } = await supabase.from("price_book_items").delete().eq("id", id);
    if (deleteError) setError("Could not delete this Price Book item. Please try again."); else setItems((current) => current.filter((item) => item.id !== id));
  };

  const removeLearnedAlias = async (itemId: string, alias: string) => {
    const { error: deleteError } = await supabase.from("tradeflow_price_book_learned_aliases")
      .delete().eq("price_book_item_id", itemId).eq("alias", alias);
    if (deleteError) setError(language === "es" ? "No se pudo quitar el nombre aprendido." : "Could not remove the learned name.");
    else setLearnedAliases((current) => current.filter((entry) => entry.price_book_item_id !== itemId || entry.alias !== alias));
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
        setError(imported ? `Imported ${imported} items. The remaining rows could not be saved; check the file and try again.` : "Could not import these Price Book items. Check the file and try again.");
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
    if (new URLSearchParams(window.location.search).get("setup") === "1") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const applyTemplate = (template: EstimateTemplate) => {
    sessionStorage.setItem("tradeflow-estimate-template", JSON.stringify(template));
    router.push("/estimate/new");
  };

  const openPriceBookItems = () => {
    const focusItemName = () => {
      const field = document.getElementById("price-book-item-name") as HTMLInputElement | null;
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
      field?.focus({ preventScroll: true });
    };
    if (tab !== "items") {
      setTab("items");
      window.setTimeout(focusItemName, 0);
      return;
    }
    focusItemName();
  };

  return (
    <LocalizedTree>
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <SetupReturnLink step="pricebook" />
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-orange-800">Free tools</p><h1 className="mt-1 text-2xl font-bold">Price book & templates</h1><p className="mt-1 text-sm text-slate-600">Set your own rates and reuse the work you quote most.</p></div>
          <button type="button" onClick={openPriceBookItems} className="inline-flex min-h-12 items-center rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400">+ Add item</button>
        </header>

        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

        <div className="flex gap-2">
          <TabButton active={tab === "items"} onClick={() => setTab("items")}>Price book ({items.length})</TabButton>
          <TabButton active={tab === "templates"} onClick={() => setTab("templates")}>Estimate templates ({templates.length})</TabButton>
        </div>

        {tab === "items" ? (
          <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            <form id="add-price-book-item" onSubmit={addItem} className="h-fit scroll-mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">{editingId ? "Edit price book item" : "Add a price book item"}</h2>
              <Field label="Item or service"><input id="price-book-item-name" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} placeholder="Faucet installation" /></Field>
              <Field label="Description"><input maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} className={fieldClass} placeholder="Standard fixture install" /></Field>
              <Field label={language === "es" ? "Nombres alternativos (separados por comas)" : "Alternate names (separate with commas)"}><input maxLength={1000} value={aliasesInput} onChange={(event) => setAliasesInput(event.target.value)} className={fieldClass} placeholder={language === "es" ? "Reemplazo de calentador, instalación de calentador" : "Water heater replacement, heater installation"} /></Field>
              <p className="text-xs text-slate-600">{language === "es" ? "La IA usa estos nombres para relacionar el trabajo con tu tarifa guardada. Puedes incluir palabras en inglés y español." : "AI uses these names to find your saved rate. You can include English and Spanish terms."}</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Trade"><select value={trade} onChange={(event) => setTrade(event.target.value)} className={fieldClass}>{!trades.includes(trade) && <option value={trade}>{trade}</option>}{trades.map((value) => <option key={value}>{value}</option>)}</select></Field>
                <Field label="Unit"><input required maxLength={40} value={unit} onChange={(event) => setUnit(event.target.value)} className={fieldClass} placeholder="each, hour, sq ft" /></Field>
              </div>
              <Field label="Pricing basis"><select value={pricingBasis} onChange={(event) => setPricingBasis(event.target.value)} className={fieldClass}><option value="unknown">Not specified</option><option value="labor">Labor only</option><option value="materials">Materials only</option><option value="installed">Labor and materials</option><option value="other">Other costs</option></select></Field>
              <p className="text-xs text-slate-600">AI applies a saved rate automatically only when its unit and pricing basis match. Unspecified rates remain suggestions for your review.</p>
              <Field label="Your price per unit"><input type="number" required min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className={fieldClass} /></Field>
              <button disabled={savingItem} className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">{savingItem ? (language === "es" ? "Guardando…" : "Saving…") : editingId ? (language === "es" ? "Guardar tarifa" : "Save rate") : (language === "es" ? "Agregar a mi lista de precios" : "Add to my price book")}</button>
              {editingId && <button type="button" onClick={() => { setEditingId(null); setName(""); setDescription(""); setAliasesInput(""); setUnitPrice("0"); }} className="inline-flex min-h-12 w-full items-center justify-center text-xs font-semibold text-slate-600 underline">Cancel edit</button>}
            </form>
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h2 className="font-semibold">Your rates</h2><p className="mt-1 text-xs text-slate-500">These are your business rates and can be edited on every estimate.</p></div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <a download="workcraftai-pricebook-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent("name,description,trade,unit,unit_price,pricing_basis,aliases\nFaucet installation,Standard faucet install,Plumbing,each,245.00,installed,Faucet replacement;tap installation")}`} className="inline-flex min-h-12 items-center font-semibold text-blue-700 underline">Download CSV template</a>
                    <label className="inline-flex min-h-12 cursor-pointer items-center rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50">Choose CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void selectImportFile(event)} className="sr-only" /></label>
                  </div>
                </div>
                {importRows.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-blue-50 p-3"><p className="text-xs text-blue-900">{importRows.length} rows ready to import.</p><div className="flex items-center gap-3"><button type="button" onClick={() => { setImportRows([]); setNotice(""); }} className="inline-flex min-h-12 items-center text-xs font-semibold text-slate-600 underline">Cancel</button><button type="button" disabled={importing} onClick={() => void importPriceBook()} className="inline-flex min-h-12 items-center rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{importing ? "Importing…" : `Import ${importRows.length} items`}</button></div></div>}
              </div>
              {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading price book…</p> : items.length === 0 ? <div className="p-8 text-center"><p className="text-sm font-semibold text-slate-800">{language === "es" ? "Agrega tu primera tarifa de mano de obra o materiales." : "Add your first labor or material rate."}</p><p className="mt-1 text-sm text-slate-600">{language === "es" ? "Por ejemplo: visita de diagnóstico · $95 por visita." : "For example: diagnostic visit · $95 per visit."}</p><button type="button" onClick={openPriceBookItems} className="mt-4 inline-flex min-h-12 items-center rounded-lg bg-orange-700 px-4 text-sm font-semibold text-white hover:bg-orange-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">{language === "es" ? "Agregar mi primera tarifa" : "Add my first rate"}</button></div> : <div className="divide-y divide-slate-100">{items.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 p-4"><div><p className="font-semibold">{item.name}</p><p className="text-xs text-slate-500">{item.trade} · per {item.unit}{item.description ? ` · ${item.description}` : ""}</p>{!!item.aliases?.length && <p className="mt-1 text-xs text-slate-600">{language === "es" ? "Nombres alternativos" : "Alternate names"}: {item.aliases.join(", ")}</p>}{learnedAliases.filter((entry) => entry.price_book_item_id === item.id).map((entry) => <div key={entry.alias} className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600"><span>{language === "es" ? "Aprendido de tus selecciones" : "Learned from your choices"}: {entry.alias} · {entry.selections} {language === "es" ? "selecciones" : "selections"}{entry.selections < 2 ? (language === "es" ? " · pendiente" : " · pending") : ""}</span><button type="button" onClick={() => void removeLearnedAlias(item.id, entry.alias)} className="font-semibold text-red-700 underline">{language === "es" ? "Quitar" : "Remove"}</button></div>)}</div><div className="flex items-center gap-3"><span className="font-semibold tabular-nums">${Number(item.unit_price).toFixed(2)}</span><button onClick={() => editItem(item)} className="inline-flex min-h-12 items-center text-xs font-semibold text-blue-700 underline">Edit</button><button onClick={() => void removeItem(item.id)} aria-label={`Delete ${item.name}`} className="inline-flex min-h-12 items-center text-xs font-semibold text-red-700 underline">Remove</button></div></div>)}</div>}
            </section>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            <section className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Build a reusable template</h2>
              <p className="text-sm text-slate-600">Set up the scope, quantities, and rates in the estimate builder, then save the complete estimate as a template.</p>
              <Link href="/estimate/new" className="inline-flex min-h-12 items-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">Open estimate builder</Link>
            </section>
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5"><h2 className="font-semibold">Reusable templates</h2></div>
              {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading templates…</p> : templates.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No templates yet.</p> : <div className="divide-y divide-slate-100">{templates.map((template) => <div key={template.id} className="flex items-center justify-between gap-3 p-4"><div><p className="font-semibold">{template.name}</p><p className="text-xs text-slate-500">{template.trade} · {template.line_items?.length ?? 0} starter line items</p></div><div className="flex gap-3"><button onClick={() => applyTemplate(template)} className="inline-flex min-h-12 items-center text-xs font-semibold text-blue-700 underline">Use template</button><button onClick={async () => { const { error: deleteError } = await supabase.from("estimate_templates").delete().eq("id", template.id); if (deleteError) setError("Could not delete this estimate template. Please try again."); else setTemplates((current) => current.filter((item) => item.id !== template.id)); }} className="inline-flex min-h-12 items-center text-xs font-semibold text-red-700 underline">Delete</button></div></div>)}</div>}
            </section>
          </div>
        )}
      </div>
    </main>
    </LocalizedTree>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block space-y-1.5 text-xs font-medium text-slate-700"><span>{label}</span>{children}</label>; }
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) { return <button onClick={onClick} className={`inline-flex min-h-12 items-center rounded-lg px-4 py-2 text-sm font-semibold ${active ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>{children}</button>; }
