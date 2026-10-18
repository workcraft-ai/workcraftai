import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerProAccess } from "@/lib/pro-access";
import { withApiFailureMetrics } from "@/lib/api-failure-metrics";
import { buildEstimateDraftPrompt } from "@/lib/ai-estimate-prompt.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 12_000;
const GEMINI_REQUEST_TIMEOUT_MS = 45_000;
type GeneratedItem = {
  description?: unknown;
  description_es?: unknown;
  quantity?: unknown;
  quantity_basis?: unknown;
  pricing_basis?: unknown;
  unit?: unknown;
  suggested_unit_price?: unknown;
  pricing_source?: unknown;
  pricing_assumption?: unknown;
  pricing_assumption_es?: unknown;
  review_note?: unknown;
  review_note_es?: unknown;
};
type GeminiProviderError = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  details?: unknown;
};

function normalizeGeneratedUnit(value: unknown, description: string): string {
  if (typeof value !== "string") return "unknown";
  const unit = value.toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  if (["each", "ea", "unit", "units", "piece", "pieces", "pc", "pcs", "item", "items"].includes(unit)) return "each";
  if (["hour", "hours", "hr", "hrs", "labor hour", "labour hour"].includes(unit)) return "hour";
  if (["sq ft", "square feet", "square foot", "sqft", "sf", "square footage"].includes(unit)) return "sq ft";
  if (["linear ft", "linear feet", "linear foot", "lin ft", "lf", "foot", "feet", "ft"].includes(unit)) return "linear ft";
  if (["roofing square", "roofing squares", "roof square", "roof squares", "square", "squares", "sq"].includes(unit)) {
    return /\b(roof|roofing|shingle|underlayment|tear[ -]?off)\b/i.test(description) ? "roofing square" : "unknown";
  }
  if (["sheet", "sheets", "panel", "panels"].includes(unit)) return "sheet";
  if (["job", "project", "flat rate", "lump sum"].includes(unit)) return "job";
  if (["visit", "service call", "appointment"].includes(unit)) return "visit";
  return "unknown";
}

function generatedUnitPrice(item: GeneratedItem): number {
  // Accept common aliases for older model responses while the response schema below
  // requires the canonical suggested_unit_price field for new requests.
  const candidate = item.suggested_unit_price
    ?? (item as GeneratedItem & { suggestedUnitPrice?: unknown }).suggestedUnitPrice
    ?? (item as GeneratedItem & { unit_price?: unknown }).unit_price
    ?? (item as GeneratedItem & { price?: unknown }).price;
  const value = Number(candidate);
  return Number.isFinite(value) && value > 0 && value <= 100000000
    ? Math.round(value * 100) / 100
    : 0;
}

function geminiProviderErrorSignal(error: GeminiProviderError | undefined) {
  const message = typeof error?.message === "string" ? error.message : "";
  const status = typeof error?.status === "string" && /^[A-Z0-9_]{1,40}$/.test(error.status)
    ? error.status
    : null;
  const code = typeof error?.code === "number" && Number.isInteger(error.code) && error.code >= 100 && error.code <= 599
    ? error.code
    : null;
  const category = /api.?key|credential|unauthorized|permission denied/i.test(message)
    ? "authentication"
    : /quota|rate.?limit|resource_exhausted/i.test(`${status ?? ""} ${message}`)
      ? "quota_or_rate_limit"
      : /model.{0,40}(not found|unavailable|unsupported)|not found.{0,40}model/i.test(message)
        ? "model"
        : /invalid_argument|invalid json|unknown name|schema|invalid request/i.test(`${status ?? ""} ${message}`)
          ? "invalid_request"
          : "other";
  const providerFields = Array.isArray(error?.details)
    ? error.details.flatMap((detail: unknown) => {
      if (!detail || typeof detail !== "object" || !("fieldViolations" in detail) || !Array.isArray(detail.fieldViolations)) return [];
      return detail.fieldViolations.flatMap((violation: unknown) => {
        if (!violation || typeof violation !== "object" || !("field" in violation)) return [];
        const field = violation.field;
        return typeof field === "string" && /^[A-Za-z0-9_.\-\[\]]{1,160}$/.test(field) ? [field] : [];
      });
    }).slice(0, 5)
    : [];
  const validFieldPath = /^(?:generation_config|generationConfig|contents|tools|system_instruction|systemInstruction|safety_settings|safetySettings)(?:\.[A-Za-z0-9_-]+|\[\d+\])*$/;
  const messageFields = [
    ...Array.from(message.matchAll(/(?:at|field)\s+["']([^"']{1,200})["']/gi), (match) => match[1]),
    ...Array.from(message.matchAll(/Unknown name\s+(["'])([A-Za-z0-9_.-]{1,100})\1\s+at\s+(["'])([A-Za-z0-9_.\[\]-]{1,160})\3/gi), (match) => `${match[4]}.${match[2]}`),
  ].filter((field) => validFieldPath.test(field));
  const safeProviderFields = [...new Set([...providerFields, ...messageFields])].slice(0, 5);
  return { providerCode: code, providerStatus: status, providerErrorCategory: category, providerFields: safeProviderFields };
}

export const GET = withApiFailureMetrics("/api/generate-estimate", async () => {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to use cloud estimate drafting." }, { status: 401 });
  let hasPro = false;
  try { hasPro = (await getServerProAccess(user.id)).hasPro; }
  catch { return NextResponse.json({ error: "Could not verify your plan." }, { status: 503 }); }
  if (!hasPro) {
    return NextResponse.json({ error: "Cloud estimate drafting is a Pro feature." }, { status: 403 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: "Cloud drafting is temporarily unavailable." }, { status: 503 });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const today = new Date().toISOString().slice(0, 10);
  const month = `${today.slice(0, 7)}-01`;
  const [{ data: settings, error: settingsError }, { data: usage, error: usageError }, { data: monthlyUsage, error: monthlyError }] = await Promise.all([
    admin.from("tradeflow_app_settings").select("ai_drafting_enabled, ai_daily_generation_limit, ai_monthly_generation_limit").eq("singleton", true).single(),
    admin.from("tradeflow_ai_daily_usage").select("billable_attempts").eq("user_id", user.id).eq("usage_date", today).maybeSingle(),
    admin.from("tradeflow_ai_monthly_usage").select("billable_attempts").eq("user_id", user.id).eq("usage_month", month).maybeSingle(),
  ]);
  if (settingsError || usageError || monthlyError) {
    console.error("Could not read AI drafting allowance:", settingsError?.message ?? usageError?.message ?? monthlyError?.message);
    return NextResponse.json({ error: "Could not load your cloud drafting allowance." }, { status: 503 });
  }
  const used = usage?.billable_attempts ?? 0;
  const monthlyUsed = monthlyUsage?.billable_attempts ?? 0;
  return NextResponse.json({
    enabled: settings.ai_drafting_enabled,
    daily_limit: settings.ai_daily_generation_limit,
    used,
    remaining: Math.max(settings.ai_daily_generation_limit - used, 0),
    monthly_limit: settings.ai_monthly_generation_limit,
    monthly_used: monthlyUsed,
    monthly_remaining: Math.max(settings.ai_monthly_generation_limit - monthlyUsed, 0),
  }, { headers: { "Cache-Control": "no-store" } });
});

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export const POST = withApiFailureMetrics("/api/generate-estimate", async (request: Request) => {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to use cloud estimate drafting." }, { status: 401 });

  let hasPro = false;
  try { hasPro = (await getServerProAccess(user.id)).hasPro; }
  catch { return NextResponse.json({ error: "Could not verify your plan." }, { status: 503 }); }
  if (!hasPro) {
    return NextResponse.json({ error: "Cloud estimate drafting is a Pro feature." }, { status: 403 });
  }

  const payload = await readJsonBody(request);
  if (!payload) return NextResponse.json({ error: "The request is invalid or too large." }, { status: 400 });
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim().slice(0, 6000) : "";
  const trade = typeof payload.trade === "string" ? payload.trade.trim().slice(0, 80) || "General contracting" : "General contracting";
  const proposalLanguage = payload.proposal_language === "es" ? "es" : "en";
  if (!prompt) return NextResponse.json({ error: "Describe the job to draft an estimate." }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Cloud drafting is not configured. Set GEMINI_API_KEY on the server." }, { status: 503 });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: "Cloud drafting is temporarily unavailable." }, { status: 503 });

  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: reservationRows, error: reservationError } = await admin.rpc("reserve_workcraft_ai_generation", {
    p_user_id: user.id,
    p_prompt_characters: prompt.length,
    p_model: model,
  });
  if (reservationError) {
    console.error("Could not reserve AI generation usage:", reservationError.message);
    return NextResponse.json({ error: "Cloud drafting is temporarily unavailable." }, { status: 503 });
  }
  const reservation = Array.isArray(reservationRows) ? reservationRows[0] : reservationRows;
  if (!reservation?.allowed) {
    if (reservation?.reason === "daily_limit") {
      return NextResponse.json({ error: "You’ve reached today’s cloud drafting limit. Your allowance resets at UTC midnight." }, { status: 429 });
    }
    if (reservation?.reason === "monthly_limit") {
      return NextResponse.json({ error: "You’ve reached this month’s cloud drafting limit. Your allowance resets on the first day of next month (UTC)." }, { status: 429 });
    }
    if (reservation?.reason === "global_daily_limit") {
      return NextResponse.json({ error: "WorkCraft AI has reached today’s cloud drafting capacity. Please try again after the UTC reset." }, { status: 429 });
    }
    if (reservation?.reason === "paused") {
      return NextResponse.json({ error: "Cloud estimate drafting is temporarily paused. Please try again later." }, { status: 503 });
    }
    return NextResponse.json({ error: "Cloud estimate drafting is a Pro feature." }, { status: 403 });
  }

  const generationId = reservation.generation_id as string;
  const complete = async (outcome: "succeeded" | "failed", providerStatus: number | null, generatedItems: number | null, inputTokens: number | null = null, outputTokens: number | null = null) => {
    const { error } = await admin.rpc("complete_workcraft_ai_generation", {
      p_generation_id: generationId,
      p_outcome: outcome,
      p_provider_status: providerStatus,
      p_generated_items: generatedItems,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
    });
    if (error) console.error("Could not record AI generation completion:", error.message);
  };

  let response: Response;
  const generationStartedAt = Date.now();
  const generationSignal = AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS);
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildEstimateDraftPrompt({ trade, description: prompt, language: proposalLanguage }) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 3072,
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
      signal: generationSignal,
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const cause = error instanceof Error ? error.cause : null;
    const rawCauseCode = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
      ? cause.code
      : null;
    const causeCode = rawCauseCode && /^[A-Z0-9_]{1,40}$/.test(rawCauseCode) ? rawCauseCode : null;
    console.error("Gemini generation transport failed:", {
      requestId: request.headers.get("x-vercel-id"),
      model,
      durationMs: Date.now() - generationStartedAt,
      timedOut: generationSignal.aborted,
      errorName,
      causeCode,
    });
    await complete("failed", null, null);
    return NextResponse.json({ error: "Cloud AI request timed out or could not connect. Try again later." }, { status: 502 });
  }

  let generated: { error?: GeminiProviderError; candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
  try {
    generated = await response.json();
  } catch {
    await complete("failed", response.status, null);
    return NextResponse.json({ error: "The AI response could not be read. Try again later." }, { status: 502 });
  }
  const tokenCount = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : null;
  const inputTokens = tokenCount(generated.usageMetadata?.promptTokenCount);
  const outputTokens = tokenCount(generated.usageMetadata?.candidatesTokenCount === undefined
    ? null
    : generated.usageMetadata.candidatesTokenCount + (generated.usageMetadata.thoughtsTokenCount ?? 0));
  if (!response.ok) {
    await complete("failed", response.status, null, inputTokens, outputTokens);
    console.error("Cloud AI provider rejected request:", {
      requestId: request.headers.get("x-vercel-id"),
      model,
      httpStatus: response.status,
      ...geminiProviderErrorSignal(generated.error),
    });
    return NextResponse.json({ error: "Cloud AI could not complete this draft. Try again later." }, { status: 502 });
  }

  const text = generated.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  let parsed: { line_items?: unknown[]; proposal_summary?: unknown };
  try { parsed = JSON.parse(text || "{}"); }
  catch {
    await complete("failed", response.status, null, inputTokens, outputTokens);
    return NextResponse.json({ error: "The AI response could not be read. Try a more specific job description." }, { status: 502 });
  }
  const line_items = Array.isArray(parsed.line_items) ? parsed.line_items.slice(0, 40).flatMap((rawItem: unknown) => {
    const item = rawItem as GeneratedItem;
    if (!item || typeof item !== "object") return [];
    const description = typeof item.description === "string" ? item.description.trim().slice(0, 240) : "";
    const quantity = Number(item.quantity);
    if (!description || !Number.isFinite(quantity) || quantity <= 0) return [];
    const unit = normalizeGeneratedUnit(item.unit, description);
    const unitPrice = generatedUnitPrice(item);
    const descriptionEs = typeof item.description_es === "string" ? item.description_es.trim().slice(0, 240) : "";
    const pricingAssumption = typeof item.pricing_assumption === "string" ? item.pricing_assumption.trim().slice(0, 240) : "";
    const pricingAssumptionEs = typeof item.pricing_assumption_es === "string" ? item.pricing_assumption_es.trim().slice(0, 240) : "";
    const reviewNote = typeof item.review_note === "string" ? item.review_note.trim().slice(0, 240) : "";
    const reviewNoteEs = typeof item.review_note_es === "string" ? item.review_note_es.trim().slice(0, 240) : "";
    return [{
      description,
      description_es: descriptionEs,
      quantity,
      quantity_source: "ai_estimated",
      quantity_basis: ["specified_area","count"].includes(String(item.quantity_basis)) ? String(item.quantity_basis) : "unverified",
      pricing_basis: ["labor", "materials", "installed", "other"].includes(String(item.pricing_basis)) ? String(item.pricing_basis) : "unknown",
      unit,
      unit_price: unitPrice,
      pricing_source: item.pricing_source === "contractor_provided" && Number.isFinite(Number(item.suggested_unit_price)) ? "contractor_provided" : "ai_suggested",
      pricing_assumption: pricingAssumption,
      pricing_assumption_es: pricingAssumptionEs,
      review_note: reviewNote,
      review_note_es: reviewNoteEs,
    }];
  }) : [];
  if (!line_items.length) {
    await complete("failed", response.status, 0, inputTokens, outputTokens);
    return NextResponse.json({ error: "The AI returned no usable line items. Add scope details and try again." }, { status: 502 });
  }

  await complete("succeeded", response.status, line_items.length, inputTokens, outputTokens);
  return NextResponse.json({
    line_items,
    proposal_summary: typeof parsed.proposal_summary === "string" ? parsed.proposal_summary.trim().slice(0, 1200) : "",
    remaining_daily_generations: reservation.remaining,
    remaining_monthly_generations: reservation.remaining_monthly,
  });
});
