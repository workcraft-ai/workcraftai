import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { getServerProAccess } from "@/lib/pro-access";

export const dynamic = "force-dynamic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return jsonError("Estimate not found.", 404);

  const supabase = await createUserSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return jsonError("Sign in to create an invoice.", 401);

  let hasPro: boolean;
  try {
    hasPro = (await getServerProAccess(user.id)).hasPro;
  } catch (error) {
    console.error("Invoice Pro access lookup failed:", error instanceof Error ? error.message : "unknown error");
    return jsonError("We could not confirm your plan. Refresh and try again.", 503);
  }
  if (!hasPro) return jsonError("Creating an invoice requires an active Pro plan.", 403);

  const { data: estimate, error: lookupError } = await supabase
    .from("estimates")
    .select("id, status, converted_job_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (lookupError) {
    console.error("Invoice estimate lookup failed:", lookupError.message);
    return jsonError("We could not verify this estimate. Refresh and try again.", 500);
  }
  if (!estimate) {
    return jsonError("We could not find this estimate in your account. Refresh and make sure you are signed in as its owner.", 404);
  }

  if (estimate.converted_job_id) {
    return NextResponse.json({ job_id: estimate.converted_job_id }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (!["accepted", "paid"].includes(String(estimate.status).toLowerCase())) {
    return jsonError("This estimate is no longer accepted. Refresh the page to see its current status.", 409);
  }

  const { data: jobId, error: conversionError } = await supabase.rpc("convert_accepted_estimate_to_job", {
    p_estimate_id: id,
    p_scheduled_at: null,
    p_title: null,
    p_notes: "",
  });

  if (conversionError) {
    console.error("Estimate-to-job conversion RPC failed:", {
      code: conversionError.code,
      message: conversionError.message,
    });
    if (conversionError.code === "P0002" || conversionError.message.includes("APPROVED_ESTIMATE_NOT_FOUND")) {
      return jsonError("We could not verify this estimate in your account. Refresh and make sure you are signed in as its owner.", 404);
    }
    if (conversionError.code === "P0001" || conversionError.message.includes("ESTIMATE_NOT_APPROVED")) {
      return jsonError("This estimate is no longer accepted. Refresh the page to see its current status.", 409);
    }
    if (conversionError.code === "42501" || conversionError.message.toLowerCase().includes("row-level security")) {
      return jsonError("Pro access could not be confirmed for invoice creation. Refresh your plan status and try again.", 403);
    }
    return jsonError("We could not create the invoice. Please try again.", 500);
  }

  if (typeof jobId !== "string" || !jobId) {
    console.error("Estimate-to-job conversion returned no job ID.");
    return jsonError("We could not create the invoice. Please try again.", 500);
  }

  return NextResponse.json({ job_id: jobId }, { headers: { "Cache-Control": "private, no-store" } });
}
