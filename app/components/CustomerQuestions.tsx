"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { createClient } from "@/app/utils/supabase/client";
import type { Language } from "@/app/components/LanguageProvider";

export type OwnerQuestion = {
  id: string;
  estimate_id: string;
  customer_name: string;
  customer_email: string;
  message: string;
  created_at: string;
  read_at: string | null;
  responded_at: string | null;
  archived_at: string | null;
};

type Props = {
  estimateId?: string;
  availableEstimateIds?: ReadonlySet<string>;
  language: Language;
  questions: OwnerQuestion[];
  setQuestions: Dispatch<SetStateAction<OwnerQuestion[]>>;
  loadError: boolean;
};

export default function CustomerQuestions({ estimateId, availableEstimateIds, language, questions, setQuestions, loadError }: Props) {
  const es = language === "es";
  const supabase = useMemo(() => createClient(), []);
  const [filter, setFilter] = useState<"open" | "archived">("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const handledLink = useRef(false);
  const openCount = questions.filter((question) => !question.archived_at).length;
  const archivedCount = questions.length - openCount;
  const visible = questions.filter((question) => filter === "archived" ? Boolean(question.archived_at) : !question.archived_at);

  useEffect(() => {
    if (!estimateId || handledLink.current || window.location.hash !== "#customer-questions") return;
    const requestedId = new URLSearchParams(window.location.search).get("question");
    const question = requestedId ? questions.find((item) => item.id === requestedId) : undefined;
    if (question?.archived_at && filter !== "archived") {
      const timer = window.setTimeout(() => setFilter("archived"), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      const target = question ? document.getElementById(`question-${question.id}`) : document.getElementById("customer-questions");
      target?.scrollIntoView({ block: "start" });
      if (question) target?.focus({ preventScroll: true });
      handledLink.current = true;
      if (question && !question.read_at) {
        const readAt = new Date().toISOString();
        void supabase.from("proposal_questions").update({ read_at: readAt }).eq("id", question.id)
          .eq("estimate_id", estimateId).is("read_at", null).select("id").maybeSingle().then(({ data, error: updateError }) => {
            if (updateError) setError(es ? "No se pudo marcar la pregunta como leída." : "The question could not be marked as read.");
            else if (data) setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, read_at: readAt } : item));
          });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [questions, filter, estimateId, supabase, setQuestions, es]);

  async function updateQuestion(question: OwnerQuestion, field: "read_at" | "responded_at" | "archived_at") {
    if (busy) return;
    const next = question[field] ? null : new Date().toISOString();
    setBusy(question.id); setError(""); setNotice("");
    const { data, error: updateError } = await supabase.from("proposal_questions").update({ [field]: next })
      .eq("id", question.id).eq("estimate_id", question.estimate_id).select("id").maybeSingle();
    if (updateError || !data) setError(es ? "No se pudo actualizar la pregunta. Inténtalo de nuevo." : "The question could not be updated. Please try again.");
    else {
      setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, [field]: next } : item));
      setNotice(field === "archived_at"
        ? (next ? (es ? "Pregunta archivada." : "Question archived.") : (es ? "Pregunta restaurada." : "Question restored."))
        : (es ? "Pregunta actualizada." : "Question updated."));
    }
    setBusy(null);
  }

  async function deleteQuestion(question: OwnerQuestion) {
    if (busy || !window.confirm(es
      ? "¿Eliminar esta pregunta de forma permanente? Esto también elimina su notificación en la app. Los correos ya enviados no se pueden retirar."
      : "Permanently delete this question? Its in-app notification will also be removed. Emails already sent cannot be recalled.")) return;
    setBusy(question.id); setError(""); setNotice("");
    const { data, error: deleteError } = await supabase.from("proposal_questions").delete()
      .eq("id", question.id).eq("estimate_id", question.estimate_id).select("id").maybeSingle();
    if (deleteError || !data) setError(es ? "No se pudo eliminar la pregunta. Inténtalo de nuevo." : "The question could not be deleted. Please try again.");
    else {
      setQuestions((current) => current.filter((item) => item.id !== question.id));
      setNotice(es ? "Pregunta eliminada." : "Question deleted.");
    }
    setBusy(null);
  }

  const actionClass = "min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 disabled:opacity-50";
  return <section id="customer-questions" className="print:hidden scroll-mt-6 rounded-xl border border-slate-200 bg-white p-4 space-y-3" aria-labelledby="customer-questions-title">
    <div><h2 id="customer-questions-title" className="text-sm font-bold">{es ? "Preguntas de clientes" : "Customer questions"}</h2>
      <p className="mt-1 text-xs text-slate-600">{es ? "Responde por correo o teléfono y marca la pregunta como respondida." : "Reply by email or phone, then mark the question as responded."}</p></div>
    {loadError ? <p role="alert" className="text-sm text-red-700">{es ? "No se pudieron cargar las preguntas. Actualiza la página para intentarlo de nuevo." : "Questions could not be loaded. Refresh the page to try again."}</p> : <>
      <div className="flex flex-wrap gap-2" aria-label={es ? "Filtrar preguntas" : "Filter questions"}>
        <button type="button" aria-pressed={filter === "open"} onClick={() => setFilter("open")} className={`${actionClass} ${filter === "open" ? "border-slate-800 bg-slate-800 text-white hover:bg-slate-700" : ""}`}>{es ? "Abiertas" : "Open"} ({openCount})</button>
        <button type="button" aria-pressed={filter === "archived"} onClick={() => setFilter("archived")} className={`${actionClass} ${filter === "archived" ? "border-slate-800 bg-slate-800 text-white hover:bg-slate-700" : ""}`}>{es ? "Archivadas" : "Archived"} ({archivedCount})</button>
      </div>
      {visible.length ? <div className="divide-y divide-slate-100">{visible.map((question) => <article id={`question-${question.id}`} tabIndex={-1} key={question.id} className="scroll-mt-6 py-4 first:pt-1 last:pb-0 focus:outline focus:outline-2 focus:outline-orange-500">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-sm font-semibold text-slate-900">{question.customer_name}</p><span className="text-xs text-slate-600">{new Date(question.created_at).toLocaleString(es ? "es-US" : "en-US")}</span>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{question.read_at ? (es ? "Leída" : "Read") : (es ? "Sin leer" : "Unread")}</span>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{question.responded_at ? (es ? "Respondida" : "Responded") : (es ? "Sin responder" : "Not responded")}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{question.message}</p>
        <a className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 underline" href={`mailto:${encodeURIComponent(question.customer_email)}`}>{es ? "Responder por correo" : "Reply by email"} · {question.customer_email}</a>
        {!estimateId && (availableEstimateIds?.has(question.estimate_id)
          ? <Link className="ml-0 inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 underline sm:ml-4" href={`/estimate/${encodeURIComponent(question.estimate_id)}?question=${encodeURIComponent(question.id)}#customer-questions`}>{es ? "Ver cotización" : "View estimate"}</Link>
          : <p className="text-xs text-slate-600">{es ? "La cotización original ya no está disponible." : "The original estimate is no longer available."}</p>)}
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={!!busy} onClick={() => void updateQuestion(question, "read_at")} className={actionClass}>{question.read_at ? (es ? "Marcar como no leída" : "Mark unread") : (es ? "Marcar como leída" : "Mark read")}</button>
          <button type="button" disabled={!!busy} onClick={() => void updateQuestion(question, "responded_at")} className={actionClass}>{question.responded_at ? (es ? "Marcar como sin responder" : "Mark not responded") : (es ? "Marcar como respondida" : "Mark as responded")}</button>
          <button type="button" disabled={!!busy} onClick={() => void updateQuestion(question, "archived_at")} className={actionClass}>{question.archived_at ? (es ? "Restaurar" : "Restore") : (es ? "Archivar" : "Archive")}</button>
          <button type="button" disabled={!!busy} onClick={() => void deleteQuestion(question)} className={`${actionClass} border-red-200 text-red-800 hover:bg-red-50`}>{es ? "Eliminar" : "Delete"}</button>
        </div>
      </article>)}</div> : <p className="text-sm text-slate-600">{filter === "open" ? (estimateId ? (es ? "No hay preguntas abiertas para esta cotización." : "No open questions for this estimate.") : (es ? "No hay preguntas abiertas." : "No open questions.")) : (estimateId ? (es ? "No hay preguntas archivadas para esta cotización." : "No archived questions for this estimate.") : (es ? "No hay preguntas archivadas." : "No archived questions."))}</p>}
    </>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-slate-700">{notice}</p>}
  </section>;
}
