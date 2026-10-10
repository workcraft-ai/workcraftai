import { customerShareAllowed } from "@/lib/proposal-sharing";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";
import { processNotifications } from "@/lib/notification-outbox";

const MAX_QUESTION_BODY_BYTES = 8_000;

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
  if (!(await customerShareAllowed(admin, id, request, false))) return NextResponse.json({ error: "Proposal not found or link expired." }, { status: 404, headers: { "Cache-Control": "no-store" } });
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

  // The question trigger queues the notification in the same DB transaction.
  const { data: queued } = await admin.from("notification_outbox").select("id,status").eq("send_key", `proposal-question-${questionId}`).maybeSingle();
  let emailSent = queued?.status === "sent";
  if (queued && !emailSent) {
    try { emailSent = (await processNotifications(admin, [queued.id], 1)).sent > 0; }
    catch { console.error("Saved question notification remains queued."); }
  }
  return NextResponse.json({ success: true, emailSent, notificationPending: Boolean(queued && !emailSent) });
}
