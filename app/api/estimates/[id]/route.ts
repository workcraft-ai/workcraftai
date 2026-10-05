import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";

const MAX_ESTIMATE_BODY_BYTES = 128_000;

type LineItemInput = {
  description: string;
  description_es?: string | null;
  quantity: number;
  unit_price: number;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function validLineItems(value: unknown): value is LineItemInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return false;
  let subtotalCents = 0;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Record<string, unknown>;
    const valid = typeof candidate.description === "string" &&
      candidate.description.trim().length > 0 &&
      candidate.description.length <= 240 &&
      typeof candidate.quantity === "number" &&
      Number.isFinite(candidate.quantity) &&
      candidate.quantity > 0 &&
      candidate.quantity <= 100000 &&
      typeof candidate.unit_price === "number" &&
      Number.isFinite(candidate.unit_price) &&
      candidate.unit_price >= 0 &&
      candidate.unit_price <= 100000000 &&
      (candidate.description_es === undefined || candidate.description_es === null || (typeof candidate.description_es === "string" && candidate.description_es.length <= 240));
    if (!valid) return false;
    subtotalCents += Math.round(Number(candidate.quantity) * Number(candidate.unit_price) * 100);
    return subtotalCents <= 100_000_000_000;
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createUserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to edit this estimate.", 401);

  const { data: estimate, error } = await supabase
    .from("estimates")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Estimate lookup failed:", error.message);
    return jsonError("Unable to load this estimate.", 500);
  }
  if (!estimate) return jsonError("Estimate not found.", 404);

  const { data: lineItems, error: itemError } = await supabase
    .from("line_items")
    .select("id, description, description_es, quantity, unit_price")
    .eq("estimate_id", id);

  if (itemError) {
    console.error("Estimate line item lookup failed:", itemError.message);
    return jsonError("Unable to load estimate line items.", 500);
  }

  const { data: attachmentRows } = await supabase.from("estimate_attachments")
    .select("id, storage_path, media_type, content_type, created_at").eq("estimate_id", id).eq("user_id", user.id);
  const attachments = await Promise.all((attachmentRows ?? []).map(async (attachment) => {
    const { data } = await supabase.storage.from("estimate-media").createSignedUrl(attachment.storage_path, 60 * 60);
    return data?.signedUrl ? { id: attachment.id, media_type: attachment.media_type, content_type: attachment.content_type, created_at: attachment.created_at, url: data.signedUrl } : null;
  }));

  return NextResponse.json({ estimate, lineItems: lineItems ?? [], attachments: attachments.filter(Boolean) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createUserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to edit this estimate.", 401);

  const parsedBody = await readLimitedJsonObject(request, MAX_ESTIMATE_BODY_BYTES);
  if (!parsedBody.ok) {
    return jsonError(
      parsedBody.reason === "too_large" ? "Estimate details exceed the request size limit." : "Invalid request body.",
      parsedBody.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsedBody.value;

  const clientName = typeof body.client_name === "string" ? body.client_name.trim() : "";
  const clientEmail = typeof body.client_email === "string" ? body.client_email.trim() : "";
  const clientPhone = typeof body.client_phone === "string" ? body.client_phone.trim() : "";
  const jobAddress = typeof body.job_address === "string" ? body.job_address.trim() : "";
  const proposalLanguage = body.proposal_language === "es" ? "es" : "en";
  const depositPercentage = Number(body.deposit_percentage);
  const taxRate = Number(body.tax_rate);
  const markupPercentage = Number(body.markup_percentage);
  if (!clientName || clientName.length > 200 || !clientEmail || clientEmail.length > 320 ||
      clientPhone.length > 80 || jobAddress.length > 500 || !validLineItems(body.lineItems) ||
      !Number.isFinite(depositPercentage) || depositPercentage < 0 || depositPercentage > 100) {
    return jsonError("Check the customer details, deposit percentage, and line items.", 400);
  }
  if ((body.tax_rate !== undefined && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100)) ||
      (body.markup_percentage !== undefined && (!Number.isFinite(markupPercentage) || markupPercentage < 0 || markupPercentage > 500))) {
    return jsonError("Tax must be between 0 and 100%, and markup between 0 and 500%.", 400);
  }

  const { data: existing, error: lookupError } = await supabase
    .from("estimates")
    .select("id, status, require_deposit, deposit_percentage, package_options")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupError) {
    console.error("Estimate ownership check failed:", lookupError.message);
    return jsonError("Unable to update this estimate.", 500);
  }
  if (!existing) return jsonError("Estimate not found.", 404);
  if (["accepted", "paid"].includes(String(existing.status).toLowerCase())) return jsonError("Approved estimates cannot be edited. Create a new estimate if the terms need to change.", 409);

  const { data: subscription } = await supabase.from("subscriptions").select("status").eq("user_id", user.id).maybeSingle();
  const isPro = subscription?.status === "active" || subscription?.status === "trialing";
  const requestedPackages = Array.isArray(body.package_options) ? body.package_options : [];
  const validPackages = requestedPackages.length <= 3 && requestedPackages.every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const option = value as Record<string, unknown>;
    return ["Good", "Better", "Best"].includes(String(option.name))
      && typeof option.description === "string" && option.description.length <= 500
      && (option.description_es === undefined || typeof option.description_es === "string" && option.description_es.length <= 500)
      && typeof option.total === "number" && Number.isFinite(option.total) && option.total >= 0 && option.total <= 100000000;
  });
  if (!validPackages) return jsonError("Proposal package details are invalid.", 400);
  const isEnablingProOptions = (body.require_deposit === true && existing.require_deposit !== true)
    || (existing.require_deposit === true && depositPercentage !== Number(existing.deposit_percentage))
    || (requestedPackages.length > 0 && JSON.stringify(requestedPackages) !== JSON.stringify(existing.package_options ?? []));
  if (!isPro && isEnablingProOptions) {
    return jsonError("Deposit terms and package options require an active WorkCraft AI Pro subscription.", 403);
  }

  const estimateUpdate: Record<string, unknown> = {
    client_name: clientName,
    client_email: clientEmail,
    client_phone: clientPhone,
    job_address: jobAddress,
    require_deposit: isPro ? body.require_deposit === true : existing.require_deposit,
    deposit_percentage: isPro ? depositPercentage : existing.deposit_percentage,
    package_options: isPro ? requestedPackages : existing.package_options ?? [],
    proposal_language: proposalLanguage,
  };
  if (body.tax_rate !== undefined) estimateUpdate.tax_rate = taxRate;
  if (body.markup_percentage !== undefined) estimateUpdate.markup_percentage = markupPercentage;
  if (typeof body.trade === "string") estimateUpdate.trade = body.trade.slice(0, 80);

  const { error: updateError } = await supabase.rpc("workcraft_replace_estimate_with_items", {
    p_estimate_id: id,
    p_estimate: estimateUpdate,
    p_line_items: body.lineItems,
  });
  if (updateError) {
    if (updateError.code === "P0002" || updateError.message.includes("ESTIMATE_NOT_FOUND")) return jsonError("Estimate not found.", 404);
    if (updateError.message.includes("ESTIMATE_NOT_EDITABLE")) return jsonError("Approved estimates cannot be edited. Create a new estimate if the terms need to change.", 409);
    if (updateError.message.includes("WORKCRAFT_PRO_REQUIRED")) return jsonError("Deposit terms and proposal packages require an active WorkCraft AI Pro subscription.", 403);
    if (updateError.message.includes("ESTIMATE_TOTAL_TOO_LARGE")) return jsonError("Estimate line-item subtotal cannot exceed $1,000,000,000.", 400);
    if (updateError.message.includes("INVALID_LINE_ITEMS") || updateError.message.includes("INVALID_ESTIMATE")) return jsonError("Check the estimate details and line items.", 400);
    console.error("Atomic estimate update failed:", updateError.message);
    return jsonError("Unable to update this estimate.", 500);
  }

  return NextResponse.json({ success: true }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
