import { customerShareUrl } from "@/lib/proposal-sharing";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { calculateEstimateMoney } from "@/lib/estimate-money.mjs";
import { getServerProAccess } from "@/lib/pro-access";
import { getWorkCraftNoReplySender } from "@/lib/email-senders";
import { enqueueNotification, processNotifications } from "@/lib/notification-outbox";
import { createHash } from "node:crypto";

function escapeHtml(value: string) {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (char) => entities[char]);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => cookieStore.getAll() } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to send estimates." }, { status: 401 });
  const contractorReplyEmail = user.email?.trim();
  if (!contractorReplyEmail) return NextResponse.json({ error: "Add an email address to your account before sending an estimate." }, { status: 400 });
  let hasPro = false;
  try { hasPro = (await getServerProAccess(user.id)).hasPro; }
  catch { return NextResponse.json({ error: "Could not verify your plan." }, { status: 503 }); }
  if (!hasPro) return NextResponse.json({ error: "Branded estimate email is a Pro feature." }, { status: 403 });

  const apiKey = process.env.RESEND_API_KEY;
  const sender = getWorkCraftNoReplySender();
  if (!apiKey) return NextResponse.json({ error: "Estimate email sending is not configured. Set RESEND_API_KEY." }, { status: 503 });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: "Email sending is temporarily unavailable." }, { status: 503 });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } });

  const { data: estimate, error: estimateError } = await supabase.from("estimates").select("id, reference_number, user_id, client_name, client_email, job_address, tax_rate, markup_percentage, proposal_language, proposal_display_mode, proposal_summary, updated_at").eq("id", id).eq("user_id", user.id).single();
  if (estimateError || !estimate) return NextResponse.json({ error: "Estimate not found in your account." }, { status: 404 });
  const { data: items, error: itemsError } = await supabase.from("line_items").select("description, description_es, quantity, unit, unit_price").eq("estimate_id", id);
  if (itemsError) {
    console.error("Could not load estimate line items for email:", itemsError.message);
    return NextResponse.json({ error: "Could not prepare this estimate email. Please try again." }, { status: 503 });
  }

  let link: string;
  try { link = await customerShareUrl(admin, id); }
  catch { return NextResponse.json({error:"Customer sharing is disabled or expired. Replace the customer link before sending."},{status:409}); }
  const estimateMoney = calculateEstimateMoney(estimate, items ?? []);
  const rows = (items ?? []).map((item, index) => {
    const amount = estimateMoney.lineItemCents[index] / 100;
    const label = estimate.proposal_language === "es" ? item.description_es || item.description : item.description;
    const unit = String(item.unit || "each");
    const unitLabel = estimate.proposal_language === "es"
      ? ({ each: "unidades", hour: "horas", "sq ft": "pies cuadrados", "linear ft": "pies lineales", "roofing square": "cuadros de techo", sheet: "láminas", job: "trabajo", visit: "visita", unknown: "sin especificar" } as Record<string, string>)[unit] || unit
      : unit;
    const quantityUnit = `${Number(item.quantity)} ${escapeHtml(unitLabel)}`;
    return `<tr><td style="padding:10px;border-bottom:1px solid #e5e7eb">${escapeHtml(label)}</td><td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:center">${quantityUnit}</td><td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">$${Number(item.unit_price).toFixed(2)}</td><td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">$${amount.toFixed(2)}</td></tr>`;
  }).join("");
  const safeName = escapeHtml(estimate.client_name || "there");
  const subtotal = estimateMoney.subtotalCents / 100;
  const markup = estimateMoney.markupCents / 100;
  const tax = estimateMoney.taxCents / 100;
  const total = estimateMoney.totalCents / 100;
  const businessName = typeof user.user_metadata?.business_name === "string" && user.user_metadata.business_name.trim() ? user.user_metadata.business_name.trim() : "your contractor";
  const safeBusinessName = businessName.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").slice(0, 120);
  const brandColor = typeof user.user_metadata?.brand_color === "string" && /^#[0-9a-f]{6}$/i.test(user.user_metadata.brand_color) ? user.user_metadata.brand_color : "#c85b2d";
  const logoUrl = typeof user.user_metadata?.logo_url === "string" && user.user_metadata.logo_url.startsWith("https://") ? `<img src="${escapeHtml(user.user_metadata.logo_url)}" alt="" style="max-height:56px;max-width:180px">` : "";
  const spanish = estimate.proposal_language === "es";
  const summaryMode = estimate.proposal_display_mode === "summary";
  const proposalEmailContent = summaryMode
    ? `<section style="margin:24px 0;padding:18px;background:#f8f7f2;border:1px solid #e5e7eb;border-radius:10px"><h2 style="font-size:16px">${spanish ? "Resumen del trabajo" : "Work summary"}</h2><p style="line-height:1.6">${escapeHtml(estimate.proposal_summary || "")}</p><p style="border-top:1px solid #e5e7eb;padding-top:12px;font-weight:bold">${spanish ? "Total de la cotización" : "Estimate total"}: $${total.toFixed(2)}</p></section>`
    : `<table style="border-collapse:collapse;width:100%"><thead><tr><th style="padding:10px;text-align:left">${spanish ? "Descripción" : "Description"}</th><th style="padding:10px;text-align:center">${spanish ? "Cant. / unidad" : "Qty / Unit"}</th><th style="padding:10px;text-align:right">${spanish ? "Tarifa" : "Rate"}</th><th style="padding:10px;text-align:right">${spanish ? "Importe" : "Amount"}</th></tr></thead><tbody>${rows}<tr><td colspan="3" style="padding:10px">${spanish ? "Subtotal" : "Subtotal"}</td><td style="padding:10px;text-align:right">$${subtotal.toFixed(2)}</td></tr>${markup ? `<tr><td colspan="3" style="padding:10px">${spanish ? "Recargo" : "Markup"} (${Number(estimate.markup_percentage)}%)</td><td style="padding:10px;text-align:right">$${markup.toFixed(2)}</td></tr>` : ""}${tax ? `<tr><td colspan="3" style="padding:10px">${spanish ? "Impuesto" : "Tax"} (${Number(estimate.tax_rate)}%)</td><td style="padding:10px;text-align:right">$${tax.toFixed(2)}</td></tr>` : ""}<tr><td colspan="3" style="padding:12px;font-weight:bold">${spanish ? "Total de la cotización" : "Estimate total"}</td><td style="padding:12px;text-align:right;font-weight:bold">$${total.toFixed(2)}</td></tr></tbody></table>`;
  const recipientKey = createHash("sha256").update(estimate.client_email.trim().toLowerCase()).digest("hex").slice(0, 16);
  try {
    const queued = await enqueueNotification(admin, {
      user_id: user.id, estimate_id: id, source: "estimate",
      send_key: `estimate-send-${id}-${new Date(estimate.updated_at).getTime()}-${recipientKey}`,
      payload: {
      from: sender,
      reply_to: contractorReplyEmail,
      to: [estimate.client_email],
      subject: spanish ? `Tu cotización ${estimate.reference_number} de ${safeBusinessName}` : `Your estimate ${estimate.reference_number} from ${safeBusinessName}`,
      text: spanish ? `Hola ${estimate.client_name}, tu cotización ${estimate.reference_number} está lista.${summaryMode ? `\n\n${estimate.proposal_summary || ""}\n\nTotal: $${total.toFixed(2)}.` : ""} Revísala aquí: ${link}` : `Hi ${estimate.client_name}, your estimate ${estimate.reference_number} is ready.${summaryMode ? `\n\n${estimate.proposal_summary || ""}\n\nEstimate total: $${total.toFixed(2)}.` : ""} View it here: ${link}`,
      html: `<html lang="${spanish ? "es" : "en"}"><body><div style="font-family:Arial,sans-serif;color:#1d2925;max-width:640px;margin:auto">${logoUrl}<h1 style="font-size:22px;color:${brandColor}">${escapeHtml(businessName)} · ${spanish ? "Tu cotización está lista" : "Your estimate is ready"}</h1><p>${spanish ? "Hola" : "Hi"} ${safeName},</p><p style="font-size:13px;color:#68736c">${spanish ? "Referencia de cotización" : "Estimate reference"}: <strong>${escapeHtml(estimate.reference_number)}</strong></p><p>${spanish ? "Aquí está la cotización para" : "Here is the estimate for"} ${escapeHtml(estimate.job_address || (spanish ? "tu proyecto" : "your project"))}.</p>${proposalEmailContent}<p style="margin:24px 0"><a href="${link}" style="background:${brandColor};color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${spanish ? "Revisar cotización" : "Review estimate"}</a></p><p style="font-size:12px;color:#68736c">${spanish ? "Enviado con WorkCraft AI" : "Sent with WorkCraft AI"}</p></div></body></html>`,
      },
    });
    const processed = queued.status === "sent" ? null : await processNotifications(admin, [queued.id], 1);
    const sent = queued.status === "sent" || processed?.sent === 1;
    return NextResponse.json({success: true, notificationPending: !sent}, {status: sent ? 200 : 202});
  } catch {
    return NextResponse.json({error: "Could not prepare this estimate email. Please try again."}, {status: 503});
  }
}
