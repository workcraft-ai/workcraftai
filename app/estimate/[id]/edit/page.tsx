"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { readAllPages } from "@/lib/read-all-pages";
import { applyPriceBookRates } from "@/lib/priceBookPricing.mjs";
import { estimateDraftReviewNotes } from "@/lib/estimateDraftReview.mjs";
import { DEFAULT_ESTIMATE_TRADES, parseEstimateTradeOptions } from "@/lib/estimate-trades";
import { attachmentMimeType, invalidEstimateAttachment, supportedAttachmentMimeTypes, uploadEstimateAttachments, type EstimateAttachment } from "@/lib/estimate-attachments";
import { LocalizedTree, translate, useLanguage } from "@/app/components/LanguageProvider";
import { calculateEstimateMoney } from "@/lib/estimate-money.mjs";
import { getClientProEntitlement } from "@/lib/client-pro-access";
import PackageTotalInput from "@/app/components/PackageTotalInput";
import { ProPlanAction } from "@/app/components/ProPlanExperience";

interface LineItemInput {
  description: string;
  description_es?: string;
  quantity: number;
  unit?: string;
  unit_price: number;
  pricing_source?: "price_book" | "ai_suggested" | "unpriced" | "manual";
  pricing_assumption?: string;
  pricing_assumption_es?: string;
  review_note?: string;
  review_note_es?: string;
  review_notes?: string[];
  price_book_suggestions?: PriceBookSuggestion[];
}

interface PriceBookItem {
  id: string; name: string; description: string; trade: string; unit: string; unit_price: number; pricing_basis?: string;
}

type PriceBookSuggestion = {
  id?: string; name: string; description?: string; trade: string; unit: string; unit_price: number; pricing_basis?: string; match_score: number;
};

type AiAllowance = { enabled: boolean; daily_limit: number; used: number; remaining: number; monthly_limit: number; monthly_used: number; monthly_remaining: number };
type MediaAllowance = { monthly_used_bytes: number; monthly_limit_bytes: number; retained_bytes: number; retained_limit_bytes: number; file_count: number; file_limit: number };
type ExistingAttachment = { id: string; media_type: "photo" | "voice"; url: string; created_at: string };
type SavedCustomer = { id: string; name: string; email: string; phone: string; job_address: string };

interface EstimatePackage {
  name: "Good" | "Better" | "Best";
  description: string;
  description_es?: string;
  total: number;
}

export default function EditEstimatePage() {
  const router = useRouter();
  const params = useParams();
  const { language } = useLanguage();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [isPro, setIsPro] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [isEditable, setIsEditable] = useState(true);
  const [savedCustomers, setSavedCustomers] = useState<SavedCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [savedCustomerLoadError, setSavedCustomerLoadError] = useState("");
  const [trade, setTrade] = useState(DEFAULT_ESTIMATE_TRADES[0].value);
  const [estimateTrades, setEstimateTrades] = useState(DEFAULT_ESTIMATE_TRADES);
  const [priceBookItems, setPriceBookItems] = useState<PriceBookItem[]>([]);
  const [priceBookLoading, setPriceBookLoading] = useState(true);
  const [priceBookLoadFailed, setPriceBookLoadFailed] = useState(false);
  const [showPriceBook, setShowPriceBook] = useState(false);
  const [selectedPriceBookItemId, setSelectedPriceBookItemId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const [promptText, setPromptText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [aiDailyAllowance, setAiDailyAllowance] = useState<AiAllowance | null>(null);
  const [aiRateConfirmationKey, setAiRateConfirmationKey] = useState("");
  const [draftReviewConfirmationKey, setDraftReviewConfirmationKey] = useState("");
  const [mediaAllowance, setMediaAllowance] = useState<MediaAllowance | null>(null);
  const [existingAttachments, setExistingAttachments] = useState<ExistingAttachment[]>([]);
  const [attachments, setAttachments] = useState<EstimateAttachment[]>([]);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const uploadedAttachmentFilesRef = useRef<Set<File>>(new Set());
  const [savedWithPendingMedia, setSavedWithPendingMedia] = useState(false);

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
  const [proposalDisplayMode, setProposalDisplayMode] = useState<"detailed" | "summary">("detailed");
  const [proposalSummary, setProposalSummary] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [paymentTermsEs, setPaymentTermsEs] = useState("");

  // Line Items State
  const [lineItems, setLineItems] = useState<LineItemInput[]>([]);
  const [packageOptions, setPackageOptions] = useState<EstimatePackage[]>([]);
  const [zeroRateConfirmationKey, setZeroRateConfirmationKey] = useState("");

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

        setReferenceNumber(typeof estimate.reference_number === "string" ? estimate.reference_number : "");
        setIsEditable(!["accepted", "paid"].includes(String(estimate.status).toLowerCase()));
        setTrade(typeof estimate.trade === "string" && estimate.trade.trim() ? estimate.trade : DEFAULT_ESTIMATE_TRADES[0].value);
        setExistingAttachments(Array.isArray(data.attachments) ? data.attachments : []);
        setClientName(estimate.client_name || "");
        setClientEmail(estimate.client_email || "");
        setClientPhone(estimate.client_phone || "");
        setJobAddress(estimate.job_address || "");
        setTaxRate(Number(estimate.tax_rate) || 0);
        setMarkupPercentage(Number(estimate.markup_percentage) || 0);
        setProposalLanguage(estimate.proposal_language === "es" ? "es" : "en");
        setProposalDisplayMode(estimate.proposal_display_mode === "summary" ? "summary" : "detailed");
        setProposalSummary(typeof estimate.proposal_summary === "string" ? estimate.proposal_summary : "");
        setPaymentTerms(typeof estimate.payment_terms === "string" ? estimate.payment_terms : "");
        setPaymentTermsEs(typeof estimate.payment_terms_es === "string" ? estimate.payment_terms_es : "");
        const { data: { user } } = await supabase.auth.getUser();
        const entitlement = user ? await getClientProEntitlement() : null;
        const activePro = entitlement?.has_pro === true;
        setIsPro(activePro);
        if (activePro) {
          void fetch("/api/generate-estimate", { cache: "no-store" }).then(async (response) => {
            if (response.ok) setAiDailyAllowance(await response.json() as AiAllowance);
          }).catch(() => {});
        }
        setRequireDeposit(activePro ? (estimate.require_deposit ?? false) : false);
        setDepositPercentage(estimate.deposit_percentage || 20);
        setPackageOptions(activePro && Array.isArray(estimate.package_options) ? estimate.package_options : []);

        setLineItems(
        items.map((i: { description: string; description_es?: string; quantity: number; unit?: string; unit_price: number }) => ({
            description: i.description,
            description_es: i.description_es || "",
            quantity: i.quantity,
            unit: i.unit || "each",
            unit_price: i.unit_price,
          }))
        );
      } catch {
        setFormError("Could not load the estimate details.");
      } finally {
        setLoading(false);
      }
    }

    if (id) loadEstimate();
  }, [id, router]);

  useEffect(() => {
    let active = true;
    void fetch("/api/estimate/trades", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const options = parseEstimateTradeOptions((await response.json()).trades);
      if (active && options) setEstimateTrades(options);
    }).catch(() => {});
    void readAllPages((from, to) => supabase.from("price_book_items")
      .select("id, name, description, trade, unit, unit_price, pricing_basis")
      .order("name").order("id").range(from, to)).then(({ data, error }) => {
        if (!active) return;
        setPriceBookItems((data ?? []) as PriceBookItem[]);
        setPriceBookLoadFailed(Boolean(error));
        setPriceBookLoading(false);
      });
    void readAllPages((from, to) => supabase.from("customer_contacts")
      .select("id, name, email, phone, job_address")
      .order("name").order("id").range(from, to)).then(({ data, error }) => {
        if (!active) return;
        setSavedCustomers((data ?? []) as SavedCustomer[]);
        if (error) setSavedCustomerLoadError("Saved customers could not be loaded.");
      });
    void fetch("/api/account/usage", { cache: "no-store" }).then(async (response) => {
      if (active && response.ok) setMediaAllowance((await response.json()).media as MediaAllowance);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const handleAddItem = () => {
    setLineItems([...lineItems, { description: "", description_es: "", quantity: 1, unit: "each", unit_price: 0, pricing_source: "manual" }]);
  };

  const addSelectedPriceBookItem = () => {
    const item = priceBookItems.find((entry) => entry.id === selectedPriceBookItemId);
    if (!item) return;
    setLineItems((current) => [...current, {
      description: item.description ? `${item.name} — ${item.description}` : item.name,
      quantity: 1, unit: item.unit, unit_price: Number(item.unit_price), pricing_source: "price_book",
    }]);
    setSelectedPriceBookItemId("");
  };

  const saveTemplate = async () => {
    if (!templateName.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setTemplateMessage(language === "es" ? "Inicia sesión para guardar plantillas." : "Sign in to save templates."); return; }
    const { error } = await supabase.from("estimate_templates").insert({
      user_id: user.id, name: templateName.trim(), trade,
      line_items: lineItems.filter((item) => item.description.trim()).map(({ description, description_es, quantity, unit, unit_price }) => ({ description, description_es, quantity, unit: unit || "each", unit_price })),
      package_options: packageOptions, require_deposit: requireDeposit, deposit_percentage: depositPercentage,
    });
    setTemplateMessage(error ? language === "es" ? "No se pudo guardar la plantilla." : "Could not save the template." : language === "es" ? "Plantilla guardada en tu lista de precios." : "Template saved to your price book.");
    if (!error) setTemplateName("");
  };

  const handleGenerateItems = async () => {
    if (!isPro || !promptText.trim() || priceBookLoading || priceBookLoadFailed) return;
    setIsGenerating(true);
    setDraftMessage("");
    try {
      const response = await fetch("/api/generate-estimate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText, trade, proposal_language: proposalLanguage }),
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "AI drafting is unavailable.");
      if (!Array.isArray(result.line_items) || !result.line_items.length) throw new Error("No usable line items were returned.");
      const priced = applyPriceBookRates(result.line_items, priceBookItems, trade);
      const matched = new Set<number>(priced.matchedIndexes);
      const generated = priced.lines.map((item: LineItemInput, index: number) => ({
        ...item, unit: item.unit || "each",
        pricing_source: matched.has(index) ? "price_book" as const : Number(item.unit_price) > 0 ? "ai_suggested" as const : "unpriced" as const,
        price_book_suggestions: matched.has(index) ? [] : priced.suggestionsByIndex[index] ?? [],
      }));
      setLineItems((current) => [...current.filter((item) => item.description.trim()), ...generated]);
      setZeroRateConfirmationKey("");
      setAiRateConfirmationKey("");
      setDraftReviewConfirmationKey("");
      if (typeof result.proposal_summary === "string" && !proposalSummary.trim()) setProposalSummary(result.proposal_summary.trim().slice(0, 1200));
      setAiDailyAllowance((current) => current ? {
        ...current,
        remaining: typeof result.remaining_daily_generations === "number" ? result.remaining_daily_generations : current.remaining,
        monthly_remaining: typeof result.remaining_monthly_generations === "number" ? result.remaining_monthly_generations : current.monthly_remaining,
      } : current);
      setPromptText("");
      setDraftMessage(language === "es"
        ? `Se agregaron ${generated.length} partidas. ${priced.matchedCount} coincidieron con tu lista de precios. Revisa todas las cantidades, unidades y tarifas antes de compartir.`
        : `Added ${generated.length} line items. ${priced.matchedCount} matched your Price Book. Review every quantity, unit, and rate before sharing.`);
    } catch (error) {
      setDraftMessage(`${language === "es" ? "No se pudo generar el borrador: " : "Could not generate the draft: "}${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const startVoiceNote = async () => {
    if (existingAttachments.some((item) => item.media_type === "voice")) {
      setDraftMessage(language === "es" ? "Quita la nota de voz guardada antes de grabar otra." : "Remove the saved voice note before recording another.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setDraftMessage(language === "es" ? "Este navegador no permite grabar voz." : "Voice recording is not supported by this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: (recorder.mimeType || "audio/webm").split(";", 1)[0].toLowerCase() });
        const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
        setAttachments((current) => [...current.filter((item) => item.mediaType !== "voice"), { mediaType: "voice", file: new File([blob], `field-note-${Date.now()}.${extension}`, { type: blob.type }) }]);
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setRecording(false);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setDraftMessage(language === "es" ? "Permite usar el micrófono para grabar una nota." : "Allow microphone access to record a field note.");
    }
  };

  const retryMediaUpload = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setFormError(language === "es" ? "Inicia sesión para subir archivos." : "Sign in to upload attachments."); return; }
    setSaving(true);
    try {
      await uploadEstimateAttachments(id, user.id, attachments, uploadedAttachmentFilesRef.current);
      setSavedWithPendingMedia(false);
      router.push(`/estimate/${id}`);
    } catch (error) {
      console.error("Estimate attachment upload failed:", error instanceof Error ? error.message : "unknown error");
      setFormError(language === "es" ? "La cotización se guardó, pero algunos archivos no se subieron. Reintenta los archivos aquí." : "The estimate was saved, but some attachments did not upload. Retry them here.");
    } finally {
      setSaving(false);
    }
  };

  const removeSavedAttachment = async (attachment: ExistingAttachment) => {
    if (!window.confirm(language === "es" ? "¿Quitar este archivo de la cotización?" : "Remove this attachment from the estimate?")) return;
    const response = await fetch(`/api/estimates/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachment.id)}`, { method: "DELETE" });
    if (!response.ok) {
      setFormError(language === "es" ? "No se pudo quitar el archivo guardado. Inténtalo de nuevo." : "Could not remove the saved attachment. Try again.");
      return;
    }
    setExistingAttachments((current) => current.filter((item) => item.id !== attachment.id));
    setFormError("");
  };

  const handleRemoveItem = (index: number) => {
    if (lineItems.length === 1) {
      setFormError(language === "es" ? "La cotización debe incluir al menos una partida." : "Keep at least one line item on the estimate.");
      return;
    }
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const handleItemChange = (
    index: number,
    field: keyof LineItemInput,
    value: string | number
  ) => {
    setFormError("");
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    if (field === "description" || field === "quantity" || field === "unit") {
      updated[index].review_notes = [];
      updated[index].review_note = undefined;
      updated[index].review_note_es = undefined;
    }
    setLineItems(updated);
  };

  const estimateMoney = calculateEstimateMoney({ markup_percentage: markupPercentage, tax_rate: taxRate, require_deposit: requireDeposit, deposit_percentage: depositPercentage }, lineItems);
  const subtotal = estimateMoney.subtotalCents / 100;
  const markupAmount = estimateMoney.markupCents / 100;
  const taxAmount = estimateMoney.taxCents / 100;
  const estimateTotal = estimateMoney.totalCents / 100;
  const depositAmount = estimateMoney.depositCents / 100;
  const zeroRateLineItems = lineItems.filter((item) => item.description.trim() && Number(item.unit_price) === 0);
  const zeroRateReviewKey = JSON.stringify(lineItems.filter((item) => item.description.trim()).map(({ description, quantity, unit_price }) => [description.trim(), Number(quantity), Number(unit_price)]));
  const zeroRateConfirmed = zeroRateLineItems.length === 0 || zeroRateConfirmationKey === zeroRateReviewKey;
  const aiSuggestedLineItems = lineItems.filter((item) => item.description.trim() && item.pricing_source === "ai_suggested");
  const aiRateReviewKey = JSON.stringify(aiSuggestedLineItems.map(({ description, quantity, unit, unit_price }) => [description.trim(), Number(quantity), unit || "each", Number(unit_price)]));
  const aiRatesConfirmed = aiSuggestedLineItems.length === 0 || aiRateConfirmationKey === aiRateReviewKey;
  const reviewNotesByIndex = estimateDraftReviewNotes(trade, lineItems, language).map((notes, index) => [...new Set([
    ...notes, ...(lineItems[index]?.review_notes ?? []),
    language === "es" ? lineItems[index]?.review_note_es || lineItems[index]?.review_note || "" : lineItems[index]?.review_note || "",
  ].filter(Boolean))]);
  const reviewNoteLineItems = lineItems.flatMap((item, index) => item.description.trim() && reviewNotesByIndex[index]?.length ? [{ ...item, review_notes: reviewNotesByIndex[index] }] : []);
  const draftReviewKey = JSON.stringify(reviewNoteLineItems.map(({ description, quantity, unit, review_notes }) => [description.trim(), Number(quantity), unit || "", review_notes]));
  const draftReviewConfirmed = reviewNoteLineItems.length === 0 || draftReviewConfirmationKey === draftReviewKey;

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    const nonEmptyLineItems = lineItems.filter((item) => item.description.trim());
    if (!nonEmptyLineItems.length) {
      setFormError(language === "es" ? "Agrega al menos una partida con una descripción." : "Add at least one line item with a description.");
      return;
    }
    if (nonEmptyLineItems.some((item) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || !Number.isFinite(Number(item.unit_price)) || Number(item.unit_price) < 0)) {
      setFormError(language === "es" ? "Las cantidades deben ser mayores que cero y los precios no pueden ser negativos." : "Quantities must be greater than zero and prices cannot be negative.");
      return;
    }
    if (proposalDisplayMode === "summary" && !proposalSummary.trim()) {
      setFormError(translate(language, "Add a customer-facing work summary or choose detailed line items."));
      return;
    }
    if (proposalSummary.trim().length > 1200) {
      setFormError(translate(language, "The work summary must be 1,200 characters or less."));
      return;
    }
    if (!zeroRateConfirmed || !aiRatesConfirmed || !draftReviewConfirmed) return;
    if (invalidEstimateAttachment(attachments)) {
      setFormError(language === "es" ? "Uno de los archivos adjuntos tiene un formato no compatible, está vacío o es demasiado grande." : "An attachment has an unsupported format, is empty, or is too large.");
      return;
    }
    if (attachments.length && !isPro) {
      setFormError(language === "es" ? "Los archivos adjuntos requieren Pro." : "Attachments require Pro.");
      return;
    }
    setSaving(true);
    let estimateUpdated = false;

    try {
      if (attachments.length) {
        const usageResponse = await fetch("/api/account/usage", { cache: "no-store" });
        if (!usageResponse.ok) throw new Error("Could not check media allowance.");
        const currentMedia = (await usageResponse.json()).media as MediaAllowance;
        if (!currentMedia) throw new Error("Could not check media allowance.");
        const requestedBytes = attachments.reduce((total, attachment) => total + attachment.file.size, 0);
        if (requestedBytes > currentMedia.monthly_limit_bytes - currentMedia.monthly_used_bytes ||
          requestedBytes > currentMedia.retained_limit_bytes - currentMedia.retained_bytes ||
          attachments.length + currentMedia.file_count > currentMedia.file_limit) {
          throw new Error("Media allowance exceeded.");
        }
      }
      const res = await fetch(`/api/estimates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientName,
          client_email: clientEmail,
          client_phone: clientPhone,
          job_address: jobAddress,
          trade,
          require_deposit: requireDeposit,
          deposit_percentage: depositPercentage,
          tax_rate: taxRate,
          markup_percentage: markupPercentage,
          proposal_language: proposalLanguage,
          proposal_display_mode: proposalDisplayMode,
          proposal_summary: proposalSummary.trim() || null,
          payment_terms: paymentTerms.trim() || null,
          payment_terms_es: paymentTermsEs.trim() || null,
          package_options: isPro ? packageOptions : [],
          lineItems: nonEmptyLineItems.map((item) => ({ description: item.description.trim(), description_es: item.description_es?.trim() || null, quantity: item.quantity, unit: item.unit?.trim() || "each", unit_price: item.unit_price })),
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      estimateUpdated = true;

      if (attachments.length) {
        setSavedWithPendingMedia(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Sign in to upload attachments.");
        await uploadEstimateAttachments(id, user.id, attachments, uploadedAttachmentFilesRef.current);
        setSavedWithPendingMedia(false);
      }
      router.push(`/estimate/${id}`);
    } catch (err: unknown) {
      console.error("Estimate update failed:", err instanceof Error ? err.message : "unknown error");
      if (estimateUpdated && attachments.length) setSavedWithPendingMedia(true);
      setFormError(estimateUpdated && attachments.length
        ? language === "es" ? "La cotización se actualizó, pero algunos archivos no se subieron. Reintenta solo los archivos." : "The estimate was updated, but some attachments did not upload. Retry only the attachments."
        : language === "es" ? "No se pudo actualizar la cotización. Revisa los datos e inténtalo de nuevo." : "We couldn’t update this estimate. Check the details and try again.");
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

  if (!isEditable) {
    return <div className="mx-auto max-w-2xl p-6"><h1 className="text-xl font-bold">{language === "es" ? "Esta cotización no se puede editar" : "This estimate cannot be edited"}</h1><p className="mt-2 text-sm text-slate-700">{language === "es" ? "La cotización ya fue aprobada o pagada. Crea una nueva cotización si deben cambiar las condiciones." : "The estimate has been approved or paid. Create a new estimate if the terms need to change."}</p><Link href={`/estimate/${id}`} className="mt-4 inline-flex min-h-11 items-center font-semibold text-blue-700 underline">{language === "es" ? "Volver a la cotización" : "Back to estimate"}</Link></div>;
  }

  return (
    <LocalizedTree>
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-5xl mx-auto space-y-6">
        <form
          noValidate
          onSubmit={handleUpdate}
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6"
        >
          {formError && <div role="alert" aria-live="assertive" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-900"><p>{formError}</p>{savedWithPendingMedia && <button type="button" onClick={() => void retryMediaUpload()} disabled={saving} className="mt-2 min-h-11 rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-50">{language === "es" ? "Reintentar solo los archivos" : "Retry attachments only"}</button>}</div>}
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Edit Estimate</h1>
              {referenceNumber && <p className="text-xs font-medium text-slate-600">Estimate #{referenceNumber}</p>}
            </div>
            <button
              type="button"
              onClick={() => router.push(`/estimate/${id}`)}
              className="text-xs text-slate-500 hover:text-slate-800 font-medium"
            >
              Cancel
            </button>
          </div>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div><h2 className="text-sm font-semibold text-slate-900">Customer quote format</h2><p className="mt-1 text-xs text-slate-600">Choose how much detail the customer sees on the proposal.</p></div>
            <fieldset className="flex flex-wrap gap-3" aria-label="Proposal detail">
              <legend className="sr-only">Proposal detail</legend>
              <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><input type="radio" name="proposal-display-mode" value="detailed" checked={proposalDisplayMode === "detailed"} onChange={() => setProposalDisplayMode("detailed")} /><span>Detailed line items</span></label>
              <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><input type="radio" name="proposal-display-mode" value="summary" checked={proposalDisplayMode === "summary"} onChange={() => setProposalDisplayMode("summary")} /><span>Summary and total only</span></label>
            </fieldset>
            {proposalDisplayMode === "summary" && <label className="block text-xs font-medium text-slate-700">Customer-facing work summary
              <textarea value={proposalSummary} maxLength={1200} onChange={(event) => setProposalSummary(event.target.value)} rows={3} placeholder="Briefly describe the work included in this quote" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal" />
              <span className="mt-1 block text-xs text-slate-500">The proposal will show this summary and the total, without individual quantities or rates. You can edit the AI draft.</span>
            </label>}
          </section>


          {/* Client Details */}
          <div className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Client Information
            </h2>
            <div className="rounded-lg border border-slate-200 bg-white p-3"><label htmlFor="edit-saved-customer" className="block text-xs font-medium text-slate-700">{language === "es" ? "Usar un cliente guardado" : "Use a saved customer"}</label><div className="mt-1 flex flex-wrap items-center gap-3"><select id="edit-saved-customer" value={selectedCustomerId} onChange={(event) => {
              setSelectedCustomerId(event.target.value);
              const customer = savedCustomers.find((item) => item.id === event.target.value);
              if (customer) { setClientName(customer.name); setClientEmail(customer.email); setClientPhone(customer.phone); setJobAddress(customer.job_address); }
            }} className="min-h-12 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">{language === "es" ? "Elige un cliente guardado" : "Choose a saved customer"}</option>{savedCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.email ? ` · ${customer.email}` : ""}</option>)}</select><Link href="/customers" className="text-xs font-semibold text-blue-700 underline">{language === "es" ? "Administrar clientes" : "Manage saved customers"}</Link></div>{selectedCustomerId && <p className="mt-2 text-xs text-slate-500">{language === "es" ? "Los cambios aquí solo afectan esta cotización." : "Changes here affect this estimate only."}</p>}{savedCustomerLoadError && <p role="status" className="mt-2 text-xs text-amber-800">{language === "es" ? "No se pudieron cargar los clientes guardados." : savedCustomerLoadError}</p>}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-client-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Client Name *
                </label>
                <input
                  id="edit-client-name"
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="min-h-12 w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="edit-client-email" className="block text-xs font-medium text-slate-700 mb-1">
                  {language === "es" ? "Correo electrónico del cliente (opcional)" : "Customer email (optional)"}
                </label>
                <input
                  id="edit-client-email"
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className="min-h-12 w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="edit-client-phone" className="block text-xs font-medium text-slate-700 mb-1">
                  Client Phone
                </label>
                <input
                  id="edit-client-phone"
                  type="tel"
                  inputMode="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  className="min-h-12 w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="edit-job-address" className="block text-xs font-medium text-slate-700 mb-1">
                  Job Address
                </label>
                <input
                  id="edit-job-address"
                  type="text"
                  value={jobAddress}
                  onChange={(e) => setJobAddress(e.target.value)}
                  className="min-h-12 w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="edit-trade" className="block text-xs font-medium text-slate-700 mb-1">{language === "es" ? "Oficio" : "Trade"}</label>
                <select id="edit-trade" value={trade} onChange={(event) => setTrade(event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  {!estimateTrades.some((option) => option.value === trade) && <option value={trade}>{trade}</option>}
                  {estimateTrades.map((option) => <option key={option.value} value={option.value}>{language === "es" ? option.label_es : option.value}</option>)}
                </select>
              </div>
              <div><label htmlFor="edit-proposal-language" className="block text-xs font-medium text-slate-700 mb-1">Customer proposal language</label><select id="edit-proposal-language" value={proposalLanguage} onChange={(event) => setProposalLanguage(event.target.value === "es" ? "es" : "en")} className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm"><option value="en">English proposal</option><option value="es">Spanish proposal</option></select></div>
            </div>
          </div>

          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-sm font-semibold text-slate-900">{language === "es" ? "Fotos del trabajo y nota de voz" : "Field photos & voice note"}{!isPro ? " · Pro" : ""}</h2><p className="mt-1 text-xs text-slate-600">{language === "es" ? "Hasta 6 fotos y una nota de voz. Los archivos se guardan de forma privada; solo las fotos aparecen en la propuesta." : "Up to 6 photos and one voice note. Files are stored privately; only photos appear on the proposal."}</p></div>
              {isPro ? <div className="flex flex-wrap gap-2"><label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">{language === "es" ? "Agregar fotos" : "Add photos"}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" multiple className="sr-only" onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                const photos = selected.filter((file) => attachmentMimeType(file).startsWith("image/") && supportedAttachmentMimeTypes.has(attachmentMimeType(file)) && file.size > 0 && file.size <= 8 * 1048576);
                setAttachments((current) => {
                  const existingPhotoCount = existingAttachments.filter((item) => item.media_type === "photo").length;
                  const available = Math.max(0, 6 - existingPhotoCount);
                  return [...current.filter((item) => item.mediaType !== "photo"), ...[...current.filter((item) => item.mediaType === "photo"), ...photos.map((file) => ({ file, mediaType: "photo" as const }))].slice(0, available)];
                });
                if (photos.length !== selected.length || photos.length + attachments.filter((item) => item.mediaType === "photo").length + existingAttachments.filter((item) => item.media_type === "photo").length > 6) setDraftMessage(language === "es" ? "Solo se agregaron fotos compatibles de hasta 8 MB, con un máximo de 6 fotos." : "Only supported photos up to 8 MB were added, with a limit of 6 photos.");
                event.currentTarget.value = "";
              }} /></label><button type="button" onClick={() => recording ? recorderRef.current?.stop() : void startVoiceNote()} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">{recording ? language === "es" ? "Detener grabación" : "Stop recording" : language === "es" ? "Grabar nota de voz" : "Record voice note"}</button></div> : <ProPlanAction className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700" />}
            </div>
            {mediaAllowance && isPro && <p className="mt-2 text-xs text-slate-600">{language === "es" ? "Espacio de archivos disponible este mes:" : "Media upload space left this month:"} {(Math.max(0, mediaAllowance.monthly_limit_bytes - mediaAllowance.monthly_used_bytes) / 1048576).toFixed(1)} MB</p>}
            {recording && <p role="status" className="mt-2 text-xs font-semibold text-red-700">{language === "es" ? "Grabando… Detén la grabación para adjuntarla." : "Recording… Stop to attach it."}</p>}
            {existingAttachments.length > 0 && <div className="mt-3"><h3 className="text-xs font-semibold text-slate-700">{language === "es" ? "Archivos guardados" : "Saved attachments"}</h3><ul className="mt-1 space-y-1">{existingAttachments.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-3"><a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-700 underline">{item.media_type === "photo" ? language === "es" ? "Ver foto" : "View photo" : language === "es" ? "Escuchar nota de voz" : "Listen to voice note"}</a><button type="button" onClick={() => void removeSavedAttachment(item)} className="min-h-10 text-xs font-semibold text-red-700 underline">{language === "es" ? "Quitar" : "Remove"}</button></li>)}</ul></div>}
            {attachments.length > 0 && <ul className="mt-3 space-y-1.5">{attachments.map(({ file, mediaType }, index) => <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-xs"><span className="truncate">{mediaType === "photo" ? language === "es" ? "Foto" : "Photo" : language === "es" ? "Nota de voz" : "Voice note"}: {file.name} ({(file.size / 1048576).toFixed(1)} MB)</span><button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="font-semibold text-red-700 underline">{language === "es" ? "Quitar" : "Remove"}</button></li>)}</ul>}
          </section>

          {/* Line Items Editor */}
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-sm font-semibold text-slate-900">Estimate pricing</h2>
            <p className="mt-1 text-xs text-slate-600">Markup is applied before sales tax. Check local tax rules for taxable labor and materials.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-700">Markup (%)<input type="number" min="0" max="500" step="0.01" value={markupPercentage} onChange={(event) => setMarkupPercentage(Number(event.target.value) || 0)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" /></label><label className="text-xs font-medium text-slate-700">Sales tax (%)<input type="number" min="0" max="100" step="0.001" value={taxRate} onChange={(event) => setTaxRate(Number(event.target.value) || 0)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" /></label></div>
          </section>

          {/* Line Items Editor */}
          <div className="space-y-3">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Scope & Line Items
              </h2>
              <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => setShowPriceBook((current) => !current)} className="min-h-11 text-xs font-semibold text-blue-700 underline">{showPriceBook ? language === "es" ? "Cerrar lista de precios" : "Close price book" : language === "es" ? "+ Agregar de lista de precios" : "+ Add from price book"}</button><button
                type="button"
                onClick={handleAddItem}
                className="min-h-11 text-xs font-semibold text-blue-600 hover:text-blue-500"
              >
                + Add Line Item
              </button></div>
            </div>

            {showPriceBook && <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
              {priceBookLoading ? <p role="status" className="text-sm">{language === "es" ? "Cargando lista de precios…" : "Loading price book…"}</p> : priceBookLoadFailed ? <p role="alert" className="text-sm text-red-800">{language === "es" ? "No se pudo cargar la lista de precios. Actualiza la página." : "Could not load the price book. Refresh to try again."}</p> : priceBookItems.length ? <><label className="min-w-48 flex-1 text-xs font-medium text-slate-700">{language === "es" ? "Partida guardada" : "Saved item"}<select value={selectedPriceBookItemId} onChange={(event) => setSelectedPriceBookItemId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">{language === "es" ? "Elige una partida" : "Choose an item"}</option>{priceBookItems.map((item) => <option key={item.id} value={item.id}>{item.name} · ${Number(item.unit_price).toFixed(2)} / {item.unit}</option>)}</select></label><button type="button" disabled={!selectedPriceBookItemId} onClick={addSelectedPriceBookItem} className="min-h-11 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50">{language === "es" ? "Agregar partida" : "Add item"}</button></> : <p className="text-sm text-slate-600">{language === "es" ? "Tu lista de precios está vacía." : "Your price book is empty."} <Link href="/pricebook" className="font-semibold text-blue-700 underline">{language === "es" ? "Agregar tarifas" : "Add your rates"}</Link></p>}
            </div>}

            <div className="space-y-3">
              {lineItems.map((item, index) => (
                <div
                  key={index}
                  className="space-y-2 rounded-lg border border-slate-200/80 bg-slate-50 p-2.5"
                >
                  <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:items-center">
                  <input
                    aria-label={`Line item ${index + 1} description`}
                    type="text"
                    value={item.description}
                    onChange={(e) =>
                      handleItemChange(index, "description", e.target.value)
                    }
                    placeholder="Description"
                    className="col-span-2 min-w-0 w-full rounded-md border border-slate-200 bg-white p-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 sm:col-span-1 sm:flex-1"
                  />
                  <input
                    aria-label={`Line item ${index + 1} quantity`}
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
                    className="min-w-0 w-full rounded-md border border-slate-200 bg-white p-2 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-16"
                  />
                  <input
                    aria-label={`Line item ${index + 1} unit`}
                    type="text"
                    maxLength={40}
                    value={item.unit || "each"}
                    onChange={(e) => handleItemChange(index, "unit", e.target.value)}
                    placeholder="Unit"
                    className="min-w-0 w-full rounded-md border border-slate-200 bg-white p-2 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-24"
                  />
                  <input
                    aria-label={`Line item ${index + 1} rate`}
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
                    className="min-w-0 w-full rounded-md border border-slate-200 bg-white p-2 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-24"
                  />
                  <div className="flex min-w-0 items-center justify-between rounded-md px-2 text-sm font-semibold text-slate-700 sm:ml-auto sm:w-20 sm:justify-end sm:rounded-none sm:px-0 sm:text-right sm:text-xs">
                    <span className="text-xs font-medium text-slate-500 sm:hidden">Amount</span>
                    <span className="whitespace-nowrap">${(estimateMoney.lineItemCents[index] / 100).toFixed(2)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(index)}
                    aria-label={`Remove line item ${index + 1}`}
                    className="min-h-12 min-w-12 justify-self-end px-3 text-xs text-slate-400 hover:text-red-500 sm:min-h-0 sm:min-w-0 sm:px-1"
                    title="Remove item"
                  >
                    ✕
                  </button>
                  </div>
                  <input type="text" value={item.description_es ?? ""} onChange={(event) => handleItemChange(index, "description_es", event.target.value)} placeholder="Spanish description (optional)" aria-label={`Spanish description for ${item.description || `line item ${index + 1}`}`} className="w-full rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  {item.pricing_source === "ai_suggested" && <p className="text-xs font-semibold text-amber-800">{language === "es" ? "Precio inicial sugerido por IA. Revisa la tarifa y la unidad antes de compartir." : "AI suggested starting price. Review the rate and unit before sharing."}</p>}
                  {item.pricing_source === "ai_suggested" && (item.pricing_assumption || item.pricing_assumption_es) && <p className="text-xs text-slate-600"><strong>{language === "es" ? "Suposición de precio:" : "Pricing assumption:"}</strong> {language === "es" ? item.pricing_assumption_es || item.pricing_assumption : item.pricing_assumption}</p>}
                  {item.price_book_suggestions?.length ? <div className="flex flex-wrap items-center gap-2 text-xs"><span>{language === "es" ? "Posibles coincidencias en la lista de precios:" : "Possible Price Book matches:"}</span>{item.price_book_suggestions.slice(0, 3).map((suggestion) => <button key={suggestion.id ?? suggestion.name} type="button" onClick={() => { setLineItems((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, unit: suggestion.unit, unit_price: Number(suggestion.unit_price), pricing_source: "price_book", pricing_assumption: undefined, pricing_assumption_es: undefined, price_book_suggestions: [] } : line)); setAiRateConfirmationKey(""); }} className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold text-blue-700">{suggestion.name} · ${Number(suggestion.unit_price).toFixed(2)}/{suggestion.unit}</button>)}</div> : null}
                  {reviewNotesByIndex[index]?.map((note, noteIndex) => <p key={`${index}-${noteIndex}`} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-950">{note}</p>)}
                </div>
              ))}
            </div>
          </div>

          {zeroRateLineItems.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p role="alert" className="font-semibold">One or more line items have a $0 rate. Review the pricing before sharing this proposal.</p>
            <label className="mt-2 flex items-start gap-2">
              <input id="zero-rate-confirmation" type="checkbox" required checked={zeroRateConfirmed} onChange={(event) => setZeroRateConfirmationKey(event.target.checked ? zeroRateReviewKey : "")} className="mt-0.5" />
              <span>I confirmed every $0 line item is intentional.</span>
            </label>
          </div>}

          {aiSuggestedLineItems.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p role="alert" className="font-semibold">{language === "es" ? "Los precios iniciales de IA son estimaciones generales, no cotizaciones locales. Revisa las unidades, cantidades, mano de obra y materiales." : "AI starting rates are broad estimates, not local quotes. Check units, quantities, labor, and materials."}</p><label className="mt-2 flex items-start gap-2"><input type="checkbox" required checked={aiRatesConfirmed} onChange={(event) => setAiRateConfirmationKey(event.target.checked ? aiRateReviewKey : "")} className="mt-0.5" /><span>{language === "es" ? "Revisé y ajusté los precios sugeridos para este trabajo." : "I reviewed and adjusted the suggested rates for this job."}</span></label></div>}
          {reviewNoteLineItems.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">{language === "es" ? "Revisa las medidas y el alcance señalados arriba." : "Review the flagged measurements and scope above."}</p><label className="mt-2 flex items-start gap-2"><input type="checkbox" required checked={draftReviewConfirmed} onChange={(event) => setDraftReviewConfirmationKey(event.target.checked ? draftReviewKey : "")} className="mt-0.5" /><span>{language === "es" ? "Verifiqué las cantidades, unidades y el trabajo incluido." : "I checked the quantities, units, and included work."}</span></label></div>}

          <section className="space-y-3 rounded-xl border border-purple-200 bg-purple-50/70 p-4">
            <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-900">{language === "es" ? "Asistente de IA generativa (Pro)" : "Generative AI Assistant (Pro)"}</h2><span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">Cloud AI</span></div>
            <p className="text-xs text-slate-600">{language === "es" ? "Describe el trabajo y las medidas. La IA agrega partidas editables a las que ya tienes. Las coincidencias claras usan tu lista de precios; revisa los demás precios antes de compartir." : "Describe the work and measurements. AI adds editable line items to the ones already here. Clear matches use your Price Book; review all other rates before sharing."}</p>
            {aiDailyAllowance && <p role="status" className="text-xs text-slate-600">{language === "es" ? `${aiDailyAllowance.remaining} de ${aiDailyAllowance.daily_limit} intentos de IA restantes hoy (UTC). ${aiDailyAllowance.monthly_remaining} restantes este mes.` : `${aiDailyAllowance.remaining} of ${aiDailyAllowance.daily_limit} AI attempts left today (UTC). ${aiDailyAllowance.monthly_remaining} left this month.`}</p>}
            {isPro ? <><label className="block text-xs font-medium text-slate-700">{language === "es" ? "Alcance y detalles del trabajo" : "Job scope and details"}<textarea value={promptText} onChange={(event) => setPromptText(event.target.value)} rows={3} maxLength={6000} placeholder={language === "es" ? "Describe el trabajo, las medidas, los materiales y las exclusiones…" : "Describe the work, measurements, materials, and exclusions…"} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label><button type="button" onClick={() => void handleGenerateItems()} disabled={isGenerating || priceBookLoading || priceBookLoadFailed || !promptText.trim() || (aiDailyAllowance?.remaining ?? 1) <= 0 || (aiDailyAllowance?.monthly_remaining ?? 1) <= 0} className="min-h-11 rounded-lg bg-purple-700 px-4 text-xs font-semibold text-white disabled:opacity-50">{isGenerating ? language === "es" ? "Preparando…" : "Drafting…" : language === "es" ? "Agregar partidas con IA" : "Add AI line items"}</button></> : <div className="rounded-lg border border-purple-200 bg-white p-3"><p className="text-sm font-semibold">{language === "es" ? "La redacción de partidas con IA está incluida con Pro." : "AI line-item drafting is included with Pro."}</p><ProPlanAction className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-purple-700 px-3 text-sm font-semibold text-purple-800" /></div>}
            {priceBookLoadFailed && <p role="alert" className="text-xs text-red-800">{language === "es" ? "No se pudo cargar la lista de precios. Actualiza la página antes de usar IA." : "Price Book could not load. Refresh before using AI."}</p>}
            {draftMessage && <p role="status" className="rounded-md border border-purple-200 bg-white p-3 text-xs text-slate-700">{draftMessage}</p>}
          </section>

          <details className="rounded-lg border border-slate-200 bg-white px-3 py-2"><summary className="cursor-pointer text-xs font-semibold text-blue-700">{language === "es" ? "Guardar este trabajo como plantilla reutilizable" : "Save this scope as a reusable template"}</summary><div className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-48 flex-1 text-xs font-medium text-slate-700">{language === "es" ? "Nombre de la plantilla" : "Template name"}<input value={templateName} onChange={(event) => setTemplateName(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label><button type="button" disabled={!templateName.trim()} onClick={() => void saveTemplate()} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold disabled:opacity-50">{language === "es" ? "Guardar plantilla" : "Save template"}</button>{templateMessage && <p role="status" className="w-full text-xs text-slate-600">{templateMessage}</p>}</div></details>

          {isPro ? <section className="space-y-3 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Good / Better / Best</h2><p className="mt-1 text-xs text-slate-500">Add or adjust service options customers can choose from.</p></div><button type="button" onClick={() => setPackageOptions(packageOptions.length ? [] : ["Good", "Better", "Best"].map((name) => ({ name: name as EstimatePackage["name"], description: "", description_es: "", total: subtotal })))} className="text-xs font-semibold text-blue-700 underline">{packageOptions.length ? "Remove options" : "Add options"}</button></div>
            {packageOptions.length > 0 && <div className="grid gap-3 md:grid-cols-3">{packageOptions.map((option, index) => <div key={option.name} className="space-y-2 rounded-lg bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-600">{option.name}</p><input aria-label={`${option.name} description`} value={option.description} onChange={(event) => setPackageOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} placeholder="What's included?" className="w-full rounded-md border border-slate-300 bg-white p-2 text-xs" /><input aria-label={`${option.name} Spanish description`} value={option.description_es ?? ""} onChange={(event) => setPackageOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description_es: event.target.value } : item))} placeholder="Spanish description (optional)" className="w-full rounded-md border border-slate-300 bg-white p-2 text-xs" /><PackageTotalInput name={option.name} total={option.total} onChange={(total) => setPackageOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, total } : item))} className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm" /></div>)}</div>}
          </section> : <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600"><span>Good / Better / Best options are included with Pro.</span>{" "}<ProPlanAction variant="text" /></section>}

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

              {!isPro && <ProPlanAction variant="text" />}

              {requireDeposit && (
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    aria-label="Deposit percentage"
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
              <span className="text-slate-600">{language === "es" ? "Subtotal de partidas:" : "Line-item subtotal:"}</span>
              <span className="font-bold text-slate-900">${subtotal.toFixed(2)}</span>
            </div>
            {markupPercentage > 0 && <div className="flex justify-between text-sm text-slate-600"><span>{language === "es" ? "Recargo" : "Markup"} ({markupPercentage}%):</span><span>${markupAmount.toFixed(2)}</span></div>}
            {taxRate > 0 && <div className="flex justify-between text-sm text-slate-600"><span>{language === "es" ? "Impuesto" : "Tax"} ({taxRate}%):</span><span>${taxAmount.toFixed(2)}</span></div>}
            <div className="flex justify-between border-t border-slate-200 pt-3 text-sm font-bold text-slate-900"><span>{language === "es" ? "Total de la cotización:" : "Estimate total:"}</span><span>${estimateTotal.toFixed(2)}</span></div>

            {requireDeposit && (
              <div className="flex justify-between items-center text-sm font-semibold text-green-700">
                <span>Updated Deposit ({depositPercentage}%):</span>
                <span>${depositAmount.toFixed(2)}</span>
              </div>
            )}
          </div>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div><h2 className="text-sm font-semibold text-slate-900">Customer payment terms</h2><p className="mt-1 text-xs text-slate-600">Optional. State your deposit, cancellation, and refund terms for this job. Customers will see them before approval and payment.</p></div>
            <label className="block text-xs font-medium text-slate-700">Payment terms (English)
              <textarea value={paymentTerms} maxLength={1000} onChange={(event) => setPaymentTerms(event.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal" />
            </label>
            <label className="block text-xs font-medium text-slate-700">Payment terms (Spanish, optional)
              <textarea value={paymentTermsEs} maxLength={1000} onChange={(event) => setPaymentTermsEs(event.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal" />
            </label>
          </section>


          <p className="text-center text-xs text-slate-600">Updating the proposal does not send an email. Share it from your Dashboard when you are ready.</p>
          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving || savedWithPendingMedia}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors shadow-sm disabled:opacity-50 text-sm"
            >
              {saving ? "Saving Changes..." : savedWithPendingMedia ? language === "es" ? "Reintenta solo los archivos arriba" : "Retry attachments above" : "Save Changes & Update Proposal"}
            </button>
          </div>
        </form>
      </div>
    </div>
    </LocalizedTree>
  );
}
