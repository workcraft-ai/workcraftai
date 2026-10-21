import { NextResponse } from "next/server";
import { requireTradeFlowAdmin } from "@/lib/admin-support";

export async function GET() {
  const access = await requireTradeFlowAdmin("super_admin");
  if ("response" in access) return access.response;
  const { data, error } = await access.admin.rpc("get_workcraft_ai_match_metrics");
  if (error) {
    console.error("Could not load AI match metrics:", error.message);
    return NextResponse.json({ error: "Could not load AI match quality metrics." }, { status: 503 });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
