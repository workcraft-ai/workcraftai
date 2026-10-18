import { calculateEstimateMoney, hasAtMostTwoDecimalPlaces } from "@/lib/estimate-money.mjs";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";
import { withApiFailureMetrics } from "@/lib/api-failure-metrics";
import { getServiceSupabase } from "@/lib/stripe-server";
import { encryptShareToken } from "@/lib/proposal-sharing";
import { isValidOptionalPhone } from "@/lib/phone-validation.mjs";

const MAX_ESTIMATE_BODY_BYTES = 128_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validLineItems(value: unknown): value is Array<{ description: string; description_es?: string | null; quantity: number; unit?: string; unit_price: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return false;
  let subtotalCents = 0;
  return value.every((item) => {
    if (!isRecord(item)) return false;
    const valid = typeof item.description === "string" && item.description.trim().length > 0 && item.description.length <= 240
      && (item.description_es === undefined || item.description_es === null || (typeof item.description_es === "string" && item.description_es.length <= 240))
      && (item.unit === undefined || (typeof item.unit === "string" && item.unit.trim().length > 0 && item.unit.length <= 40))
      && typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0 && item.quantity <= 100000
      && typeof item.unit_price === "number" && Number.isFinite(item.unit_price) && hasAtMostTwoDecimalPlaces(item.unit_price) && item.unit_price >= 0 && item.unit_price <= 100000000;
    if (!valid) return false;
    subtotalCents += calculateEstimateMoney({}, [{ quantity: Number(item.quantity), unit_price: Number(item.unit_price) }]).subtotalCents;
    return subtotalCents <= 100_000_000_000;
  });
}

function validPackages(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.length <= 3 && value.every((item) =>
    isRecord(item) && typeof item.name === "string" && ["Good", "Better", "Best"].includes(item.name)
      && typeof item.description === "string" && item.description.length <= 500
      && (item.description_es === undefined || typeof item.description_es === "string" && item.description_es.length <= 500)
      && typeof item.total === "number" && Number.isFinite(item.total) && hasAtMostTwoDecimalPlaces(item.total) && item.total >= 0 && item.total <= 100000000));
}

export const POST = withApiFailureMetrics("/api/estimates", async (request: Request) => {
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
  const proposalDisplayMode = body.proposal_display_mode === "summary" ? "summary" : "detailed";
  const proposalSummary = typeof body.proposal_summary === "string" ? body.proposal_summary.trim() : "";
  const paymentTerms = typeof body.payment_terms === "string" ? body.payment_terms.trim() : "";
  const paymentTermsEs = typeof body.payment_terms_es === "string" ? body.payment_terms_es.trim() : "";
  const clientRequestId = typeof body.client_request_id === "string" ? body.client_request_id.trim() : "";

  if (!clientName || clientName.length > 200 || (clientEmail.length > 0 && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail) || clientEmail.length > 320))
    || (body.client_phone !== undefined && body.client_phone !== null && typeof body.client_phone !== "string")
    || (body.client_request_id !== undefined && body.client_request_id !== null && typeof body.client_request_id !== "string")
    || !isValidOptionalPhone(clientPhone) || clientPhone.length > 80 || jobAddress.length > 500 || !validLineItems(lineItems) || !validPackages(packages)
    || (clientRequestId !== "" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientRequestId))
    || !Number.isFinite(depositPercentage) || depositPercentage < 0 || depositPercentage > 100
    || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100
    || !Number.isFinite(markupPercentage) || markupPercentage < 0 || markupPercentage > 500
    || proposalSummary.length > 1200
    || (body.payment_terms !== undefined && body.payment_terms !== null && typeof body.payment_terms !== "string")
    || (body.payment_terms_es !== undefined && body.payment_terms_es !== null && typeof body.payment_terms_es !== "string")
    || paymentTerms.length > 1000 || paymentTermsEs.length > 1000
    || (proposalDisplayMode === "summary" && !proposalSummary)) {
    return NextResponse.json({ error: "Check customer details, line items, tax, and deposit values." }, { status: 400 });
  }

  const { data: estimateId, error } = await supabase.rpc("workcraft_create_estimate_with_terms", {
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
      proposal_display_mode: proposalDisplayMode,
      proposal_summary: proposalSummary || null,
      payment_terms: paymentTerms || null,
      payment_terms_es: paymentTermsEs || null,
      client_request_id: clientRequestId || null,
    },
    p_line_items: lineItems,
  });
  if (error) {
    const estimateLimitMatch = error.message.match(/(?:FREE|PRO)_(?:DAILY|MONTHLY)_ESTIMATE_LIMIT/);
    if (estimateLimitMatch) return NextResponse.json({ error: estimateLimitMatch[0], code: estimateLimitMatch[0] }, { status: 429 });
    if (error.message.includes("ESTIMATE_REQUEST_KEY_REUSED")) {
      return NextResponse.json({ error: "ESTIMATE_REQUEST_KEY_REUSED" }, { status: 409 });
    }
    if (error.message.includes("WORKCRAFT_PRO_REQUIRED")) return NextResponse.json({ error: "Deposits and proposal packages require WorkCraft AI Pro." }, { status: 403 });
    if (error.message.includes("ESTIMATE_TOTAL_TOO_LARGE")) return NextResponse.json({ error: "Estimate line-item subtotal cannot exceed $1,000,000,000." }, { status: 400 });
    if (error.message.includes("INVALID_LINE_ITEMS") || error.message.includes("INVALID_ESTIMATE")) return NextResponse.json({ error: "Check the estimate details and try again." }, { status: 400 });
    console.error("Atomic estimate creation failed:", error.message);
    return NextResponse.json({ error: "Unable to save this estimate. Please try again." }, { status: 500 });
  }

  // New estimates receive a revocable, 30-day customer link immediately.
  // The estimate RPC has already committed, so report sharing separately if
  // initialization fails; the client must never retry creation as a result.
  let shareReady = false;
  try {
    const token = randomBytes(32).toString("base64url");
    const admin = getServiceSupabase();
    const { data: changed, error: shareError } = await admin.rpc("workcraft_ensure_proposal_share", {
      p_estimate_id: estimateId,
      p_user_id: user.id,
      p_hash: createHash("sha256").update(token).digest("hex"),
      p_encrypted: encryptShareToken(token),
      p_expires: new Date(Date.now() + 30 * 86400000).toISOString(),
    });
    if (shareError || !changed) throw new Error(shareError?.message ?? "share initialization failed");
    shareReady = true;
  } catch (shareError) {
    console.error("Estimate created without an initial customer link:", shareError);
  }

  return NextResponse.json({ success: true, id: estimateId, share_ready: shareReady }, {
    status: 201,
    headers: { "Cache-Control": "private, no-store" },
  });
});
