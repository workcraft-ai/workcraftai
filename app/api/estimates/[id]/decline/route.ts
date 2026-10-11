import { customerShareAllowed } from "@/lib/proposal-sharing";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";

const MAX_DECLINE_BODY_BYTES = 3_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Proposal not found or link expired." }, { status: 404, headers: NO_STORE });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Estimate responses are temporarily unavailable." }, { status: 503, headers: NO_STORE });
  }

  const parsedBody = await readLimitedJsonObject(request, MAX_DECLINE_BODY_BYTES);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: parsedBody.reason === "too_large" ? "Your response is too long." : "Please try again." },
      { status: parsedBody.reason === "too_large" ? 413 : 400, headers: NO_STORE },
    );
  }
  const payload = parsedBody.value;
  if (payload.reason !== undefined && payload.reason !== null && typeof payload.reason !== "string") {
    return NextResponse.json({ error: "Enter an optional reason or submit without one." }, { status: 400, headers: NO_STORE });
  }
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (reason.length > 500) {
    return NextResponse.json({ error: "Your reason must be 500 characters or less." }, { status: 400, headers: NO_STORE });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  try {
    if (!(await customerShareAllowed(admin, id, request, false))) {
      return NextResponse.json({ error: "Proposal not found or link expired." }, { status: 404, headers: NO_STORE });
    }
  } catch {
    return NextResponse.json({ error: "Estimate responses are temporarily unavailable." }, { status: 503, headers: NO_STORE });
  }

  const { data: declinedAt, error } = await admin.rpc("workcraft_customer_decline_estimate", {
    p_estimate_id: id,
    p_reason: reason || null,
  });
  if (error) {
    if (error.code === "P0002" || error.message.includes("ESTIMATE_NOT_FOUND")) {
      return NextResponse.json({ error: "Proposal not found or link expired." }, { status: 404, headers: NO_STORE });
    }
    if (error.message.includes("ESTIMATE_NOT_OPEN")) {
      return NextResponse.json({ error: "The estimate is no longer open for a response." }, { status: 409, headers: NO_STORE });
    }
    if (error.message.includes("INVALID_DECLINE_REASON")) {
      return NextResponse.json({ error: "Your reason must be 500 characters or less." }, { status: 400, headers: NO_STORE });
    }
    console.error("Estimate decline failed:", error.code ?? "unknown");
    return NextResponse.json({ error: "Your response could not be recorded. Please try again." }, { status: 503, headers: NO_STORE });
  }
  if (typeof declinedAt !== "string") {
    console.error("Estimate decline returned no timestamp.");
    return NextResponse.json({ error: "Your response could not be recorded. Please try again." }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ success: true, declinedAt }, { headers: NO_STORE });
}
