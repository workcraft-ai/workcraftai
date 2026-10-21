import { NextResponse } from "next/server";
import { finishAudit, requireTradeFlowAdmin, sameOrigin, startAudit } from "@/lib/admin-support";
import { enqueueNotification, escapeEmailHtml, notificationFrame, processNotifications } from "@/lib/notification-outbox";
import { emailAddressFromConfig } from "@/lib/email-address";
import { validMfaRecoveryRequest } from "@/lib/mfa-recovery-policy.mjs";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const access = await requireTradeFlowAdmin("super_admin");
  if ("response" in access) return access.response;
  const { id } = await params;
  if (!uuidPattern.test(id) || id === access.user.id) return NextResponse.json({ error: "This account cannot be reset here." }, { status: 403 });

  const parsed = await readLimitedJsonObject(request, 4_096);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid or oversized request body." }, { status: 400 });
  const body = parsed.value;
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "Security email is not configured. MFA cannot be reset." }, { status: 503 });

  const [{ data: target, error: targetError }, { data: membership, error: membershipError }, { data: factorData, error: factorError }] = await Promise.all([
    access.admin.auth.admin.getUserById(id),
    access.admin.from("tradeflow_admins").select("user_id").eq("user_id", id).maybeSingle(),
    access.admin.auth.admin.mfa.listFactors({ userId: id }),
  ]);
  if (targetError || !target.user?.email || !target.user.email_confirmed_at) {
    return NextResponse.json({ error: "A confirmed account was not found." }, { status: 404 });
  }
  if (membershipError || factorError) {
    console.error("MFA recovery account lookup failed:", membershipError?.message ?? factorError?.message);
    return NextResponse.json({ error: "Could not verify the account or authenticator." }, { status: 502 });
  }
  if (membership) return NextResponse.json({ error: "Administrator accounts require a separate recovery process." }, { status: 403 });
  if (!validMfaRecoveryRequest(body, target.user.email)) {
    return NextResponse.json({ error: "Select a factor, confirm the account email, and record how you independently verified the owner." }, { status: 400 });
  }
  const factor = (factorData?.factors ?? []).find((item) => item.id === body.factor_id && item.status === "verified");
  if (!factor) return NextResponse.json({ error: "The selected authenticator is no longer active. Refresh the account." }, { status: 409 });

  let auditId: string;
  const auditDetails = {
    factor_id: factor.id,
    factor_type: factor.factor_type,
    verification_method: body.verification_method,
    verification_details: (body.verification_details as string).trim(),
  };
  try {
    auditId = await startAudit(access.admin, access.user.id, id, "mfa_factor_recovery", body.reason as string, auditDetails, access.user.email);
  } catch {
    return NextResponse.json({ error: "Could not write the required support audit entry." }, { status: 503 });
  }

  const { error: deleteError } = await access.admin.auth.admin.mfa.deleteFactor({ userId: id, id: factor.id });
  if (deleteError) {
    await finishAudit(access.admin, auditId, "failed", { ...auditDetails, error: "factor_delete_failed" });
    console.error("MFA factor recovery failed:", deleteError.message);
    return NextResponse.json({ error: "The authenticator could not be removed. No reset was completed." }, { status: 502 });
  }

  const spanish = target.user.user_metadata?.app_language === "es";
  const language = spanish ? "es" : "en";
  const title = spanish ? "Se cambió la verificación de tu cuenta" : "Your account verification changed";
  const content = spanish
    ? "Un administrador de WorkCraft AI quitó un autenticador de tu cuenta después de una solicitud de recuperación. Se cerraron tus sesiones activas. Si solicitaste este cambio, inicia sesión y agrega un autenticador nuevo en Perfil → Seguridad de la cuenta. Si no lo solicitaste, contacta con soporte de inmediato."
    : "A WorkCraft AI administrator removed an authenticator from your account after a recovery request. Your active sessions were signed out. If you requested this, sign in and add a new authenticator under Profile → Account security. If you did not request it, contact support immediately.";
  const support = emailAddressFromConfig(process.env.NEXT_PUBLIC_SUPPORT_EMAIL) || "support@workcraftai.com";
  let noticeStatus = "queued";
  try {
    const queued = await enqueueNotification(access.admin, {
      user_id: id,
      source: "auth",
      send_key: `mfa-recovery-notice-${auditId}`,
      payload: {
        to: [target.user.email],
        reply_to: support,
        subject: title,
        text: `${title}\n\n${content}\n\n${support}`,
        html: notificationFrame(language, title, `<p style="font-size:16px;line-height:1.65">${escapeEmailHtml(content)}</p><p><a href="mailto:${escapeEmailHtml(support)}">${escapeEmailHtml(support)}</a></p>`),
      },
    });
    const sent = await processNotifications(access.admin, [queued.id], 1, 4_000);
    noticeStatus = sent.sent > 0 || queued.status === "sent" ? "sent" : "queued";
  } catch (error) {
    noticeStatus = "queue_failed";
    console.error("MFA recovery notice could not be queued:", error instanceof Error ? error.message : "unknown");
  }
  await finishAudit(access.admin, auditId, "succeeded", { ...auditDetails, security_notice: noticeStatus });
  return NextResponse.json({
    success: true,
    message: noticeStatus === "queue_failed"
      ? "Authenticator removed and sessions signed out. The security email could not be queued; contact the account owner and investigate email delivery."
      : "Authenticator removed and sessions signed out. A security email was sent or queued to the account owner.",
    notice_status: noticeStatus,
  }, { headers: { "Cache-Control": "no-store" } });
}
