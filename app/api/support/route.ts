import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/admin-support";
import { emailAddressFromConfig } from "@/lib/email-address";
import { releaseAppEmail, reserveAppEmail } from "@/lib/email-quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const topics = new Set(["Account access", "Estimates", "Proposals and invoices", "Billing", "Other"]);
const MAX_BODY_BYTES = 10_000;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

function supportResponse(request: Request, payload: { success?: boolean; error?: string }, status = 200) {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const acceptsHtml = request.headers.get("accept")?.toLowerCase().includes("text/html");
  if (contentType === "application/x-www-form-urlencoded" && acceptsHtml) {
    const destination = new URL("/support", request.url);
    destination.searchParams.set("form", payload.success ? "sent" : "error");
    destination.hash = "contact-support";
    return NextResponse.redirect(destination, 303);
  }
  return NextResponse.json(payload, { status });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return supportResponse(request, { error: "This request could not be verified." }, 403);
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const isJson = contentType === "application/json";
  const isForm = contentType === "application/x-www-form-urlencoded";
  if (!isJson && !isForm) {
    return supportResponse(request, { error: "Submit the form using the support page." }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return supportResponse(request, { error: "Your message is too large." }, 413);

  let payload: Record<string, unknown>;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("missing body");
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return supportResponse(request, { error: "Your message is too large." }, 413);
      }
      chunks.push(value);
    }
    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const decoded = new TextDecoder().decode(body);
    const parsed: unknown = isJson
      ? JSON.parse(decoded)
      : Object.fromEntries(new URLSearchParams(decoded));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    payload = parsed as Record<string, unknown>;
  } catch {
    return supportResponse(request, { error: "Enter your name, email, topic, and message." }, 400);
  }

  // Bots that fill this hidden field receive a successful response without any email being sent.
  if (typeof payload.company_website === "string" && payload.company_website.trim()) {
    return supportResponse(request, { success: true });
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const topic = typeof payload.topic === "string" ? payload.topic : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (name.length < 2 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
    !topics.has(topic) || message.length < 10 || message.length > 4000) {
    return supportResponse(request, { error: "Check the fields and keep your message under 4,000 characters." }, 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.RESEND_FROM_EMAIL;
  const recipient = emailAddressFromConfig(process.env.NEXT_PUBLIC_SUPPORT_EMAIL);
  if (!supabaseUrl || !serviceKey || !apiKey || !sender || !recipient) {
    return supportResponse(request, { error: "The support form is temporarily unavailable. Please try again later." }, 503);
  }

  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const requesterIp = request.headers.get("x-real-ip")?.trim() || forwardedIp;
  if (!requesterIp || !isIP(requesterIp)) {
    return supportResponse(request, { error: "The support form is temporarily unavailable. Please try again later." }, 503);
  }

  const requesterHash = createHmac("sha256", serviceKey).update(requesterIp).digest("hex");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: allowed, error: limitError } = await admin.rpc("consume_public_support_submission_limit", {
    p_requester_hash: requesterHash,
  });
  if (limitError) {
    console.error("Support form rate limit is unavailable:", limitError.message);
    return supportResponse(request, { error: "The support form is temporarily unavailable. Please try again later." }, 503);
  }
  if (!allowed) return supportResponse(request, { error: "Please wait until tomorrow before sending another support request." }, 429);

  const { reservation, error: quotaError } = await reserveAppEmail(admin, "support");
  if (quotaError) {
    console.error("Support email quota reservation failed:", quotaError.message);
    return supportResponse(request, { error: "The support form is temporarily unavailable. Please try again later." }, 503);
  }
  if (!reservation) return supportResponse(request, { error: "The support form is temporarily unavailable. Please try again later." }, 503);
  if (!reservation.allowed || !reservation.reservation_id) {
    return supportResponse(request, { error: "Our support inbox has reached today’s message capacity. Please try again tomorrow or email support@workcraftai.com." }, 429);
  }

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeTopic = escapeHtml(topic);
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, "<br>");
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        reply_to: email,
        subject: `WorkCraft AI support: ${topic}`,
        text: `Name: ${name}\nEmail: ${email}\nTopic: ${topic}\n\n${message}`,
        html: `<p><strong>Name:</strong> ${safeName}<br><strong>Email:</strong> ${safeEmail}<br><strong>Topic:</strong> ${safeTopic}</p><p>${safeMessage}</p>`,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      if (response.status < 500) await releaseAppEmail(admin, reservation.reservation_id);
      console.error("Support form email delivery failed with status:", response.status);
      return supportResponse(request, { error: "We could not send your message just now. Please email support@workcraftai.com." }, 502);
    }
  } catch {
    console.error("Support form email delivery request failed.");
    return supportResponse(request, { error: "We could not send your message just now. Please email support@workcraftai.com." }, 502);
  }

  return supportResponse(request, { success: true });
}
