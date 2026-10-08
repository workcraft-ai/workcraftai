import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";

const MAX_APPROVAL_BODY_BYTES = 2_000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: "Proposal approval is not configured." }, { status: 503 });
  const { id } = await params;
  const parsedBody = await readLimitedJsonObject(request, MAX_APPROVAL_BODY_BYTES);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: parsedBody.reason === "too_large" ? "Approval details are too large." : "Enter your approval details." },
      { status: parsedBody.reason === "too_large" ? 413 : 400 },
    );
  }
  const body = parsedBody.value;
  const signatureName = typeof body.signatureName === "string" ? body.signatureName.trim().slice(0, 120) : "";
  const selectedPackage = typeof body.selectedPackage === "string" && body.selectedPackage.trim() ? body.selectedPackage.trim().slice(0, 40) : null;
  if (signatureName.length < 2) return NextResponse.json({ error: "Enter your full name to approve this estimate." }, { status: 400 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } });
  const { data: acceptedTotalCents, error } = await admin.rpc("workcraft_accept_estimate_once", {
    p_estimate_id: id,
    p_signature_name: signatureName,
    p_selected_package: selectedPackage,
  });
  if (error) {
    if (error.code === "P0002" || error.message.includes("ESTIMATE_NOT_FOUND")) return NextResponse.json({ error: "Estimate not found." }, { status: 404 });
    if (error.message.includes("ESTIMATE_NOT_OPEN")) return NextResponse.json({ error: "This estimate has already been approved or is no longer open." }, { status: 409 });
    if (["INVALID_SIGNATURE_NAME", "PACKAGE_SELECTION_REQUIRED", "INVALID_PACKAGE_SELECTION", "INVALID_PACKAGE_OPTIONS"].some((message) => error.message.includes(message))) {
      return NextResponse.json({ error: "Review the proposal option and approval name, then try again." }, { status: 400 });
    }
    console.error("Atomic proposal approval failed:", error.message);
    return NextResponse.json({ error: "This proposal could not be approved. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ success: true, acceptedTotalCents });
}
