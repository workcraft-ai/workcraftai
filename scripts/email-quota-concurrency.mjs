import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

function localSupabaseEnvironment() {
  const args = ["status", "-o", "env"];
  if (process.env.SUPABASE_WORKDIR) args.push("--workdir", process.env.SUPABASE_WORKDIR);
  const output = execFileSync("supabase", args, { encoding: "utf8" });
  const values = Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
  return {
    url: process.env.SUPABASE_URL || values.API_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || values.SERVICE_ROLE_KEY,
  };
}

const { url, serviceKey } = localSupabaseEnvironment();
if (!url || !serviceKey) throw new Error("Start local Supabase first; API_URL and SERVICE_ROLE_KEY are required.");
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const today = new Date().toISOString().slice(0, 10);

const [{ data: settings, error: settingsError }, { data: before, error: beforeError }] = await Promise.all([
  admin.from("tradeflow_app_settings").select("app_email_daily_limit").eq("singleton", true).single(),
  admin.from("tradeflow_app_email_daily_usage").select("emails_started").eq("usage_date", today).maybeSingle(),
]);
if (settingsError || beforeError) throw new Error(`Could not read local email quota settings: ${settingsError?.message ?? beforeError?.message}`);

const limit = settings.app_email_daily_limit;
const baseline = before?.emails_started ?? 0;
const capacity = Math.max(0, limit - baseline);
const requestCount = capacity + 25;
const reservationIds = [];
let createdUsageRow = !before;

try {
  const results = await Promise.all(Array.from({ length: requestCount }, () => admin.rpc("workcraft_reserve_app_email", { p_source: "support" })));
  const reservations = results.flatMap(({ data }) => Array.isArray(data) ? data : []);
  const accepted = reservations.filter((row) => row.allowed);
  const denied = reservations.filter((row) => !row.allowed && row.reason === "platform_daily_limit");
  reservationIds.push(...accepted.map((row) => row.reservation_id).filter((id) => typeof id === "string"));
  const firstError = results.find(({ error }) => error)?.error;
  if (firstError) throw new Error(`Concurrent app email quota reservation failed: ${firstError.message}`);
  if (accepted.length !== capacity || denied.length !== 25 || reservationIds.length !== capacity) {
    throw new Error(`Expected ${capacity} reservations and 25 denials; got ${accepted.length} accepted, ${denied.length} denied, ${reservationIds.length} IDs.`);
  }

  const { data: after, error: afterError } = await admin.from("tradeflow_app_email_daily_usage")
    .select("emails_started").eq("usage_date", today).single();
  if (afterError || after.emails_started !== limit) {
    throw new Error(`Expected the global count to stop at ${limit}; got ${after?.emails_started ?? "no row"}: ${afterError?.message ?? ""}`);
  }

  const releaseResults = await Promise.all(reservationIds.map((reservationId) => admin.rpc("workcraft_release_app_email", { p_reservation_id: reservationId })));
  const releaseError = releaseResults.find(({ error }) => error)?.error;
  if (releaseError || releaseResults.some(({ data }) => data !== true)) {
    throw new Error(`Could not release all test reservations: ${releaseError?.message ?? "a release did not succeed"}`);
  }
  const { data: restored, error: restoreError } = await admin.from("tradeflow_app_email_daily_usage")
    .select("emails_started").eq("usage_date", today).single();
  if (restoreError || restored.emails_started !== baseline) {
    throw new Error(`Expected quota count to return to ${baseline}; got ${restored?.emails_started ?? "no row"}: ${restoreError?.message ?? ""}`);
  }
  console.log(`App email quota concurrency test passed: ${capacity} available slots were reserved exactly once and the cap stopped at ${limit}.`);
} finally {
  if (reservationIds.length) {
    await Promise.all(reservationIds.map((reservationId) => admin.rpc("workcraft_release_app_email", { p_reservation_id: reservationId })));
    await admin.from("tradeflow_app_email_reservations").delete().in("id", reservationIds);
  }
  if (createdUsageRow) {
    await admin.from("tradeflow_app_email_daily_usage").delete().eq("usage_date", today).eq("emails_started", 0);
  }
}
