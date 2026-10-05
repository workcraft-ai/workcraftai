import { NextResponse } from "next/server";
import { finishAudit, requireTradeFlowAdmin, sameOrigin, startAudit, validReason } from "@/lib/admin-support";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await requireTradeFlowAdmin("billing");
  if ("response" in access) return access.response;
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const operation = body.operation;
  const reason = body.reason;
  if (!validReason(reason)) return NextResponse.json({ error: "Provide a reason between 8 and 500 characters." }, { status: 400 });
  if (operation !== "grant" && operation !== "revoke") return NextResponse.json({ error: "Choose a valid Pro access action." }, { status: 400 });

  const grantType = body.grant_type;
  const durationDays = body.duration_days;
  if (operation === "grant") {
    if (grantType !== "temporary" && grantType !== "permanent") return NextResponse.json({ error: "Choose temporary or permanent Pro access." }, { status: 400 });
    if (grantType === "temporary" && (!Number.isInteger(durationDays) || Number(durationDays) < 1 || Number(durationDays) > 365)) {
      return NextResponse.json({ error: "Temporary access must last from 1 to 365 days." }, { status: 400 });
    }
    if (grantType === "permanent" && durationDays !== null) return NextResponse.json({ error: "Permanent access does not have an expiration date." }, { status: 400 });
  }

  const { data: target, error: targetError } = await access.admin.auth.admin.getUserById(id);
  if (targetError || !target.user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const action = operation === "grant" ? "pro_access_granted" : "pro_access_revoked";
  let auditId: string;
  try {
    auditId = await startAudit(access.admin, access.user.id, id, action, reason, {
      ...(operation === "grant" ? { grant_type: grantType, duration_days: grantType === "temporary" ? durationDays : null } : {}),
    }, access.user.email);
  } catch {
    return NextResponse.json({ error: "Could not write the required Pro access audit entry." }, { status: 503 });
  }

  const { data, error } = operation === "grant"
    ? await access.admin.rpc("grant_workcraft_pro_access", {
        p_target_user_id: id,
        p_actor_user_id: access.user.id,
        p_reason: reason.trim(),
        p_grant_type: grantType,
        p_duration_days: grantType === "temporary" ? durationDays : null,
        p_audit_id: auditId,
      })
    : await access.admin.rpc("revoke_workcraft_pro_access", {
        p_target_user_id: id,
        p_actor_user_id: access.user.id,
        p_reason: reason.trim(),
        p_audit_id: auditId,
      });

  if (error) {
    await finishAudit(access.admin, auditId, "failed", {
      ...(operation === "grant" ? { grant_type: grantType, duration_days: grantType === "temporary" ? durationDays : null } : {}),
      error_code: error.code ?? null,
    });
    if (error.message.includes("PRO_ACCESS_ALREADY_ACTIVE")) {
      return NextResponse.json({ error: "This account already has an active admin Pro grant. Revoke it before assigning another." }, { status: 409 });
    }
    if (error.message.includes("NO_ACTIVE_PRO_ACCESS_GRANT")) {
      return NextResponse.json({ error: "This account has no active admin Pro grant to revoke." }, { status: 409 });
    }
    console.error("Admin Pro access operation failed:", error.message);
    return NextResponse.json({ error: "Could not update Pro access. Confirm the database migration is applied, then try again." }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    message: operation === "grant"
      ? grantType === "permanent" ? "Permanent Pro access granted until an admin revokes it." : "Temporary Pro access granted. It will expire automatically."
      : "Admin-granted Pro access revoked.",
    grant: data,
  }, { headers: { "Cache-Control": "no-store" } });
}
