import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";

export type TradeFlowAdminRole = "support" | "billing" | "super_admin";
const roles: TradeFlowAdminRole[] = ["support", "billing", "super_admin"];

export async function requireTradeFlowAdmin(required: "support" | "billing" | "super_admin" = "support", requireMfa = true) {
  const userClient = await createUserSupabaseClient();
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Sign in required." }, { status: 401 }) };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { response: NextResponse.json({ error: "Admin support is not configured." }, { status: 503 }) };
  const admin = createSupabaseAdmin(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: membership, error: membershipError } = await admin
    .from("tradeflow_admins").select("role").eq("user_id", user.id).maybeSingle();
  if (membershipError) {
    console.error("Admin membership lookup failed:", membershipError.message);
    return { response: NextResponse.json({ error: "Admin access is not configured. Apply the admin support migration." }, { status: 503 }) };
  }
  const role = membership?.role as TradeFlowAdminRole | undefined;
  if (!role || !roles.includes(role) || (required === "billing" && role !== "billing" && role !== "super_admin") || (required === "super_admin" && role !== "super_admin")) {
    return { response: NextResponse.json({ error: "You are not authorized to use this support tool." }, { status: 403 }) };
  }
  const { data: assurance } = await userClient.auth.mfa.getAuthenticatorAssuranceLevel();
  const mfaRequired = assurance?.currentLevel !== "aal2";
  if (requireMfa && mfaRequired) {
    return { response: NextResponse.json({ error: "Complete multi-factor authentication to use admin support.", code: "mfa_required" }, { status: 403 }) };
  }
  return { user, role, admin, mfaRequired };
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function validReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 8 && value.trim().length <= 500;
}

type AdminDatabase = SupabaseClient;

export async function startAudit(admin: AdminDatabase, actorId: string | null, targetId: string, action: string, reason: string, details: Record<string, unknown> = {}, actorEmail?: string) {
  const { data, error } = await admin.from("tradeflow_admin_audit_log").insert({
    actor_user_id: actorId,
    actor_email: actorEmail ?? null,
    target_user_id: targetId,
    action,
    reason: reason.trim(),
    details,
    outcome: "started",
  }).select("id").single();
  if (error) throw new Error("Could not write the required support audit entry.");
  return data.id as string;
}

export async function finishAudit(admin: AdminDatabase, id: string, outcome: "succeeded" | "failed", details?: Record<string, unknown>) {
  const { error } = await admin.from("tradeflow_admin_audit_log").update({
    outcome,
    ...(details ? { details } : {}),
  }).eq("id", id);
  if (error) console.error("Could not update support audit outcome:", error.message);
}
