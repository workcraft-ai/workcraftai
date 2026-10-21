import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { sameOrigin } from "@/lib/admin-support";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";

export const runtime = "nodejs";

type FeedbackLine = {
  line_index: number;
  final_source: "price_book" | "ai_price" | "manual";
  item_id: string | null;
  quantity_changed: boolean;
  price_changed: boolean;
  alias: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = await readLimitedJsonObject(request, 12_000);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid feedback." }, { status: 400 });
  const body = parsed.value;
  if (typeof body.generation_id !== "string" || !uuid.test(body.generation_id)
    || typeof body.estimate_id !== "string" || !uuid.test(body.estimate_id)
    || !Array.isArray(body.lines) || body.lines.length > 40) {
    return NextResponse.json({ error: "Invalid feedback." }, { status: 400 });
  }
  const lines: FeedbackLine[] = [];
  const seen = new Set<number>();
  for (const item of body.lines) {
    if (!item || typeof item !== "object" || !Number.isInteger(item.line_index)
      || item.line_index < 0 || item.line_index > 39 || seen.has(item.line_index)
      || !["price_book", "ai_price", "manual"].includes(item.final_source)
      || (item.item_id !== null && (typeof item.item_id !== "string" || !uuid.test(item.item_id)))
      || (item.final_source === "price_book" && !item.item_id)
      || typeof item.quantity_changed !== "boolean" || typeof item.price_changed !== "boolean"
      || typeof item.alias !== "string" || item.alias.length > 240) {
      return NextResponse.json({ error: "Invalid feedback line." }, { status: 400 });
    }
    seen.add(item.line_index);
    lines.push(item as FeedbackLine);
  }
  const userClient = await createUserSupabaseClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !url) return NextResponse.json({ error: "Feedback is unavailable." }, { status: 503 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: generation }, { data: estimate }, { data: recorded, error: recordedError }] = await Promise.all([
    admin.from("tradeflow_ai_generation_events").select("id").eq("id", body.generation_id).eq("user_id", user.id).eq("outcome", "succeeded").maybeSingle(),
    admin.from("estimates").select("id").eq("id", body.estimate_id).eq("user_id", user.id).maybeSingle(),
    admin.from("tradeflow_ai_match_lines").select("line_index, initial_item_id, suggestion_count, finalized_at").eq("generation_id", body.generation_id).eq("user_id", user.id),
  ]);
  if (!generation || !estimate || recordedError || !recorded?.length) {
    return NextResponse.json({ error: "Feedback could not be linked to your saved draft." }, { status: 404 });
  }
  const selectedIds = [...new Set(lines.flatMap((line) => line.item_id ? [line.item_id] : []))];
  if (selectedIds.length) {
    const { data: ownedItems, error } = await admin.from("price_book_items").select("id")
      .eq("user_id", user.id).in("id", selectedIds);
    if (error || ownedItems?.length !== selectedIds.length) {
      return NextResponse.json({ error: "A Price Book selection is no longer available." }, { status: 400 });
    }
  }
  let recordedCount = 0;
  for (const initial of recorded) {
    if (initial.finalized_at) continue;
    const line = lines.find((candidate) => candidate.line_index === initial.line_index);
    const { data: finalized, error } = await admin.from("tradeflow_ai_match_lines").update({
      final_source: line?.final_source ?? "removed",
      final_item_id: line?.item_id ?? null,
      quantity_changed: line?.quantity_changed ?? false,
      price_changed: line?.price_changed ?? false,
      finalized_at: new Date().toISOString(),
    }).eq("generation_id", body.generation_id).eq("line_index", initial.line_index)
      .eq("user_id", user.id).is("finalized_at", null).select("line_index").maybeSingle();
    if (error) {
      console.error("Could not record AI match feedback:", error.message);
      return NextResponse.json({ error: "Feedback could not be recorded." }, { status: 503 });
    }
    if (!finalized) continue;
    recordedCount++;
    // A saved selection is one vote. The matcher only activates an alias after
    // two separate saved selections, scoped to this contractor and this item.
    if (line?.final_source === "price_book" && line.item_id && line.item_id !== initial.initial_item_id
      && line.alias.trim().length >= 5) {
      const alias = line.alias.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 160);
      if (!/@|\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b/.test(alias)) {
        const { error: aliasError } = await admin.rpc("record_workcraft_price_book_selection", {
          p_user_id: user.id, p_item_id: line.item_id, p_alias: alias,
          p_generation_id: body.generation_id,
        });
        if (aliasError) console.error("Could not learn private Price Book alias:", aliasError.message);
      }
    }
  }
  return NextResponse.json({ recorded: recordedCount }, { headers: { "Cache-Control": "no-store" } });
}
