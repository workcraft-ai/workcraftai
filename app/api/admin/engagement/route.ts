import { NextResponse } from "next/server";
import { requireTradeFlowAdmin } from "@/lib/admin-support";

export async function GET() {
  const access = await requireTradeFlowAdmin("super_admin");
  if ("response" in access) return access.response;
  const { data, error } = await access.admin.rpc("workcraft_engagement_admin_snapshot");
  if (error) {
    console.error("Could not load engagement email overview:", error.message);
    return NextResponse.json({ error: "Engagement email overview is unavailable." }, { status: 503 });
  }
  const snapshot = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  return NextResponse.json({ ...snapshot, enabled: Boolean(process.env.RESEND_API_KEY), mailingAddressConfigured: Boolean(process.env.ENGAGEMENT_POSTAL_ADDRESS?.trim()) },
    { headers: { "Cache-Control": "private, no-store" } });
}
