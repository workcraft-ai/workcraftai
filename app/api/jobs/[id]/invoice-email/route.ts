import { customerShareUrl } from "@/lib/proposal-sharing";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { sameOrigin } from "@/lib/admin-support";
import { calculateEstimateMoney } from "@/lib/estimate-money.mjs";
import { getTrustedAppOrigin } from "@/lib/security.mjs";
import { getServerProAccess } from "@/lib/pro-access";
import { getWorkCraftNoReplySender } from "@/lib/email-senders";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";
import { enqueueNotification, processNotifications } from "@/lib/notification-outbox";
import type { EmailReservation } from "@/lib/email-quota";

export const dynamic = "force-dynamic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (char) => entities[char]);
}

function safeHeader(value: string, maxLength: number) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function amount(value: number) {
  return `$${value.toFixed(2)}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin.", 403);
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return jsonError("Invoice not found.", 404);

  const supabase = await createUserSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return jsonError("Sign in to send invoices.", 401);
  const contractorReplyEmail = user.email?.trim();
  if (!contractorReplyEmail) return jsonError("Add an email address to your account before sending invoices.", 400);

  const parsed = await readLimitedJsonObject(request, 2048);
  if (!parsed.ok) return jsonError("Invalid request body.", parsed.reason === "too_large" ? 413 : 400);
  const body = parsed.value;
  const requestedRecipient = typeof body.recipient === "string" ? body.recipient.trim() : "";
  const requestedLanguage: "en" | "es" | null = body.language === "es" ? "es" : body.language === "en" ? "en" : null;
  if (requestedRecipient.length > 254) return jsonError("Enter a valid customer email address.", 400);

  let hasPro = false;
  try {
    hasPro = (await getServerProAccess(user.id)).hasPro;
  } catch (error) {
    console.error("Invoice email Pro access lookup failed:", error instanceof Error ? error.message : "unknown error");
    return jsonError("Could not verify your plan. Refresh and try again.", 503);
  }
  if (!hasPro) return jsonError("Sending invoice emails requires an active Pro plan.", 403);

  const resendKey = process.env.RESEND_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!resendKey || !serviceKey) return jsonError("Invoice email service is temporarily unavailable.", 503);

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, user_id, estimate_id, title, client_name, client_email, job_address, invoice_status, quoted_total, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (jobError) {
    console.error("Invoice email job lookup failed:", jobError.message);
    return jsonError("Could not load this invoice. Refresh and try again.", 503);
  }
  if (!job) return jsonError("Invoice not found in your account.", 404);
  const recipient = requestedRecipient || (typeof job.client_email === "string" ? job.client_email.trim() : "");
  if (!recipient) return jsonError("Add a customer email address before sending this invoice.", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return jsonError("Enter a valid customer email address.", 400);

  let estimate: { reference_number: string; proposal_language: string; selected_package: string | null } | null = null;
  let items: Array<{ description: string; description_es: string | null; quantity: number; unit: string | null; unit_price: number }> = [];
  if (job.estimate_id) {
    const { data: estimateData, error: estimateError } = await supabase
      .from("estimates")
      .select("id, reference_number, proposal_language, selected_package")
      .eq("id", job.estimate_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (estimateError || !estimateData) {
      console.error("Invoice email estimate verification failed:", estimateError?.message ?? "estimate not found");
      return jsonError("The estimate linked to this invoice could not be verified. Refresh and try again.", 409);
    }
    estimate = estimateData;
    const { data: lineItems, error: lineItemsError } = await supabase
      .from("line_items")
      .select("description, description_es, quantity, unit, unit_price")
      .eq("estimate_id", job.estimate_id);
    if (lineItemsError) {
      console.error("Invoice email line item lookup failed:", lineItemsError.message);
      return jsonError("Could not load the invoice details. Please try again.", 503);
    }
    items = (lineItems ?? []) as typeof items;
  }

  const appOrigin = getTrustedAppOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (job.estimate_id && !appOrigin) return jsonError("Invoice email service is temporarily unavailable.", 503);
  const shareAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {auth:{persistSession:false}});
  const estimateLink = job.estimate_id && appOrigin ? await customerShareUrl(shareAdmin,job.estimate_id).catch(()=>null) : null;
  const spanish = estimate
    ? estimate.proposal_language === "es"
    : requestedLanguage === "es" || (requestedLanguage === null && user.user_metadata?.app_language === "es");
  const contractorName = safeHeader(
    typeof user.user_metadata?.business_name === "string" && user.user_metadata.business_name.trim()
      ? user.user_metadata.business_name
      : spanish ? "tu contratista" : "your contractor",
    120,
  );
  const brandColor = typeof user.user_metadata?.brand_color === "string" && /^#[0-9a-f]{6}$/i.test(user.user_metadata.brand_color)
    ? user.user_metadata.brand_color
    : "#c85b2d";
  const logoCandidate = typeof user.user_metadata?.logo_url === "string" ? user.user_metadata.logo_url : "";
  let logoUrl = "";
  try {
    const parsedLogo = new URL(logoCandidate);
    if (parsedLogo.protocol === "https:") logoUrl = `<img src="${escapeHtml(parsedLogo.toString())}" alt="" style="display:block;max-width:180px;max-height:56px;margin-bottom:16px">`;
  } catch {
    // Ignore invalid profile logos; the branded text email remains complete.
  }
  const title = safeHeader(String(job.title || "Invoice"), 160);
  const customerName = safeHeader(String(job.client_name || (spanish ? "Cliente" : "Customer")), 120);
  const jobAddress = safeHeader(String(job.job_address || ""), 240);
  const invoiceTotal = Number(job.quoted_total);
  if (!Number.isFinite(invoiceTotal) || invoiceTotal < 0) return jsonError("The invoice total is invalid. Update the job and try again.", 409);

  const invoiceMoney = calculateEstimateMoney({}, items);
  const invoiceTotalForEmail = invoiceTotal || invoiceMoney.subtotalCents / 100;
  const rows = items.map((item, index) => {
    const description = spanish ? item.description_es?.trim() || item.description : item.description;
    const unit = String(item.unit || (spanish ? "unidad" : "each"));
    const unitLabel = spanish
      ? ({ each: "unidades", hour: "horas", "sq ft": "pies cuadrados", "linear ft": "pies lineales", "roofing square": "cuadros de techo", sheet: "láminas", job: "trabajo", visit: "visita", unknown: "sin especificar" } as Record<string, string>)[unit] || unit
      : unit;
    const lineTotal = invoiceMoney.lineItemCents[index] / 100;
    return `<tr><td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:left">${escapeHtml(description)}</td><td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:center">${Number(item.quantity)} ${escapeHtml(unitLabel)}</td><td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">${amount(Number(item.unit_price))}</td><td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">${amount(lineTotal)}</td></tr>`;
  }).join("");
  const packageNote = estimate?.selected_package
    ? `<p style="padding:12px;background:#f8f7f2;border:1px solid #e5e7eb;border-radius:8px">${spanish ? "Esta factura refleja el paquete aceptado" : "This invoice reflects the accepted"} <strong>${escapeHtml(estimate.selected_package)}</strong>. ${spanish ? "Las partidas muestran el alcance original de la cotización." : "The line items show the original estimate scope."}</p>`
    : "";
  const lineTable = items.length
    ? `<table role="presentation" style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr><th style="padding:10px;text-align:left;border-bottom:1px solid #d1d5db">${spanish ? "Descripción" : "Description"}</th><th style="padding:10px;text-align:center;border-bottom:1px solid #d1d5db">${spanish ? "Cantidad / unidad" : "Qty / Unit"}</th><th style="padding:10px;text-align:right;border-bottom:1px solid #d1d5db">${spanish ? "Tarifa" : "Rate"}</th><th style="padding:10px;text-align:right;border-bottom:1px solid #d1d5eb">${spanish ? "Importe" : "Amount"}</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p style="color:#68736c">${spanish ? "No hay partidas detalladas en esta factura." : "This invoice has no detailed line items."}</p>`;
  const totalLabel = spanish ? "Total de la factura" : "Invoice total";
  const reference = estimate?.reference_number
    ? `<p style="font-size:13px;color:#68736c">${spanish ? "Referencia de cotización" : "Estimate reference"}: <strong>${escapeHtml(estimate.reference_number)}</strong></p>`
    : "";
  const addressLine = jobAddress ? `<p style="margin:4px 0;color:#4b5563">${escapeHtml(jobAddress)}</p>` : "";
  const paymentNote = estimateLink
    ? `<p style="margin:18px 0 0;color:#68736c;font-size:13px">${spanish ? "Si el contratista habilitó los pagos en línea, puedes revisar las opciones disponibles en la cotización aceptada." : "If your contractor enabled online payments, you can review available options on the accepted estimate."}</p><p style="margin:18px 0"><a href="${estimateLink}" style="display:inline-block;background:#c85b2d;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${spanish ? "Ver cotización y opciones de pago" : "View estimate and payment options"}</a></p>`
    : "";
  const safeCustomerName = escapeHtml(customerName);
  const html = `<div style="font-family:Arial,sans-serif;color:#1d2925;max-width:640px;margin:0 auto;padding:24px">${logoUrl}<p style="margin:0 0 16px;font-size:13px;font-weight:bold;letter-spacing:1px;color:#68736c">WORKCRAFT AI</p><h1 style="font-size:24px;line-height:1.3;color:${brandColor}">${spanish ? "Factura de" : "Invoice from"} ${escapeHtml(contractorName)}</h1><p>${spanish ? "Hola" : "Hi"} ${safeCustomerName},</p><p>${spanish ? "Aquí está la factura de tu trabajo." : "Here is the invoice for your job."}</p>${reference}<section style="margin:20px 0;padding:16px;background:#f8f7f2;border:1px solid #e5e7eb;border-radius:10px"><p style="margin:0;font-weight:bold">${escapeHtml(title)}</p>${addressLine}</section>${packageNote}${lineTable}<p style="margin:20px 0;text-align:right;font-size:20px;font-weight:bold">${totalLabel}: ${amount(invoiceTotalForEmail)}</p>${paymentNote}<p style="margin-top:28px;color:#68736c;font-size:12px">${spanish ? "Enviado con WorkCraft AI. Para responder, usa la opción de responder a este correo." : "Sent with WorkCraft AI. Reply to this email to contact your contractor."}</p></div>`;
  const textRows = items.map((item, index) => {
    const description = spanish ? item.description_es?.trim() || item.description : item.description;
    return `${description} — ${Number(item.quantity)} × ${amount(Number(item.unit_price))} = ${amount(invoiceMoney.lineItemCents[index] / 100)}`;
  }).join("\n");
  const text = spanish
    ? `Hola ${customerName},\n\nAquí está la factura de tu trabajo: ${title}.${estimate?.reference_number ? `\nReferencia de cotización: ${estimate.reference_number}.` : ""}${textRows ? `\n\n${textRows}` : ""}\n\n${totalLabel}: ${amount(invoiceTotalForEmail)}.${estimateLink ? `\n\nVer cotización y opciones de pago: ${estimateLink}` : ""}\n\nResponde a este correo para contactar a tu contratista.`
    : `Hi ${customerName},\n\nHere is the invoice for your job: ${title}.${estimate?.reference_number ? `\nEstimate reference: ${estimate.reference_number}.` : ""}${textRows ? `\n\n${textRows}` : ""}\n\n${totalLabel}: ${amount(invoiceTotalForEmail)}.${estimateLink ? `\n\nView estimate and payment options: ${estimateLink}` : ""}\n\nReply to this email to contact your contractor.`;

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } });
  try {
    const queued = await enqueueNotification(admin, {
      user_id: user.id, job_id: job.id, estimate_id: job.estimate_id,
      source: "invoice",
      send_key: `invoice-send-${job.id}-${new Date(job.updated_at).getTime()}-${createHash("sha256").update(recipient.toLowerCase()).digest("hex").slice(0, 16)}`,
      payload: { from: getWorkCraftNoReplySender(), reply_to: contractorReplyEmail, to: [recipient],
        subject: spanish ? `Factura de ${title} · ${contractorName}` : `Invoice for ${title} · ${contractorName}`, text, html },
    });
    const result = queued.status === "sent" ? null : await processNotifications(admin, [queued.id], 1);
    const sent = queued.status === "sent" || Boolean(result?.sent);
    const reservation = result?.results[0]?.quota as EmailReservation | undefined;
    return NextResponse.json({ success: true, queued: !sent, statusUpdated: sent, emailId: queued.provider_email_id,
      ...(reservation ? {emailQuota: {
        remainingToday: Math.max((reservation.account_daily_limit ?? 0) - (reservation.account_daily_used ?? 0), 0),
        remainingThisMonth: Math.max((reservation.account_monthly_limit ?? 0) - (reservation.account_monthly_used ?? 0), 0),
      }} : {}),
    }, {status: sent ? 200 : 202, headers: {"Cache-Control":"private, no-store"}});
  } catch {
    console.error("Invoice notification remains pending or could not be queued.");
    return jsonError("Could not prepare this invoice email. Please try again.", 503);
  }
}
