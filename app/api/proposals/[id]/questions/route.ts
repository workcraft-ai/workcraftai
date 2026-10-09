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
  const { data: estimate } = await admin.from("estimates").select("id, user_id, client_name").eq("id", id).maybeSingle();
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
  let hasProEmail = false;
  try { hasProEmail = (await getProAccess(admin, estimate.user_id)).hasPro; }
  catch (entitlementError) { console.error("Proposal question entitlement lookup failed:", entitlementError instanceof Error ? entitlementError.message : "unknown error"); }
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.RESEND_FROM_EMAIL;
  let emailSent = false;
  if (hasProEmail && businessEmail && apiKey && sender) {
    const { reservation, error: quotaError } = await reserveAppEmail(admin, "proposal_question", estimate.user_id, id);
    if (quotaError) {
      console.error("Proposal question email quota reservation failed:", quotaError.message);
    } else if (reservation?.allowed && reservation.reservation_id) {
      try {
        const mail = await fetch("https://api.resend.com/emails", {
          method: "POST", signal: AbortSignal.timeout(10_000),
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `proposal-question-${questionId}` },
          body: JSON.stringify({ from: sender, to: [businessEmail], reply_to: email, subject: `Customer question about estimate ${id}`,
            text: `${name} (${email}) asked about ${estimate.client_name}'s proposal:\n\n${message}`,
            html: `<p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) asked a question about proposal ${escapeHtml(id)}:</p><blockquote>${escapeHtml(message).replace(/\n/g, "<br>")}</blockquote><p>Reply directly to this email to respond.</p>` }),
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
