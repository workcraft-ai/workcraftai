import { NextResponse } from "next/server";
import { deleteTradeFlowAccount } from "@/lib/account-deletion";
import { requireTradeFlowAdmin, sameOrigin, validReason } from "@/lib/admin-support";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await requireTradeFlowAdmin("super_admin");
  if ("response" in access) return access.response;
  const { id } = await params;
  const payload: unknown = await request.json().catch(() => null);
  const body = payload as { confirm_email?: unknown; reason?: unknown } | null;
  if (!body || typeof body.confirm_email !== "string" || !validReason(body.reason)) {
    return NextResponse.json({ error: "Enter the account email and a reason of at least 8 characters." }, { status: 400 });
  }
  const { data: target, error } = await access.admin.auth.admin.getUserById(id);
  if (error || !target.user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  if (body.confirm_email.trim().toLowerCase() !== (target.user.email ?? "").toLowerCase()) {
    return NextResponse.json({ error: "The confirmation email does not match this account." }, { status: 400 });
  }
  try {
    await deleteTradeFlowAccount({
      admin: access.admin, targetUserId: id, actorUserId: access.user.id,
      actorEmail: access.user.email ?? "WorkCraft AI administrator", reason: body.reason.trim(), trigger: "admin_requested",
    });
    return NextResponse.json({ success: true, message: "The account and its WorkCraft AI data were deleted." });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The account could not be deleted.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
