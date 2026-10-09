import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userClient = await createUserSupabaseClient();
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sign in to view account usage." }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "Account usage is temporarily unavailable." }, { status: 503 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("workcraft_get_account_usage", { p_user_id: user.id });
  if (error || !data || typeof data !== "object") {
    console.error("Could not load account quota snapshot:", error?.message ?? "empty response");
    return NextResponse.json({ error: "Could not load account usage. Please refresh shortly." }, { status: 503 });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
