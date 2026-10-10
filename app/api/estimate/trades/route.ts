import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { DEFAULT_ESTIMATE_TRADES, parseEstimateTradeOptions } from "@/lib/estimate-trades";

export const dynamic = "force-dynamic";

export async function GET() {
  const userClient = await createUserSupabaseClient();
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sign in to load estimate trades." }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ trades: DEFAULT_ESTIMATE_TRADES }, { headers: { "Cache-Control": "no-store" } });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.from("tradeflow_app_settings")
    .select("estimate_trade_options")
    .eq("singleton", true)
    .single();
  if (error) {
    console.error("Could not load estimate trade options:", error.message);
    return NextResponse.json({ trades: DEFAULT_ESTIMATE_TRADES }, { headers: { "Cache-Control": "no-store" } });
  }
  const trades = parseEstimateTradeOptions(data.estimate_trade_options);
  return NextResponse.json({ trades: trades ?? DEFAULT_ESTIMATE_TRADES }, { headers: { "Cache-Control": "no-store" } });
}
