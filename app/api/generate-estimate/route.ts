import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerProAccess } from "@/lib/pro-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 12_000;
type GeneratedItem = { description?: unknown; quantity?: unknown; unit_price?: unknown };

export async function GET() {
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
  const [{ data: settings, error: settingsError }, { data: usage, error: usageError }] = await Promise.all([
    admin.from("tradeflow_app_settings").select("ai_drafting_enabled, ai_daily_generation_limit").eq("singleton", true).single(),
    admin.from("tradeflow_ai_daily_usage").select("attempts_started").eq("user_id", user.id).eq("usage_date", today).maybeSingle(),
  ]);
  if (settingsError || usageError) {
    console.error("Could not read AI drafting allowance:", settingsError?.message ?? usageError?.message);
    return NextResponse.json({ error: "Could not load your cloud drafting allowance." }, { status: 503 });
  }
  const used = usage?.attempts_started ?? 0;
  return NextResponse.json({
    enabled: settings.ai_drafting_enabled,
    daily_limit: settings.ai_daily_generation_limit,
    used,
    remaining: Math.max(settings.ai_daily_generation_limit - used, 0),
  }, { headers: { "Cache-Control": "no-store" } });
}

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

export async function POST(request: Request) {
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
  if (!prompt) return NextResponse.json({ error: "Describe the job to draft an estimate." }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Cloud drafting is not configured. Set GEMINI_API_KEY on the server." }, { status: 503 });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: "Cloud drafting is temporarily unavailable." }, { status: 503 });

  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
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
    if (reservation?.reason === "global_daily_limit") {
      return NextResponse.json({ error: "WorkCraft AI has reached today’s cloud drafting capacity. Please try again after the UTC reset." }, { status: 429 });
    }
    if (reservation?.reason === "paused") {
      return NextResponse.json({ error: "Cloud estimate drafting is temporarily paused. Please try again later." }, { status: 503 });
    }
    return NextResponse.json({ error: "Cloud estimate drafting is a Pro feature." }, { status: 403 });
  }

  const generationId = reservation.generation_id as string;
  const complete = async (outcome: "succeeded" | "failed", providerStatus: number | null, generatedItems: number | null) => {
    const { error } = await admin.rpc("complete_workcraft_ai_generation", {
      p_generation_id: generationId,
      p_outcome: outcome,
      p_provider_status: providerStatus,
      p_generated_items: generatedItems,
    });
    if (error) console.error("Could not record AI generation completion:", error.message);
  };

  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `Draft scope and quantities only for a ${trade} job. Job description: ${prompt}\n\nReturn JSON only with a line_items array. Each item must contain description (string), quantity (number), and unit_price (number). Always set unit_price to 0; WorkCraft AI will apply the contractor's saved Price Book rates where a clear match exists. Break work into distinct tasks and list labor/material work separately when clear. Do not invent measurements. If a quantity cannot be responsibly inferred, use 1 and say what needs confirmation in the description. Use concise descriptions that name the actual fixture, material, or task so it can be matched to a saved service.` }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2048 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    await complete("failed", null, null);
    return NextResponse.json({ error: "Cloud AI request timed out or could not connect. Try again later." }, { status: 502 });
  }

  let generated: { error?: { message?: string }; candidates?: { content?: { parts?: { text?: string }[] } }[] };
  try {
    generated = await response.json();
  } catch {
    await complete("failed", response.status, null);
    return NextResponse.json({ error: "The AI response could not be read. Try again later." }, { status: 502 });
  }
  if (!response.ok) {
    await complete("failed", response.status, null);
    console.error("Cloud AI provider rejected request:", response.status);
    return NextResponse.json({ error: "Cloud AI could not complete this draft. Try again later." }, { status: 502 });
  }

  const text = generated.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  let parsed: { line_items?: unknown[] };
  try { parsed = JSON.parse(text || "{}"); }
  catch {
    await complete("failed", response.status, null);
    return NextResponse.json({ error: "The AI response could not be read. Try a more specific job description." }, { status: 502 });
  }
  const line_items = Array.isArray(parsed.line_items) ? parsed.line_items.slice(0, 40).flatMap((rawItem: unknown) => {
    const item = rawItem as GeneratedItem;
    if (!item || typeof item !== "object") return [];
    const description = typeof item.description === "string" ? item.description.trim().slice(0, 240) : "";
    const quantity = Number(item.quantity);
    if (!description || !Number.isFinite(quantity) || quantity <= 0) return [];
    return [{ description, quantity, unit_price: 0 }];
  }) : [];
  if (!line_items.length) {
    await complete("failed", response.status, 0);
    return NextResponse.json({ error: "The AI returned no usable line items. Add scope details and try again." }, { status: 502 });
  }

  await complete("succeeded", response.status, line_items.length);
  return NextResponse.json({ line_items, remaining_daily_generations: reservation.remaining });
}
