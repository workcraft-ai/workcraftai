import { NextResponse } from "next/server";
import { requireTradeFlowAdmin, sameOrigin, startAudit, finishAudit, validReason } from "@/lib/admin-support";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await requireTradeFlowAdmin("super_admin");
  if ("response" in access) return access.response;
  const { id } = await params;
  const payload: unknown = await request.json().catch(() => null);
  const body = payload as { action?: unknown; reason?: unknown } | null;
  if (body?.action !== "cancel_pending_deletion" || !validReason(body.reason)) {
    return NextResponse.json({ error: "Choose a valid action and provide a reason." }, { status: 400 });
  }
  const { data: target, error: userError } = await access.admin.auth.admin.getUserById(id);
  if (userError || !target.user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  let auditId: string;
  try {
    auditId = await startAudit(access.admin, access.user.id, id, "cancel_inactivity_deletion", body.reason.trim(), { action: body.action }, access.user.email);
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Could not write the audit record." }, { status: 503 });
  }
  const { data, error } = await access.admin.from("tradeflow_account_lifecycle")
    .update({ deletion_status: "active", notice_claimed_at: null, notice_sent_at: null, deletion_due_at: null, deletion_claimed_at: null, deletion_reason: null, updated_at: new Date().toISOString() })
    .eq("user_id", id).eq("deletion_status", "pending_deletion").select("user_id").maybeSingle();
  if (error || !data) {
    await finishAudit(access.admin, auditId, "failed", { action: body.action });
    return NextResponse.json({ error: "This account has no pending inactivity deletion to cancel." }, { status: 409 });
  }
  await finishAudit(access.admin, auditId, "succeeded", { action: body.action });
  return NextResponse.json({ success: true, message: "The pending inactivity deletion was canceled." });
}
