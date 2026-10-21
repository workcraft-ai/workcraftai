import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";
import { withApiFailureMetrics } from "@/lib/api-failure-metrics";

export const POST = withApiFailureMetrics("/api/estimates/[id]/verbal-approval", async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Estimate not found." }, { status: 404 });
  }
  const supabase = await createUserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to approve this estimate." }, { status: 401 });

  const parsed = await readLimitedJsonObject(request, 2_000);
  if (!parsed.ok) return NextResponse.json({ error: "Enter the verbal approval details." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const body = parsed.value;
  const contactName = typeof body.contactName === "string" ? body.contactName.trim() : "";
  const selectedPackage = typeof body.selectedPackage === "string" && body.selectedPackage.trim() ? body.selectedPackage.trim() : null;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (contactName.length < 2 || contactName.length > 120 || (selectedPackage !== null && selectedPackage.length > 120) || note.length > 500) {
    return NextResponse.json({ error: "Check the approval name, package, and note." }, { status: 400 });
  }

  const { data: acceptedTotalCents, error } = await supabase.rpc("workcraft_record_verbal_estimate_approval", {
    p_estimate_id: id,
    p_contact_name: contactName,
    p_selected_package: selectedPackage,
    p_note: note || null,
  });
  if (error) {
    if (error.message.includes("ESTIMATE_NOT_FOUND")) return NextResponse.json({ error: "Estimate not found." }, { status: 404 });
    if (error.message.includes("ESTIMATE_NOT_OPEN")) return NextResponse.json({ error: "This estimate is no longer open for approval." }, { status: 409 });
    if (error.message.includes("MFA_REQUIRED") || error.message.includes("AUTH_REQUIRED")) return NextResponse.json({ error: "Complete sign-in verification and try again." }, { status: 403 });
    if (["INVALID_APPROVAL_DETAILS", "PACKAGE_SELECTION_REQUIRED", "INVALID_PACKAGE_SELECTION", "INVALID_PACKAGE_OPTIONS"].some((code) => error.message.includes(code))) {
      return NextResponse.json({ error: "Check the approval name and selected package." }, { status: 400 });
    }
    console.error("Verbal estimate approval failed:", error.message);
    return NextResponse.json({ error: "Could not record verbal approval. Try again." }, { status: 500 });
  }
  return NextResponse.json({ success: true, acceptedTotalCents }, { headers: { "Cache-Control": "private, no-store" } });
});
