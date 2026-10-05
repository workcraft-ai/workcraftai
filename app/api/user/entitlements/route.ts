import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { getServerProAccess } from "@/lib/pro-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createUserSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to check your plan." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const access = await getServerProAccess(user.id);
    return NextResponse.json({
      has_pro: access.hasPro,
      source: access.source,
      grant_type: access.grantType,
      expires_at: access.expiresAt,
      stripe_status: access.stripeStatus,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Pro entitlement lookup failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Could not verify your plan." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
