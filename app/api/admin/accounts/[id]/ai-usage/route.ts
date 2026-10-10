import { NextResponse } from "next/server";
import { requireTradeFlowAdmin, sameOrigin, validReason } from "@/lib/admin-support";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await requireTradeFlowAdmin("super_admin");
  if ("response" in access) return access.response;
  const { id } = await params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!validReason(body.reason)) return NextResponse.json({ error: "Provide a reason of at least 8 characters." }, { status: 400 });

  const { data: target, error: targetError } = await access.admin.auth.admin.getUserById(id);
  if (targetError || !target.user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const { error } = await access.admin.rpc("reset_workcraft_ai_account_usage", {
    p_target_user_id: id,
    p_actor_user_id: access.user.id,
    p_actor_email: access.user.email ?? null,
    p_reason: body.reason.trim(),
  });
  if (error) {
    if (error.code === "55000" && error.message.includes("AI_GENERATION_IN_PROGRESS")) {
      return NextResponse.json({ error: "An AI draft is still running for this account. Wait for it to finish, then reset the allowance." }, { status: 409 });
    }
    console.error("Could not reset account AI allowance:", error.message);
    return NextResponse.json({ error: "Could not reset the AI allowance. Confirm the AI usage reset migration is applied and retry." }, { status: 502 });
  }
  return NextResponse.json({ success: true, message: "AI allowance counts reset. Usage history and the platform-wide limit are unchanged." }, { headers: { "Cache-Control": "no-store" } });
}
