import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { deleteTradeFlowAccount } from "@/lib/account-deletion";
import { sameOrigin, validReason } from "@/lib/admin-support";
import { getServiceSupabase } from "@/lib/stripe-server";

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const userClient = await createUserSupabaseClient();
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const payload: unknown = await request.json().catch(() => null);
  const body = payload as { confirm_email?: unknown; reason?: unknown } | null;
  if (!body || typeof body.confirm_email !== "string" || !validReason(body.reason)) {
    return NextResponse.json({ error: "Enter your account email and a reason of at least 8 characters." }, { status: 400 });
  }
  if (body.confirm_email.trim().toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return NextResponse.json({ error: "The confirmation email does not match your account." }, { status: 400 });
  }
  try {
    await deleteTradeFlowAccount({
      admin: getServiceSupabase(), targetUserId: user.id, actorUserId: user.id,
      actorEmail: "Account owner", reason: body.reason.trim(), trigger: "user_requested",
    });
    return NextResponse.json({ success: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The account could not be deleted.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
