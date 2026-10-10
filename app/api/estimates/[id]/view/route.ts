import { customerShareAllowed } from "@/lib/proposal-sharing";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ tracked: false });
  const { id } = await params;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } });
  if (!(await customerShareAllowed(admin, id, request, false))) return NextResponse.json({ error: "Proposal not found or link expired." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const { data: estimate } = await admin.from("estimates").select("id, user_id, proposal_viewed_at").eq("id", id).maybeSingle();
  if (!estimate || estimate.proposal_viewed_at || !estimate.user_id) return NextResponse.json({ tracked: false });
  const viewedAt = new Date().toISOString();
  const { error } = await admin.from("estimates").update({ proposal_viewed_at: viewedAt }).eq("id", id).is("proposal_viewed_at", null);
  if (!error) await admin.from("estimate_email_events").insert({ user_id: estimate.user_id, estimate_id: id, recipient: "", event: "proposal_viewed" });
  return NextResponse.json({ tracked: !error });
}
