"use client";

import React, { startTransition, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { applyPriceBookRates } from "@/lib/priceBookPricing.mjs";
import { isEstimateQuotaLimitError } from "@/lib/free-estimate-limit.mjs";
import { clearOfflineEstimateDraft, loadOfflineEstimateDraft, saveOfflineEstimateDraft } from "@/lib/offlineEstimateDraft";
import { LocalizedTree, translate, useLanguage } from "@/app/components/LanguageProvider";
import { calculateEstimateMoney } from "@/lib/estimate-money.mjs";
import { getClientProEntitlement } from "@/lib/client-pro-access";

interface LineItemInput {
  description: string;
  description_es?: string;
  quantity: number;
  unit_price: number;
}

interface PriceBookItem {
  id: string;
  name: string;
  description: string;
  trade: string;
  unit: string;
  unit_price: number;
}

interface SavedCustomer {
  id: string;
  name: string;
  email: string;
  phone: string;
  job_address: string;
}

interface EstimatePackage {
  name: "Good" | "Better" | "Best";
  description: string;
  description_es?: string;
  total: number;
}

interface LocalEstimateDraft {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  jobAddress: string;
  trade: string;
  requireDeposit: boolean;
  depositPercentage: number;
  promptText: string;
  lineItems: LineItemInput[];
  packageOptions: EstimatePackage[];
  savedAt: string;
  taxRate: number;
  markupPercentage: number;
  proposalLanguage: "en" | "es";
}

interface EstimateAttachment { file: File; mediaType: "photo" | "voice"; }
type EstimateAllowance = { daily_used: number; daily_limit: number; monthly_used: number; monthly_limit: number };
type AiAllowance = { enabled: boolean; daily_limit: number; used: number; remaining: number; monthly_limit: number; monthly_used: number; monthly_remaining: number };
type MediaAllowance = { monthly_used_bytes: number; monthly_limit_bytes: number; retained_bytes: number; retained_limit_bytes: number; file_count: number; file_limit: number };

export default function CreateEstimatePage() {
  const router = useRouter();
  const { language } = useLanguage();

  // Paid cloud drafting is available to Pro subscribers only.
  const [isProSubscriber, setIsProSubscriber] = useState(false);
  const [aiDailyAllowance, setAiDailyAllowance] = useState<AiAllowance | null>(null);
  const [estimateAllowance, setEstimateAllowance] = useState<EstimateAllowance | null>(null);
  const [mediaAllowance, setMediaAllowance] = useState<MediaAllowance | null>(null);

  // Form State
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [jobAddress, setJobAddress] = useState("");
  const [savedCustomers, setSavedCustomers] = useState<SavedCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [savedCustomerLoadError, setSavedCustomerLoadError] = useState("");
  const [trade, setTrade] = useState("Plumbing");
  const [requireDeposit, setRequireDeposit] = useState(false);
  const [depositPercentage, setDepositPercentage] = useState(20);
  const [taxRate, setTaxRate] = useState(0);
  const [markupPercentage, setMarkupPercentage] = useState(0);
  const [proposalLanguage, setProposalLanguage] = useState<"en" | "es">("en");
  const [attachments, setAttachments] = useState<EstimateAttachment[]>([]);
  const [connectionOnline, setConnectionOnline] = useState(true);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Pro AI drafting prompt state
  const [promptText, setPromptText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [draftStorageMessage, setDraftStorageMessage] = useState("");

  // Line Items
  const [lineItems, setLineItems] = useState<LineItemInput[]>([
    { description: "", quantity: 1, unit_price: 0 },
  ]);
  const [priceBookItems, setPriceBookItems] = useState<PriceBookItem[]>([]);
  const [showPriceBook, setShowPriceBook] = useState(false);
  const [selectedPriceBookItemId, setSelectedPriceBookItemId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const [packageOptions, setPackageOptions] = useState<EstimatePackage[]>([]);
  const [zeroRateConfirmationKey, setZeroRateConfirmationKey] = useState("");

  const [saving, setSaving] = useState(false);

  const saveDraftOnDevice = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user.id) {
      setDraftStorageMessage("Sign in before saving a private device draft.");
      return;
    }
    const draft: LocalEstimateDraft = {
      clientName, clientEmail, clientPhone, jobAddress, trade, requireDeposit,
      depositPercentage, promptText, lineItems, packageOptions, taxRate, markupPercentage, proposalLanguage, savedAt: new Date().toISOString(),
    };
    void saveOfflineEstimateDraft(session.user.id, draft, attachments.map(({ file, mediaType }) => ({ name: file.name, type: file.type, mediaType, blob: file })))
      .then(() => setDraftStorageMessage("Draft and attachments saved privately in this browser on this device. It includes customer contact details."))
      .catch(() => setDraftStorageMessage("This browser could not save the draft. Check available device storage."));
  };

  const restoreDraftFromDevice = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user.id) {
        setDraftStorageMessage("Sign in to restore a device draft saved for your account.");
        return;
      }
      const stored = await loadOfflineEstimateDraft<LocalEstimateDraft>(session.user.id);
      if (stored) {
        const draft = stored.fields;
        restoreFields(draft);
        setAttachments(stored.attachments.map((item) => ({ mediaType: item.mediaType, file: new File([item.blob], item.name, { type: item.type }) })));
        setDraftStorageMessage(`Draft and ${stored.attachments.length} attachment(s) restored${stored.savedAt ? ` (saved ${new Date(stored.savedAt).toLocaleString()})` : ""}.`);
        return;
      }
      const saved = localStorage.getItem("tradeflow-unsent-estimate-v1");
      if (!saved) {
        setDraftStorageMessage("No saved draft found in this browser.");
        return;
      }
      setDraftStorageMessage("An older device draft has no account owner recorded, so it was not restored. Remove it before using this shared device.");
    } catch {
      setDraftStorageMessage("Could not restore this saved draft. Save a new draft to replace it.");
    }
  };

  const restoreFields = (draft: Partial<LocalEstimateDraft>) => {
    setClientName(draft.clientName ?? ""); setClientEmail(draft.clientEmail ?? "");
    setClientPhone(draft.clientPhone ?? ""); setJobAddress(draft.jobAddress ?? "");
    if (draft.trade) setTrade(draft.trade);
    setRequireDeposit(isProSubscriber && draft.requireDeposit === true);
    setDepositPercentage(Number(draft.depositPercentage) || 20);
    setPromptText(draft.promptText ?? "");
    if (Array.isArray(draft.lineItems)) setLineItems(draft.lineItems);
    setPackageOptions(isProSubscriber && Array.isArray(draft.packageOptions) ? draft.packageOptions : []);
    setTaxRate(Number(draft.taxRate) || 0); setMarkupPercentage(Number(draft.markupPercentage) || 0);
    setProposalLanguage(draft.proposalLanguage === "es" ? "es" : "en");
  };

  const deleteDraftFromDevice = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user.id) {
      setDraftStorageMessage("Sign in to remove the device draft saved for your account.");
      return;
    }
    void clearOfflineEstimateDraft(session.user.id).then(() => {
      // This legacy localStorage entry has no owner marker; remove it only after the
      // user explicitly chooses the device-draft removal action.
      localStorage.removeItem("tradeflow-unsent-estimate-v1");
      setDraftStorageMessage("Saved device draft and attachments removed.");
    });
  };

  useEffect(() => {
    const syncOnline = () => setConnectionOnline(navigator.onLine);
    syncOnline();
    window.addEventListener("online", syncOnline); window.addEventListener("offline", syncOnline);
    return () => { window.removeEventListener("online", syncOnline); window.removeEventListener("offline", syncOnline); mediaStreamRef.current?.getTracks().forEach((track) => track.stop()); };
  }, []);

  useEffect(() => {
    const savedTemplate = sessionStorage.getItem("tradeflow-estimate-template");
    if (savedTemplate) {
      try {
        const template = JSON.parse(savedTemplate);
        startTransition(() => {
          if (Array.isArray(template.line_items) && template.line_items.length) setLineItems(template.line_items);
          if (Array.isArray(template.package_options)) setPackageOptions(template.package_options);
          if (template.trade) setTrade(template.trade);
          if (typeof template.require_deposit === "boolean") setRequireDeposit(template.require_deposit);
          if (template.deposit_percentage) setDepositPercentage(Number(template.deposit_percentage));
        });
        sessionStorage.removeItem("tradeflow-estimate-template");
      } catch {
        sessionStorage.removeItem("tradeflow-estimate-template");
      }
    }
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        void fetch("/api/account/usage", { cache: "no-store" }).then(async (response) => {
          if (!response.ok) return;
          const usage = await response.json();
          if (usage.estimates) setEstimateAllowance(usage.estimates as EstimateAllowance);
          if (usage.media) setMediaAllowance(usage.media as MediaAllowance);
        }).catch(() => {});
      }
      if (user) {
        setTaxRate(Number(user.user_metadata?.tax_rate) || 0);
        setMarkupPercentage(Number(user.user_metadata?.markup_percentage) || 0);
        const entitlement = await getClientProEntitlement();
        const activePro = entitlement?.has_pro === true;
        setIsProSubscriber(activePro);
        if (activePro) {
          void fetch("/api/generate-estimate", { cache: "no-store" }).then(async (response) => {
            if (!response.ok) return;
            const allowance = await response.json();
            setAiDailyAllowance(allowance);
          }).catch(() => {});
        } else {
          setAiDailyAllowance(null);
        }
        if (!activePro) { setRequireDeposit(false); setPackageOptions([]); }
        const { data: customerData, error: customerError } = await supabase
          .from("customer_contacts")
          .select("id, name, email, phone, job_address")
          .order("name", { ascending: true });
        if (customerError) setSavedCustomerLoadError("Saved customers are unavailable until the customer contacts database update is applied.");
        else setSavedCustomers((customerData ?? []) as SavedCustomer[]);
      } else {
        setRequireDeposit(false); setPackageOptions([]);
      }
      const { data } = await supabase.from("price_book_items").select("id, name, description, trade, unit, unit_price").order("name");
      setPriceBookItems((data ?? []) as PriceBookItem[]);
    })();
  }, []);

  // Handle Pro cloud AI line-item drafting.
  const handleGenerateItems = async () => {
    if (!isProSubscriber || !promptText.trim()) return;
    setIsGenerating(true);

    try {
      const res = await fetch("/api/generate-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText, trade }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (typeof data.remaining_daily_generations === "number") {
        setAiDailyAllowance((previous) => previous ? {
          ...previous,
          used: previous.daily_limit - data.remaining_daily_generations,
          remaining: data.remaining_daily_generations,
        } : previous);
      }
      if (typeof data.remaining_monthly_generations === "number") {
        setAiDailyAllowance((previous) => previous ? {
          ...previous,
          monthly_used: previous.monthly_limit - data.remaining_monthly_generations,
          monthly_remaining: data.remaining_monthly_generations,
        } : previous);
      }

      if (!Array.isArray(data.line_items) || data.line_items.length === 0) throw new Error("No usable line items were returned.");
      const priced = applyPriceBookRates(data.line_items, priceBookItems, trade, true);
      setLineItems(priced.lines);
      setDraftMessage(`${priced.matchedCount} line(s) matched your Price Book. Unmatched lines are $0 until you set your own rate.`);
      setPromptText("");
    } catch (err: unknown) {
      void fetch("/api/generate-estimate", { cache: "no-store" }).then(async (response) => {
        if (response.ok) setAiDailyAllowance(await response.json() as AiAllowance);
      }).catch(() => {});
      const errorText = err instanceof Error ? err.message : String(err);
      const translatedError = language !== "es" ? errorText
        : errorText.includes("today’s cloud drafting limit") ? "Alcanzaste el límite diario de redacción con IA en la nube. Se restablece a la medianoche UTC."
          : errorText.includes("this month’s cloud drafting limit") ? "Alcanzaste el límite mensual de redacción con IA en la nube. Se restablece el primer día del próximo mes (UTC)."
            : errorText.includes("today’s cloud drafting capacity") ? "WorkCraft AI alcanzó la capacidad diaria de redacción con IA en la nube. Inténtalo después del restablecimiento UTC."
              : errorText.includes("temporarily paused") ? "La redacción de cotizaciones con IA en la nube está pausada temporalmente. Inténtalo más tarde."
                : errorText.includes("no usable line items") ? "La IA no devolvió partidas utilizables. Agrega detalles del trabajo e inténtalo de nuevo."
                  : errorText;
      alert(`${language === "es" ? "Error al generar la cotización: " : "Error generating estimate: "}${translatedError}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddItem = () => {
    setLineItems([...lineItems, { description: "", quantity: 1, unit_price: 0 }]);
  };

  const addSelectedPriceBookItem = () => {
    const item = priceBookItems.find((priceBookItem) => priceBookItem.id === selectedPriceBookItemId);
    if (!item) return;
    setLineItems((current) => [...current, {
      description: item.description ? `${item.name} — ${item.description}` : item.name,
      quantity: 1,
      unit_price: Number(item.unit_price),
    }]);
    setSelectedPriceBookItemId("");
  };

  const saveTemplate = async () => {
    if (!templateName.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setTemplateMessage("Sign in to save templates."); return; }
    const { error } = await supabase.from("estimate_templates").insert({
      user_id: user.id,
      name: templateName.trim(),
      trade,
      line_items: lineItems,
      package_options: packageOptions,
      require_deposit: requireDeposit,
      deposit_percentage: depositPercentage,
    });
    setTemplateMessage(error ? error.message : "Template saved to your price book.");
    if (!error) setTemplateName("");
  };

  const handleRemoveItem = (index: number) => {
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

  const estimateMoney = calculateEstimateMoney({ markup_percentage: markupPercentage, tax_rate: taxRate, require_deposit: requireDeposit, deposit_percentage: depositPercentage }, lineItems);
  const subtotal = estimateMoney.subtotalCents / 100;
  const markupAmount = estimateMoney.markupCents / 100;
  const taxAmount = estimateMoney.taxCents / 100;
  const estimateTotal = estimateMoney.totalCents / 100;
  const depositAmount = estimateMoney.depositCents / 100;
  const zeroRateLineItems = lineItems.filter((item) => item.description.trim() && Number(item.unit_price) === 0);
  const zeroRateReviewKey = JSON.stringify(lineItems.filter((item) => item.description.trim()).map(({ description, quantity, unit_price }) => [description.trim(), Number(quantity), Number(unit_price)]));
  const zeroRateConfirmed = zeroRateLineItems.length === 0 || zeroRateConfirmationKey === zeroRateReviewKey;

  const startVoiceNote = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setDraftMessage("Voice recording is not supported by this browser."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
        setAttachments((current) => [...current.filter((item) => item.mediaType !== "voice"), { mediaType: "voice", file: new File([blob], `field-note-${Date.now()}.${extension}`, { type: blob.type }) }]);
        stream.getTracks().forEach((track) => track.stop()); mediaStreamRef.current = null; setRecording(false);
      };
      recorderRef.current = recorder; recorder.start(); setRecording(true);
    } catch { setDraftMessage("Allow microphone access to record a field note."); }
  };

  const stopVoiceNote = () => { if (recorderRef.current?.state === "recording") recorderRef.current.stop(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName || !clientEmail) {
      alert("Please fill in client name and email.");
      return;
    }
    const nonEmptyLineItems = lineItems.filter((item) => item.description.trim());
    if (!nonEmptyLineItems.length) {
      alert("Add at least one line item with a description.");
      return;
    }
    if (nonEmptyLineItems.some((item) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || !Number.isFinite(Number(item.unit_price)) || Number(item.unit_price) < 0)) {
      alert("Line item quantities must be greater than zero and prices cannot be negative.");
      return;
    }
    if (!zeroRateConfirmed) return;

    setSaving(true);
    let createdEstimateId: string | null = null;
    try {
      if (!navigator.onLine) throw new Error("You are offline. Save the draft on this device, then reconnect to create and upload it.");
      if (attachments.length > 0 && !isProSubscriber) throw new Error("Photo and voice-note uploads require Pro. Your saved draft remains on this device; remove its attachments or upgrade to continue.");
      const invalidAttachment = attachments.find(({ file, mediaType }) => file.size > (mediaType === "photo" ? 8 * 1024 * 1024 : 15 * 1024 * 1024));
      if (invalidAttachment) throw new Error(`${invalidAttachment.file.name} exceeds the ${invalidAttachment.mediaType === "photo" ? "8 MB photo" : "15 MB voice note"} limit.`);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        throw new Error("Please sign in before creating an estimate.");
      }
      if (attachments.length > 0) {
        const usageResponse = await fetch("/api/account/usage", { cache: "no-store" });
        if (!usageResponse.ok) throw new Error(language === "es" ? "No se pudo verificar el cupo de archivos. Actualiza la página e inténtalo de nuevo antes de guardar la cotización." : "Could not verify your media allowance. Refresh the page and try again before saving the estimate.");
        const currentUsage = await usageResponse.json();
        const latestMedia = currentUsage.media as MediaAllowance | undefined;
        if (latestMedia) setMediaAllowance(latestMedia);
        if (!latestMedia?.monthly_limit_bytes) throw new Error(language === "es" ? "Las cargas privadas de fotos y notas de voz requieren Pro." : "Private photo and voice-note uploads require Pro.");
        const availableBytes = Math.max(latestMedia.monthly_limit_bytes - latestMedia.monthly_used_bytes, 0);
        const retainedBytesAvailable = Math.max(latestMedia.retained_limit_bytes - latestMedia.retained_bytes, 0);
        const requestedBytes = attachments.reduce((total, attachment) => total + attachment.file.size, 0);
        if (requestedBytes > availableBytes) throw new Error(language === "es"
          ? `Tus archivos suman ${(requestedBytes / 1048576).toFixed(1)} MB y quedan ${(availableBytes / 1048576).toFixed(1)} MB de carga este mes. Quita archivos o inténtalo el próximo mes UTC.`
          : `Your attachments total ${(requestedBytes / 1048576).toFixed(1)} MB, with ${(availableBytes / 1048576).toFixed(1)} MB of uploads left this month. Remove files or try again next UTC month.`);
        if (requestedBytes > retainedBytesAvailable || latestMedia.file_count + attachments.length > latestMedia.file_limit) throw new Error(language === "es"
          ? "Estos archivos exceden el almacenamiento restante o el máximo de 100 archivos. Elimina archivos privados antiguos y vuelve a intentarlo."
          : "These attachments exceed your remaining storage or 100-file limit. Remove older private files and try again.");
      }
      // Estimate and line items are validated and committed together on the server.
      const createResponse = await fetch("/api/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientName,
          client_email: clientEmail,
          client_phone: clientPhone,
          job_address: jobAddress,
          trade,
          package_options: packageOptions,
          tax_rate: taxRate,
          markup_percentage: markupPercentage,
          proposal_language: proposalLanguage,
          require_deposit: requireDeposit,
          deposit_percentage: depositPercentage,
          lineItems: nonEmptyLineItems.map((item) => ({ ...item, description: item.description.trim(), description_es: item.description_es?.trim() || null })),
        }),
      });
      const createResult = await createResponse.json();
      if (!createResponse.ok || typeof createResult.id !== "string") {
        throw new Error(typeof createResult.error === "string" ? createResult.error : "Unable to save this estimate.");
      }
      createdEstimateId = createResult.id;

      for (const attachment of attachments) {
        const path = `${user.id}/${createdEstimateId}/${crypto.randomUUID()}-${attachment.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180)}`;
        const { data: reservationRows, error: reservationError } = await supabase.rpc("workcraft_reserve_estimate_media_upload", {
          p_estimate_id: createdEstimateId,
          p_storage_path: path,
          p_size: attachment.file.size,
          p_mime_type: attachment.file.type.toLowerCase(),
        });
        const reservation = Array.isArray(reservationRows) ? reservationRows[0] : reservationRows;
        if (reservationError) throw new Error(`Media upload reservation failed: ${reservationError.message}`);
        if (!reservation?.allowed || typeof reservation.reservation_id !== "string") {
          const reason = reservation?.reason === "monthly_limit" ? "ESTIMATE_MEDIA_MONTHLY_LIMIT" : reservation?.reason === "storage_limit" ? "ESTIMATE_MEDIA_STORAGE_LIMIT" : reservation?.reason === "pro_required" ? "WORKCRAFT_PRO_REQUIRED" : "MEDIA_UPLOAD_UNAVAILABLE";
          throw new Error(reason);
        }
        const { error: uploadError } = await supabase.storage.from("estimate-media").upload(path, attachment.file, { contentType: attachment.file.type, upsert: false });
        if (uploadError) {
          await supabase.rpc("workcraft_finish_estimate_media_upload", { p_reservation_id: reservation.reservation_id, p_uploaded: false });
          throw new Error(`Estimate saved but attachment upload failed: ${uploadError.message}`);
        }
        const { data: uploadRecorded, error: finalizeError } = await supabase.rpc("workcraft_finish_estimate_media_upload", { p_reservation_id: reservation.reservation_id, p_uploaded: true });
        if (finalizeError || uploadRecorded !== true) throw new Error("Estimate saved but uploaded media usage could not be recorded. Please contact support before retrying the upload.");
        const { error: metadataError } = await supabase.from("estimate_attachments").insert({ estimate_id: createdEstimateId, user_id: user.id, storage_path: path, media_type: attachment.mediaType, content_type: attachment.file.type });
        if (metadataError) throw new Error(`Estimate saved but attachment details failed: ${metadataError.message}`);
      }

      // 3. Return to the dashboard so the contractor can review and share the proposal.
      await clearOfflineEstimateDraft(user.id).catch(() => undefined);
      router.push("/dashboard");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const quotaMessage = isEstimateQuotaLimitError(err)
        ? language === "es"
          ? "Alcanzaste el límite de cotizaciones para este período. Revisa el uso y la fecha de restablecimiento en Perfil."
          : "You’ve reached your estimate limit for this period. Check Profile for your usage and reset time."
        : message.includes("ESTIMATE_MEDIA_MONTHLY_LIMIT")
          ? language === "es" ? "Alcanzaste el límite mensual de carga de archivos Pro. Revisa el uso en Perfil." : "You’ve reached the monthly Pro media upload allowance. Check Profile for your usage."
          : message.includes("ESTIMATE_MEDIA_STORAGE_LIMIT")
            ? language === "es" ? "Alcanzaste el límite de almacenamiento Pro. Elimina archivos privados antiguos o revisa Perfil." : "You’ve reached the Pro storage limit. Remove older private files or review Profile."
        : null;
      alert(createdEstimateId
        ? quotaMessage
          ? language === "es" ? `Se creó la cotización ${createdEstimateId}. ${quotaMessage}` : `Estimate ${createdEstimateId} was saved. ${quotaMessage}`
          : `Estimate ${createdEstimateId} was created, but a later save step failed. Open it from your dashboard; do not create it again. Details: ${message}`
        : quotaMessage || "Error creating estimate: " + message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <LocalizedTree>
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Subscription plan status */}
        <div className="bg-slate-900 text-white p-3.5 rounded-xl flex items-center justify-between text-xs shadow-sm">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-200">Mode:</span>
            <span className={isProSubscriber ? "text-purple-400 font-bold" : "text-blue-400 font-bold"}>
              {isProSubscriber ? "✦ Pro Plan (Cloud AI drafting)" : "Free Plan (Price Book + manual estimates)"}
            </span>
          </div>
          {isProSubscriber ? <span className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-semibold text-green-300">Pro active</span> : <Link href="/profile" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-medium text-slate-200 transition-colors hover:bg-slate-700">Upgrade to Pro</Link>}
        </div>
        <div role="status" className={`rounded-lg border px-4 py-2.5 text-xs ${connectionOnline ? "border-green-200 bg-green-50 text-green-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
          {connectionOnline ? "Online · You can create estimates and upload field notes." : "Offline · You can edit and save drafts with photos and voice notes on this device. Reconnect to create the estimate."}
        </div>

        {/* Main Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">WorkCraft AI / Estimates</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">Create an estimate</h1>
              <p className="mt-1 text-sm text-slate-500">Build a clear, editable quote for your next job.</p>
              {estimateAllowance && <p role="status" className={`mt-2 text-xs ${Math.max(estimateAllowance.daily_limit - estimateAllowance.daily_used, 0) === 0 || Math.max(estimateAllowance.monthly_limit - estimateAllowance.monthly_used, 0) === 0 ? "font-semibold text-red-800" : Math.max(estimateAllowance.daily_limit - estimateAllowance.daily_used, 0) <= 2 || Math.max(estimateAllowance.monthly_limit - estimateAllowance.monthly_used, 0) <= 10 ? "font-semibold text-amber-800" : "text-slate-600"}`}>{Math.max(estimateAllowance.daily_limit - estimateAllowance.daily_used, 0)} of {estimateAllowance.daily_limit} estimates left today · {Math.max(estimateAllowance.monthly_limit - estimateAllowance.monthly_used, 0)} of {estimateAllowance.monthly_limit} left this month (UTC)</p>}
            </div>
            <span className="hidden sm:inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">Draft · Unsaved</span>
          </div>

          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-sm font-semibold text-slate-800">Unfinished estimate</h2><p className="mt-1 text-xs text-slate-600">Save or restore a draft in this browser on this device.</p></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={saveDraftOnDevice} className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">Save on this device</button>
                <button type="button" onClick={restoreDraftFromDevice} className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">Restore saved draft</button>
                <button type="button" onClick={deleteDraftFromDevice} className="inline-flex min-h-11 items-center px-2 py-2 text-xs font-semibold text-red-700 underline">Clear saved draft</button>
              </div>
            </div>
            {draftStorageMessage && <p role="status" className="mt-3 text-xs text-slate-600">{draftStorageMessage}</p>}
          </section>

          {/* Client Details Section */}
          <div className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Client Information
            </h2>
            <label className="block max-w-sm text-xs font-medium text-slate-700">Customer proposal language<select value={proposalLanguage} onChange={(event) => setProposalLanguage(event.target.value === "es" ? "es" : "en")} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm"><option value="en">English proposal</option><option value="es">Spanish proposal</option></select></label>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <label htmlFor="saved-customer-picker" className="block text-xs font-medium text-slate-700">Use a saved customer</label>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <select id="saved-customer-picker" value={selectedCustomerId} onChange={(event) => {
                  setSelectedCustomerId(event.target.value);
                  const customer = savedCustomers.find((savedCustomer) => savedCustomer.id === event.target.value);
                  if (customer) {
                    setClientName(customer.name);
                    setClientEmail(customer.email);
                    setClientPhone(customer.phone);
                    setJobAddress(customer.job_address);
                  }
                }} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                  <option value="">Choose a saved customer</option>
                  {savedCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.email ? ` · ${customer.email}` : ""}</option>)}
                </select>
                <Link href="/customers" className="text-xs font-semibold text-blue-700 underline">Manage saved customers</Link>
              </div>
              {selectedCustomerId && <p className="mt-2 text-xs text-slate-500">Changes made here apply to this estimate only; edit the saved contact on the Customers page.</p>}
              {savedCustomerLoadError && <p role="status" className="mt-2 text-xs text-amber-800">{savedCustomerLoadError}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="estimate-trade" className="block text-xs font-medium text-slate-700 mb-1">Trade</label>
                <select
                  id="estimate-trade"
                  value={trade}
                  onChange={(e) => setTrade(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {['Plumbing', 'Electrical', 'Roofing', 'HVAC', 'Painting', 'Carpentry', 'General contracting', 'Other'].map((option) => <option key={option}>{option}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="estimate-client-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Client Name *
                </label>
                <input
                  id="estimate-client-name"
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="estimate-client-email" className="block text-xs font-medium text-slate-700 mb-1">
                  Client Email *
                </label>
                <input
                  id="estimate-client-email"
                  type="email"
                  required
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="john@example.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="estimate-client-phone" className="block text-xs font-medium text-slate-700 mb-1">
                  Client Phone
                </label>
                <input
                  id="estimate-client-phone"
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="(555) 000-0000"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="estimate-job-address" className="block text-xs font-medium text-slate-700 mb-1">
                  Job Address
                </label>
                <input
                  id="estimate-job-address"
                  type="text"
                  value={jobAddress}
                  onChange={(e) => setJobAddress(e.target.value)}
                  placeholder="123 Main St, City, State"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-sm font-semibold text-slate-900">{isProSubscriber ? "Field photos & voice note" : "Field photos & voice note · Pro"}</h2><p className="mt-1 text-xs text-slate-600">{isProSubscriber ? "Attach up to 6 job photos and one recorded voice note. These are saved privately and only photos appear on the proposal." : "Private photo and voice-note storage is included with Pro."}</p>
                {isProSubscriber && mediaAllowance && <p role="status" className={`mt-2 text-xs ${mediaAllowance.monthly_limit_bytes - mediaAllowance.monthly_used_bytes <= 0 ? "font-semibold text-red-800" : mediaAllowance.monthly_limit_bytes - mediaAllowance.monthly_used_bytes <= 10 * 1048576 ? "font-semibold text-amber-800" : "text-slate-600"}`}>
                  {translate(language, `Media allowance: ${(Math.max(mediaAllowance.monthly_limit_bytes - mediaAllowance.monthly_used_bytes, 0) / 1048576).toFixed(1)} MB left to upload this month · ${(mediaAllowance.retained_bytes / 1048576).toFixed(1)} of ${(mediaAllowance.retained_limit_bytes / 1048576).toFixed(0)} MB stored · ${mediaAllowance.file_count} of ${mediaAllowance.file_limit} files (UTC)`)}
                </p>}
              </div>
              {isProSubscriber ? <label className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 ${mediaAllowance && (mediaAllowance.monthly_limit_bytes <= mediaAllowance.monthly_used_bytes || mediaAllowance.retained_limit_bytes <= mediaAllowance.retained_bytes || mediaAllowance.file_count >= mediaAllowance.file_limit) ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>Add photos<input type="file" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" multiple disabled={Boolean(mediaAllowance && (mediaAllowance.monthly_limit_bytes <= mediaAllowance.monthly_used_bytes || mediaAllowance.retained_limit_bytes <= mediaAllowance.retained_bytes || mediaAllowance.file_count >= mediaAllowance.file_limit))} className="sr-only" onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                const photos = selected.filter((file) => file.type.startsWith("image/") && file.size <= 8 * 1024 * 1024);
                setAttachments((current) => {
                  const voiceNotes = current.filter((item) => item.mediaType !== "photo");
                  const nextPhotos = [...current.filter((item) => item.mediaType === "photo").map((item) => item.file), ...photos].slice(0, 6);
                  return [...voiceNotes, ...nextPhotos.map((file) => ({ file, mediaType: "photo" as const }))];
                });
                setDraftMessage(photos.length !== selected.length ? "Only supported photos up to 8 MB each were added." : selected.length > photos.length || attachments.filter((item) => item.mediaType === "photo").length + photos.length > 6 ? "Up to 6 photos can be attached." : "");
                event.currentTarget.value = "";
              }} /></label> : <Link href="/profile" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700">View Pro</Link>}
              {isProSubscriber && (recording ? <button type="button" onClick={stopVoiceNote} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white">Stop recording</button> : <button type="button" disabled={Boolean(mediaAllowance && (mediaAllowance.monthly_limit_bytes <= mediaAllowance.monthly_used_bytes || mediaAllowance.retained_limit_bytes <= mediaAllowance.retained_bytes || mediaAllowance.file_count >= mediaAllowance.file_limit))} onClick={() => void startVoiceNote()} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Record voice note</button>)}
            </div>
            {recording && <p role="status" className="mt-3 text-xs font-medium text-red-700">Recording… Tap “Stop recording” to attach it.</p>}
            {!!attachments.length && <ul className="mt-3 space-y-1.5">{attachments.map(({ file, mediaType }, index) => <li key={`${file.name}-${index}`} className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-xs text-slate-700"><span>{mediaType === "photo" ? "Photo" : "Voice note"}: {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</span><button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="font-semibold text-red-700 underline">Remove</button></li>)}</ul>}
          </section>

          {/* Scope of Work Table */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Scope & Line Items
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setShowPriceBook((open) => !open)} className="inline-flex min-h-11 items-center text-xs font-semibold text-blue-700 hover:text-blue-600">{showPriceBook ? "Close price book" : "+ Add from price book"}</button>
                <button type="button" onClick={handleAddItem} className="inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-600">+ Add line item</button>
              </div>
            </div>

            {showPriceBook && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              {priceBookItems.length ? <>
                <label className="sr-only" htmlFor="estimate-price-book-item">Choose a saved price book item</label>
                <select id="estimate-price-book-item" value={selectedPriceBookItemId} onChange={(event) => setSelectedPriceBookItemId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                  <option value="">Choose a saved item</option>
                  {priceBookItems.map((item) => <option key={item.id} value={item.id}>{item.name} · ${Number(item.unit_price).toFixed(2)} / {item.unit}</option>)}
                </select>
                <button type="button" onClick={addSelectedPriceBookItem} disabled={!selectedPriceBookItemId} className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">Add selected item</button>
              </> : <p className="text-xs text-slate-600">Your price book is empty. <Link href="/pricebook" className="font-semibold text-blue-700 underline">Add your rates</Link></p>}
            </div>}

            <div className="space-y-3">
              {lineItems.map((item, index) => (
                <div key={index} className="space-y-2 rounded-lg border border-slate-200/80 bg-slate-50 p-2.5">
                <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:items-center">
                  <input
                    aria-label={`Line item ${index + 1} description`}
                    type="text"
                    placeholder="Item or service description"
                    value={item.description}
                    onChange={(e) => handleItemChange(index, "description", e.target.value)}
                    className="col-span-2 min-w-0 w-full rounded-md border border-slate-200 bg-white p-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 sm:col-span-1 sm:flex-1"
                  />
                  <input
                    aria-label={`Line item ${index + 1} quantity`}
                    type="number"
                    min="1"
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={(e) => handleItemChange(index, "quantity", parseFloat(e.target.value) || 0)}
                    className="min-w-0 w-full rounded-md border border-slate-200 bg-white p-2 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-16"
                  />
                  <input
                    aria-label={`Line item ${index + 1} rate`}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Rate"
                    value={item.unit_price}
                    onChange={(e) => handleItemChange(index, "unit_price", parseFloat(e.target.value) || 0)}
                    className="min-w-0 w-full rounded-md border border-slate-200 bg-white p-2 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-24"
                  />
                  <div className="flex min-w-0 items-center justify-between rounded-md px-2 text-sm font-semibold text-slate-700 sm:ml-auto sm:w-20 sm:justify-end sm:rounded-none sm:px-0 sm:text-right sm:text-xs">
                    <span className="text-xs font-medium text-slate-500 sm:hidden">Amount</span>
                    <span className="whitespace-nowrap">${(estimateMoney.lineItemCents[index] / 100).toFixed(2)}</span>
                  </div>
                  {lineItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(index)}
                      aria-label={`Remove line item ${index + 1}`}
                      className="min-h-12 min-w-12 justify-self-end px-3 text-xs text-slate-400 hover:text-red-500 sm:min-h-0 sm:min-w-0 sm:px-1"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <input type="text" value={item.description_es ?? ""} onChange={(event) => handleItemChange(index, "description_es", event.target.value)} placeholder="Spanish description (optional)" aria-label={`Spanish description for ${item.description || `line item ${index + 1}`}`} className="w-full rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
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

          {isProSubscriber && <section className="space-y-3 rounded-xl border border-purple-200 bg-purple-50/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Generative AI Assistant (Pro)</h2>
              <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">Cloud AI</span>
            </div>
            <p className="text-xs text-slate-600">Describe the work and measurements. Gemini drafts editable scope and quantities. Matching rates come from your Price Book; unmatched items stay at $0 for you to price.</p>
            {aiDailyAllowance && <p role="status" className={`text-[11px] ${aiDailyAllowance.remaining === 0 || aiDailyAllowance.monthly_remaining === 0 ? "font-semibold text-red-800" : aiDailyAllowance.remaining <= 1 || aiDailyAllowance.monthly_remaining <= 10 ? "font-semibold text-amber-800" : "text-slate-500"}`}>{aiDailyAllowance.enabled ? `${aiDailyAllowance.remaining} of ${aiDailyAllowance.daily_limit} cloud drafting attempts remain today (UTC). ${aiDailyAllowance.monthly_remaining} of ${aiDailyAllowance.monthly_limit} remain this month. Failed provider attempts count.` : "Cloud estimate drafting is temporarily paused."}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <input type="text" aria-label="Describe the work and measurements" value={promptText} onChange={(event) => setPromptText(event.target.value)} placeholder="Describe the work and measurements" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500" />
              <button type="button" onClick={handleGenerateItems} disabled={isGenerating || !promptText.trim() || (aiDailyAllowance?.remaining ?? 1) <= 0 || (aiDailyAllowance?.monthly_remaining ?? 1) <= 0} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-purple-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-purple-600 disabled:opacity-50">{isGenerating ? "Drafting..." : "Draft Line Items"}</button>
            </div>
            {draftMessage && <p role="status" className="rounded-md border border-purple-200 bg-white/80 px-3 py-2 text-xs text-slate-700">{draftMessage}</p>}
          </section>}

          <details className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-blue-700">Save this scope as a reusable template</summary>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="min-w-48 flex-1 text-xs font-medium text-slate-700">Template name<input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="e.g. Standard drain clearing" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
              <button type="button" disabled={!templateName.trim()} onClick={() => void saveTemplate()} className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">Save template</button>
              {templateMessage && <p role="status" className="w-full text-xs text-slate-600">{templateMessage}</p>}
            </div>
          </details>

          {/* Deposit & Financial Options */}
          <div className="bg-slate-50 p-4 rounded-xl space-y-4 border border-slate-200/60">
            <div className="flex items-center justify-between">
              <label className="flex items-center space-x-2 text-sm font-medium text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireDeposit}
                  onChange={(e) => setRequireDeposit(e.target.checked)}
                  disabled={!isProSubscriber}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span>{isProSubscriber ? "Require Down-Payment / Deposit" : "Require Down-Payment / Deposit (Pro)"}</span>
              </label>

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
            {!isProSubscriber && <p className="text-xs text-slate-500"><span>Online deposits and customer payments require Pro and a connected Stripe account.</span>{" "}<Link href="/profile" className="font-semibold text-blue-700 underline">View Pro</Link></p>}

            <div className="pt-3 border-t border-slate-200 flex justify-between items-center text-sm">
              <span className="text-slate-600">Subtotal de partidas:</span>
              <span className="font-bold text-slate-900">${subtotal.toFixed(2)}</span>
            </div>
            {markupPercentage > 0 && <div className="flex justify-between text-sm text-slate-600"><span>Markup ({markupPercentage}%):</span><span>${markupAmount.toFixed(2)}</span></div>}
            {taxRate > 0 && <div className="flex justify-between text-sm text-slate-600"><span>Tax ({taxRate}%):</span><span>${taxAmount.toFixed(2)}</span></div>}
            <div className="flex justify-between border-t border-slate-200 pt-3 text-sm font-bold text-slate-900"><span>Estimate total:</span><span>${estimateTotal.toFixed(2)}</span></div>

            {requireDeposit && (
              <div className="flex justify-between items-center text-sm font-semibold text-green-700">
                <span>Required Deposit ({depositPercentage}%):</span>
                <span>${depositAmount.toFixed(2)}</span>
              </div>
            )}
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-sm font-semibold text-slate-900">Good / Better / Best options</h2><p className="mt-1 text-xs text-slate-500">Offer customers a choice of service levels on the proposal.</p></div>
              {isProSubscriber ? <button type="button" onClick={() => setPackageOptions(packageOptions.length ? [] : ["Good", "Better", "Best"].map((name) => ({ name: name as EstimatePackage["name"], description: "", description_es: "", total: subtotal })))} className="text-xs font-semibold text-blue-700 underline">{packageOptions.length ? "Remove options" : "Add three options"}</button> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">Pro</span>}
            </div>
            {!isProSubscriber && <p className="mt-3 text-xs text-slate-500">Upgrade to Pro to add customer-selectable package options.</p>}
            {packageOptions.length > 0 && <div className="mt-4 grid gap-3 md:grid-cols-3">{packageOptions.map((option, index) => <div key={option.name} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-700">{option.name}</p><input aria-label={`${option.name} option description`} value={option.description} onChange={(event) => setPackageOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} placeholder="Describe what's included" className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs" /><input aria-label={`${option.name} Spanish description`} value={option.description_es ?? ""} onChange={(event) => setPackageOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description_es: event.target.value } : item))} placeholder="Spanish description (optional)" className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs" /><label className="block text-[11px] font-medium text-slate-600">Package total<input aria-label={`${option.name} total`} type="number" min="0" step="0.01" value={option.total} onChange={(event) => setPackageOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, total: Number(event.target.value) || 0 } : item))} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm font-semibold" /></label></div>)}</div>}
          </section>

          {/* Submit Button */}
          <p className="text-center text-xs text-slate-600">Saving creates a shareable proposal link but does not send an email. Find the link on your Dashboard; emailing clients is a Pro feature.</p>
          <button
            type="submit"
            disabled={saving || !connectionOnline}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors shadow-sm disabled:opacity-50 text-sm"
          >
            {saving ? "Saving Estimate..." : "Save Estimate"}
          </button>
        </form>
      </div>
    </div>
    </LocalizedTree>
  );
}
