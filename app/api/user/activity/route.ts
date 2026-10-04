import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { sameOrigin } from "@/lib/admin-support";
import { getServiceSupabase } from "@/lib/stripe-server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const userClient = await createUserSupabaseClient();
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { data: status, error: activityError } = await getServiceSupabase().rpc("workcraft_record_account_activity", { p_user_id: user.id });
  if (activityError) {
    console.error("Could not record account activity:", activityError.message);
    return NextResponse.json({ error: "Account activity could not be recorded." }, { status: 503 });
  }
  return NextResponse.json({ status }, { headers: { "Cache-Control": "no-store" } });
}
