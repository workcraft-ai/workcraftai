import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";
import { getProAccess } from "@/lib/pro-access";
import { releaseAppEmail, reserveAppEmail } from "@/lib/email-quota";

const MAX_QUESTION_BODY_BYTES = 8_000;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "Questions are temporarily unavailable." }, { status: 503 });

  const parsedBody = await readLimitedJsonObject(request, MAX_QUESTION_BODY_BYTES);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: parsedBody.reason === "too_large" ? "Your question is too large." : "Enter your details and question." },
      { status: parsedBody.reason === "too_large" ? 413 : 400 },
    );
  }
  const payload = parsedBody.value;

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (typeof payload.company_website === "string" && payload.company_website.trim()) return NextResponse.json({ success: true });
  if (name.length < 2 || name.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320 || message.length < 5 || message.length > 2000) {
    return NextResponse.json({ error: "Enter a valid name, email, and question (up to 2,000 characters)." }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: estimate } = await admin.from("estimates").select("id, reference_number, user_id, client_name").eq("id", id).maybeSingle();
  if (!estimate) return NextResponse.json({ error: "This proposal could not be found." }, { status: 404 });
  const { data: questionId, error } = await admin.rpc("workcraft_submit_proposal_question", {
    p_estimate_id: id, p_customer_name: name, p_customer_email: email, p_message: message,
  });
  if (error) {
    if (error.message.includes("PROPOSAL_QUESTION_LIMIT") || error.message.includes("CUSTOMER_QUESTION_LIMIT") || error.message.includes("CONTRACTOR_QUESTION_LIMIT")) {
      return NextResponse.json({ error: "Please wait before sending another question about this proposal." }, { status: 429 });
    }
    if (error.code === "P0002") return NextResponse.json({ error: "This proposal could not be found." }, { status: 404 });
    console.error("Could not store proposal question:", error.message);
    return NextResponse.json({ error: "Your question could not be saved. Please try again." }, { status: 503 });
  }

  const { data: ownerData } = await admin.auth.admin.getUserById(estimate.user_id);
  const businessEmail = ownerData.user?.email;
  const ownerLanguage = ownerData.user?.user_metadata?.app_language === "es" ? "es" : "en";
  let hasProEmail = false;
  try { hasProEmail = (await getProAccess(admin, estimate.user_id)).hasPro; }
  catch (entitlementError) { console.error("Proposal question entitlement lookup failed:", entitlementError instanceof Error ? entitlementError.message : "unknown error"); }
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.RESEND_ESTIMATE_FROM_EMAIL || process.env.RESEND_FROM_EMAIL;
  let emailSent = false;
  if (hasProEmail && businessEmail && apiKey && sender) {
    const { reservation, error: quotaError } = await reserveAppEmail(admin, "proposal_question", estimate.user_id, id);
    if (quotaError) {
      console.error("Proposal question email quota reservation failed:", quotaError.message);
    } else if (reservation?.allowed && reservation.reservation_id) {
      try {
        const referenceNumber = estimate.reference_number;
        const safeCustomerName = name.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").slice(0, 80);
        const appOrigin = (process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin).replace(/\/+$/, "");
        const estimateUrl = `${appOrigin}/estimate/${encodeURIComponent(id)}`;
        const spanish = ownerLanguage === "es";
        const escapedName = escapeHtml(name);
        const escapedEmail = escapeHtml(email);
        const escapedReference = escapeHtml(referenceNumber);
        const escapedClientName = escapeHtml(estimate.client_name);
        const escapedMessage = escapeHtml(message).replace(/\n/g, "<br>");
        const mail = await fetch("https://api.resend.com/emails", {
          method: "POST", signal: AbortSignal.timeout(10_000),
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `proposal-question-${questionId}` },
          body: JSON.stringify({
            from: sender,
            to: [businessEmail],
            reply_to: email,
            subject: spanish ? `Nueva pregunta · ${referenceNumber} · ${safeCustomerName}` : `New question · ${referenceNumber} · ${safeCustomerName}`,
            text: spanish
              ? `${name} (${email}) hizo una pregunta sobre tu cotización ${referenceNumber} para ${estimate.client_name}.\n\n${message}\n\n${estimateUrl}\n\nResponde directamente a este correo para contestarle al cliente.`
              : `${name} (${email}) asked about your estimate ${referenceNumber} for ${estimate.client_name}.\n\n${message}\n\nOpen the estimate: ${estimateUrl}\n\nReply directly to this email to respond to the customer.`,
            html: `<div style="margin:0;background:#f5f3ed;padding:28px 12px;font-family:Arial,sans-serif;color:#1d2925"><div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e4e2dc;border-radius:14px;overflow:hidden"><div style="padding:22px 26px;background:#1b2924;color:#fff"><div style="font-size:20px;font-weight:700;letter-spacing:-.3px">WorkCraft <span style="color:#f28a52">AI</span></div><div style="margin-top:14px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#f8b37e">${spanish ? "Nueva pregunta del cliente" : "New customer question"}</div></div><div style="padding:26px"><h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${spanish ? "Un cliente tiene una pregunta sobre tu cotización" : "A customer has a question about your estimate"}</h1><p style="margin:0 0 6px;color:#68736c">${spanish ? "Referencia" : "Estimate reference"}</p><p style="margin:0 0 18px;font-size:18px;font-weight:700">${escapedReference}</p><p style="margin:0 0 6px"><strong>${escapedName}</strong> · <a href="mailto:${escapedEmail}" style="color:#9f4728">${escapedEmail}</a></p><p style="margin:0 0 16px;color:#68736c">${spanish ? "Cliente de la cotización" : "Customer on estimate"}: ${escapedClientName}</p><div style="padding:16px;border-radius:10px;background:#f5f3ed;line-height:1.6">${escapedMessage}</div><p style="margin:22px 0"><a href="${escapeHtml(estimateUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#c85b2d;color:#fff;text-decoration:none;font-weight:700">${spanish ? "Abrir cotización" : "Open estimate"}</a></p><p style="margin:0;color:#58645e;font-size:14px;line-height:1.5">${spanish ? "También puedes responder directamente a este correo. Tu respuesta llegará al cliente." : "You can also reply directly to this email. Your reply will go to the customer."}</p></div><div style="padding:16px 26px;border-top:1px solid #e4e2dc;color:#68736c;font-size:12px">${spanish ? "Para quienes hacen el trabajo. Mantén el buen trabajo en marcha." : "For the people who get the work done. Keep good work moving."}</div></div></div>`,
          }),
        });
        emailSent = mail.ok;
        if (!mail.ok) {
          if (mail.status < 500) await releaseAppEmail(admin, reservation.reservation_id);
          console.error("Proposal question notification email failed:", mail.status);
        }
      } catch (mailError) {
        console.error("Proposal question notification failed:", mailError instanceof Error ? mailError.name : "unknown error");
      }
    }
  }
  return NextResponse.json({ success: true, emailSent });
}
