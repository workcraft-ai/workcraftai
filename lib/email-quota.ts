import type { SupabaseClient } from "@supabase/supabase-js";

export type AppEmailSource = "follow_up" | "support" | "proposal_question" | "account_retention";
export type EmailReservation = {
  allowed: boolean;
  reason: "allowed" | "platform_daily_limit" | "account_daily_limit";
  reservation_id: string | null;
  usage_date: string;
  daily_limit: number;
  emails_used: number;
};

function firstRow(data: unknown): Partial<EmailReservation> | null {
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") return null;
  return data[0] as Partial<EmailReservation>;
}

export async function reserveAppEmail(admin: SupabaseClient, source: AppEmailSource) {
  const { data, error } = await admin.rpc("workcraft_reserve_app_email", { p_source: source });
  const row = firstRow(data);
  if (!error && (!row || typeof row.allowed !== "boolean" || typeof row.reason !== "string" || typeof row.usage_date !== "string")) {
    return { reservation: null, error: new Error("Email quota reservation returned an invalid response.") };
  }
  return { reservation: row as EmailReservation | null, error };
}

export async function reserveEstimateEmail(admin: SupabaseClient, userId: string, estimateId: string) {
  const { data, error } = await admin.rpc("workcraft_reserve_estimate_email", { p_user_id: userId, p_estimate_id: estimateId });
  const row = firstRow(data);
  if (!error && (!row || typeof row.allowed !== "boolean" || typeof row.reason !== "string" || typeof row.usage_date !== "string")) {
    return { reservation: null, error: new Error("Email quota reservation returned an invalid response.") };
  }
  return { reservation: row as EmailReservation | null, error };
}

export async function releaseAppEmail(admin: SupabaseClient, reservationId: string) {
  const { error } = await admin.rpc("workcraft_release_app_email", { p_reservation_id: reservationId });
  if (error) console.error("Could not release failed email quota reservation:", error.message);
  return !error;
}
