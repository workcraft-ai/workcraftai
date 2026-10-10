import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getEstimatePaymentData, paidCents } from "@/lib/customer-payments";
import { getProAccess } from "@/lib/pro-access";
import { calculateEstimateMoney } from "@/lib/estimate-money.mjs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Proposal viewing is temporarily unavailable." }, { status: 503 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: estimate, error } = await admin
    .from("estimates")
    .select("id, reference_number, user_id, client_name, client_email, client_phone, job_address, status, require_deposit, deposit_percentage, tax_rate, markup_percentage, proposal_language, proposal_display_mode, proposal_summary, converted_job_id, created_at, package_options, signature_name, selected_package, accepted_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Proposal lookup failed:", error.message);
    return NextResponse.json({ error: "Unable to load this proposal." }, { status: 500 });
  }
  if (!estimate) return NextResponse.json({ error: "Proposal not found or link expired." }, { status: 404 });

  const { data: ownerData } = estimate.user_id
    ? await admin.auth.admin.getUserById(estimate.user_id)
    : { data: { user: null } };
  const metadata = ownerData.user?.user_metadata ?? {};
  const contractor = {
    businessName: typeof metadata.business_name === "string" && metadata.business_name.trim() ? metadata.business_name.trim() : "Your Contractor",
    phone: typeof metadata.phone === "string" ? metadata.phone : "",
    address: typeof metadata.business_address === "string" ? metadata.business_address : "",
    logoUrl: typeof metadata.logo_url === "string" && metadata.logo_url.startsWith("https://") ? metadata.logo_url : "",
    brandColor: typeof metadata.brand_color === "string" && /^#[0-9a-f]{6}$/i.test(metadata.brand_color) ? metadata.brand_color : "#c85b2d",
  };

  let lineItems: Array<Record<string, unknown>> = [];
  if (estimate.proposal_display_mode !== "summary") {
    const { data, error: itemError } = await admin
      .from("line_items")
      .select("id, description, description_es, quantity, unit, unit_price")
      .eq("estimate_id", id);
    if (itemError) {
      console.error("Proposal line item lookup failed:", itemError.message);
      return NextResponse.json({ error: "Unable to load proposal details." }, { status: 500 });
    }
    lineItems = (data ?? []) as Array<Record<string, unknown>>;
  }

  const { data: attachments } = await admin.from("estimate_attachments")
    .select("id, storage_path, media_type").eq("estimate_id", id).eq("media_type", "photo");
  const photos = await Promise.all((attachments ?? []).map(async (attachment) => {
    const { data } = await admin.storage.from("estimate-media").createSignedUrl(attachment.storage_path, 60 * 60);
    return data?.signedUrl ? { id: attachment.id, url: data.signedUrl } : null;
  }));

  const paymentData = await getEstimatePaymentData(admin, id);
  let hasPro = false;
  if (estimate.user_id) {
    try { hasPro = (await getProAccess(admin, estimate.user_id)).hasPro; }
    catch (entitlementError) { console.error("Proposal payment entitlement lookup failed:", entitlementError instanceof Error ? entitlementError.message : "unknown error"); }
  }
  const { data: connectedAccount } = estimate.user_id
    ? await admin.from("stripe_connected_accounts").select("charges_enabled").eq("user_id", estimate.user_id).maybeSingle()
    : { data: null };
  const paymentSummary = {
    amountPaidCents: paidCents(paymentData.payments),
    totalCents: paymentData.totalCents,
    packageTotalsCents: Object.fromEntries((Array.isArray(estimate.package_options) ? estimate.package_options : []).flatMap((option) => {
      if (!option || typeof option !== "object" || typeof option.name !== "string") return [];
      const totalCents = calculateEstimateMoney({ tax_rate: estimate.tax_rate }, [], option.name).totalCents;
      return [[option.name, totalCents]];
    })),
    available: hasPro && connectedAccount?.charges_enabled === true,
  };

  const publicEstimate = Object.fromEntries(Object.entries(estimate).filter(([key]) =>
    key !== "user_id" && key !== "converted_job_id"
      && !(estimate.proposal_display_mode === "summary" && ["tax_rate", "markup_percentage"].includes(key))
  ));
  return NextResponse.json({ estimate: publicEstimate, converted: Boolean(estimate.converted_job_id), lineItems: lineItems ?? [], contractor, photos: photos.filter(Boolean), paymentSummary }, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
