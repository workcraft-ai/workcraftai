import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { calculateEstimateMoney } from "@/lib/estimate-money.mjs";

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
  const { data: subscription } = await supabase.from("subscriptions").select("status").eq("user_id", user.id).maybeSingle();
  if (!subscription || !["active", "trialing"].includes(subscription.status)) return NextResponse.json({ error: "Branded estimate email is a Pro feature." }, { status: 403 });

  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !sender) return NextResponse.json({ error: "Email sending is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL." }, { status: 503 });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: "Email sending is temporarily unavailable." }, { status: 503 });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } });

  const { data: estimate, error: estimateError } = await supabase.from("estimates").select("id, user_id, client_name, client_email, job_address, tax_rate, markup_percentage, proposal_language, updated_at").eq("id", id).eq("user_id", user.id).single();
  if (estimateError || !estimate) return NextResponse.json({ error: "Estimate not found in your account." }, { status: 404 });
  const { data: items, error: itemsError } = await supabase.from("line_items").select("description, description_es, quantity, unit_price").eq("estimate_id", id);
  if (itemsError) {
    console.error("Could not load estimate line items for email:", itemsError.message);
    return NextResponse.json({ error: "Could not prepare this estimate email. Please try again." }, { status: 503 });
  }

  const origin = new URL(request.url).origin;
  const link = `${origin}/estimate/${encodeURIComponent(id)}`;
  const estimateMoney = calculateEstimateMoney(estimate, items ?? []);
  const rows = (items ?? []).map((item, index) => {
    const amount = estimateMoney.lineItemCents[index] / 100;
    const label = estimate.proposal_language === "es" ? item.description_es || item.description : item.description;
    return `<tr><td style="padding:10px;border-bottom:1px solid #e5e7eb">${escapeHtml(label)}</td><td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">$${amount.toFixed(2)}</td></tr>`;
  }).join("");
  const safeName = escapeHtml(estimate.client_name || "there");
  const subtotal = estimateMoney.subtotalCents / 100;
  const markup = estimateMoney.markupCents / 100;
  const tax = estimateMoney.taxCents / 100;
  const total = estimateMoney.totalCents / 100;
  const { error: reserveError } = await admin.rpc("workcraft_reserve_estimate_email", { p_user_id: user.id, p_estimate_id: id });
  if (reserveError) {
    if (reserveError.message.includes("ESTIMATE_EMAIL_DAILY_LIMIT")) return NextResponse.json({ error: "You’ve reached the daily estimate-email limit. Try again tomorrow." }, { status: 429 });
    if (reserveError.message.includes("WORKCRAFT_PRO_REQUIRED")) return NextResponse.json({ error: "Branded estimate email is a Pro feature." }, { status: 403 });
    console.error("Estimate email quota reservation failed:", reserveError.message);
    return NextResponse.json({ error: "Could not prepare this email. Please try again." }, { status: 503 });
  }
  const usageDate = new Date().toISOString().slice(0, 10);
  const businessName = typeof user.user_metadata?.business_name === "string" && user.user_metadata.business_name.trim() ? user.user_metadata.business_name.trim() : "your contractor";
  const brandColor = typeof user.user_metadata?.brand_color === "string" && /^#[0-9a-f]{6}$/i.test(user.user_metadata.brand_color) ? user.user_metadata.brand_color : "#c85b2d";
  const logoUrl = typeof user.user_metadata?.logo_url === "string" && user.user_metadata.logo_url.startsWith("https://") ? `<img src="${escapeHtml(user.user_metadata.logo_url)}" alt="" style="max-height:56px;max-width:180px">` : "";
  const spanish = estimate.proposal_language === "es";
  let emailResponse: Response;
  try {
    emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `estimate-send-${id}-${new Date(estimate.updated_at).getTime()}` },
      body: JSON.stringify({
      from: sender,
      to: [estimate.client_email],
      subject: spanish ? `Tu cotización de ${businessName}` : `Your estimate from ${businessName}`,
      text: spanish ? `Hola ${estimate.client_name}, tu cotización está lista. Revísala aquí: ${link}` : `Hi ${estimate.client_name}, your estimate is ready. View it here: ${link}`,
      html: `<div style="font-family:Arial,sans-serif;color:#1d2925;max-width:640px;margin:auto">${logoUrl}<h1 style="font-size:22px;color:${brandColor}">${escapeHtml(businessName)} · ${spanish ? "Tu cotización está lista" : "Your estimate is ready"}</h1><p>${spanish ? "Hola" : "Hi"} ${safeName},</p><p>${spanish ? "Aquí está la cotización para" : "Here is the estimate for"} ${escapeHtml(estimate.job_address || (spanish ? "tu proyecto" : "your project"))}.</p><table style="border-collapse:collapse;width:100%">${rows}<tr><td style="padding:10px">${spanish ? "Subtotal" : "Subtotal"}</td><td style="padding:10px;text-align:right">$${subtotal.toFixed(2)}</td></tr>${markup ? `<tr><td style="padding:10px">${spanish ? "Recargo" : "Markup"} (${Number(estimate.markup_percentage)}%)</td><td style="padding:10px;text-align:right">$${markup.toFixed(2)}</td></tr>` : ""}${tax ? `<tr><td style="padding:10px">${spanish ? "Impuesto" : "Tax"} (${Number(estimate.tax_rate)}%)</td><td style="padding:10px;text-align:right">$${tax.toFixed(2)}</td></tr>` : ""}<tr><td style="padding:12px;font-weight:bold">${spanish ? "Total de la cotización" : "Estimate total"}</td><td style="padding:12px;text-align:right;font-weight:bold">$${total.toFixed(2)}</td></tr></table><p style="margin:24px 0"><a href="${link}" style="background:${brandColor};color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${spanish ? "Revisar cotización" : "Review estimate"}</a></p><p style="font-size:12px;color:#68736c">${spanish ? "Enviado con WorkCraft AI" : "Sent with WorkCraft AI"}</p></div>`,
      }),
    });
  } catch (error) {
    await admin.rpc("workcraft_release_estimate_email", { p_user_id: user.id, p_usage_date: usageDate });
    console.error("Estimate email provider request failed:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ error: "The email service did not respond. Please retry shortly." }, { status: 502 });
  }
  const responseData = await emailResponse.json().catch(() => ({}));
  if (!emailResponse.ok) {
    await admin.rpc("workcraft_release_estimate_email", { p_user_id: user.id, p_usage_date: usageDate });
    console.error("Estimate email provider rejected request:", emailResponse.status);
    return NextResponse.json({ error: "Could not send the estimate email. Please try again." }, { status: 502 });
  }

  const { error: eventError } = await supabase.from("estimate_email_events").insert({ user_id: user.id, estimate_id: id, recipient: estimate.client_email, provider_email_id: responseData.id, event: "sent" });
  if (eventError) console.error("Estimate email event could not be recorded:", eventError.message);
  const followupAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("estimates").update({ followup_at: followupAt, followup_sent_at: null, followup_claimed_at: null }).eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ success: true, emailId: responseData.id });
}
