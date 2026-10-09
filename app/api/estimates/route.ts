import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";

const MAX_ESTIMATE_BODY_BYTES = 128_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validLineItems(value: unknown): value is Array<{ description: string; description_es?: string | null; quantity: number; unit_price: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return false;
  let subtotalCents = 0;
  return value.every((item) => {
    if (!isRecord(item)) return false;
    const valid = typeof item.description === "string" && item.description.trim().length > 0 && item.description.length <= 240
      && (item.description_es === undefined || item.description_es === null || (typeof item.description_es === "string" && item.description_es.length <= 240))
      && typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0 && item.quantity <= 100000
      && typeof item.unit_price === "number" && Number.isFinite(item.unit_price) && item.unit_price >= 0 && item.unit_price <= 100000000;
    if (!valid) return false;
    subtotalCents += Math.round(Number(item.quantity) * Number(item.unit_price) * 100);
    return subtotalCents <= 100_000_000_000;
  });
}

function validPackages(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.length <= 3 && value.every((item) =>
    isRecord(item) && typeof item.name === "string" && ["Good", "Better", "Best"].includes(item.name)
      && typeof item.description === "string" && item.description.length <= 500
      && (item.description_es === undefined || typeof item.description_es === "string" && item.description_es.length <= 500)
      && typeof item.total === "number" && Number.isFinite(item.total) && item.total >= 0 && item.total <= 100000000));
}

export async function POST(request: Request) {
  const supabase = await createUserSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sign in before creating an estimate." }, { status: 401 });

  const parsedBody = await readLimitedJsonObject(request, MAX_ESTIMATE_BODY_BYTES);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: parsedBody.reason === "too_large" ? "Estimate details exceed the request size limit." : "Check the estimate details and try again." },
      { status: parsedBody.reason === "too_large" ? 413 : 400 },
    );
  }
  const body = parsedBody.value;

  const clientName = typeof body.client_name === "string" ? body.client_name.trim() : "";
  const clientEmail = typeof body.client_email === "string" ? body.client_email.trim() : "";
  const clientPhone = typeof body.client_phone === "string" ? body.client_phone.trim() : "";
  const jobAddress = typeof body.job_address === "string" ? body.job_address.trim() : "";
  const depositPercentage = body.deposit_percentage === undefined ? 20 : Number(body.deposit_percentage);
  const taxRate = body.tax_rate === undefined ? 0 : Number(body.tax_rate);
  const markupPercentage = body.markup_percentage === undefined ? 0 : Number(body.markup_percentage);
  const lineItems = body.lineItems;
  const packages = body.package_options ?? [];

  if (!clientName || clientName.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail) || clientEmail.length > 320
    || clientPhone.length > 80 || jobAddress.length > 500 || !validLineItems(lineItems) || !validPackages(packages)
    || !Number.isFinite(depositPercentage) || depositPercentage < 0 || depositPercentage > 100
    || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100
    || !Number.isFinite(markupPercentage) || markupPercentage < 0 || markupPercentage > 500) {
    return NextResponse.json({ error: "Check customer details, line items, tax, and deposit values." }, { status: 400 });
  }

  const { data: estimateId, error } = await supabase.rpc("workcraft_create_estimate_with_items", {
    p_estimate: {
      client_name: clientName,
      client_email: clientEmail,
      client_phone: clientPhone,
      job_address: jobAddress,
      trade: typeof body.trade === "string" ? body.trade.slice(0, 80) : "General",
      require_deposit: body.require_deposit === true,
      deposit_percentage: depositPercentage,
      package_options: packages,
      tax_rate: taxRate,
      markup_percentage: markupPercentage,
      proposal_language: body.proposal_language === "es" ? "es" : "en",
    },
    p_line_items: lineItems,
  });
  if (error) {
    const estimateLimitMatch = error.message.match(/(?:FREE|PRO)_(?:DAILY|MONTHLY)_ESTIMATE_LIMIT/);
    if (estimateLimitMatch) return NextResponse.json({ error: estimateLimitMatch[0], code: estimateLimitMatch[0] }, { status: 429 });
    if (error.message.includes("WORKCRAFT_PRO_REQUIRED")) return NextResponse.json({ error: "Deposits and proposal packages require WorkCraft AI Pro." }, { status: 403 });
    if (error.message.includes("ESTIMATE_TOTAL_TOO_LARGE")) return NextResponse.json({ error: "Estimate line-item subtotal cannot exceed $1,000,000,000." }, { status: 400 });
    if (error.message.includes("INVALID_LINE_ITEMS") || error.message.includes("INVALID_ESTIMATE")) return NextResponse.json({ error: "Check the estimate details and try again." }, { status: 400 });
    console.error("Atomic estimate creation failed:", error.message);
    return NextResponse.json({ error: "Unable to save this estimate. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: estimateId }, {
    status: 201,
    headers: { "Cache-Control": "private, no-store" },
  });
}
