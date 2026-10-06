import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
const email = `pro-checkout-race-${randomUUID()}@example.test`;
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password: `Test-${randomUUID()}-A1!`,
  email_confirm: true,
});
if (createError || !created.user) throw new Error(`Could not create checkout test user: ${createError?.message ?? "unknown error"}`);
const userId = created.user.id;

async function reserveMany(count) {
  const results = await Promise.all(Array.from({ length: count }, () => admin.rpc("workcraft_reserve_pro_checkout", { p_user_id: userId })));
  const firstError = results.find(({ error }) => error)?.error;
  if (firstError) throw new Error(`Concurrent checkout reservation failed: ${firstError.message}`);
  return results.flatMap(({ data }) => Array.isArray(data) ? data : []);
}

try {
  const firstWave = await reserveMany(30);
  const attemptIds = new Set(firstWave.map((row) => row.attempt_id));
  const firstReservations = firstWave.filter((row) => row.reused === false);
  if (attemptIds.size !== 1 || firstReservations.length !== 1) {
    throw new Error(`Expected one durable reservation from 30 requests; got ${attemptIds.size} IDs and ${firstReservations.length} new reservations.`);
  }

  const firstAttemptId = firstWave[0].attempt_id;
  const { error: expireError } = await admin.from("pro_checkout_attempts")
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("id", firstAttemptId);
  if (expireError) throw new Error(`Could not expire concurrency test reservation: ${expireError.message}`);

  const retryWave = await reserveMany(30);
  const retryIds = new Set(retryWave.map((row) => row.attempt_id));
  const retryReservations = retryWave.filter((row) => row.reused === false);
  if (retryIds.size !== 1 || retryReservations.length !== 1 || retryWave[0].attempt_id === firstAttemptId) {
    throw new Error(`Expected concurrent retry to create one fresh reservation; got ${retryIds.size} IDs and ${retryReservations.length} new reservations.`);
  }

  const { data: attempts, error: attemptsError } = await admin.from("pro_checkout_attempts")
    .select("id, status").eq("user_id", userId).order("created_at", { ascending: true });
  if (attemptsError || attempts?.length !== 2 || attempts[0]?.status !== "expired" || attempts[1]?.status !== "creating") {
    throw new Error(`Expected one expired and one live reservation; got ${JSON.stringify(attempts)}: ${attemptsError?.message ?? ""}`);
  }
  console.log("Pro checkout concurrency test passed: overlapping requests share one reservation, and a fresh reservation is created after expiry.");
} finally {
  await admin.auth.admin.deleteUser(userId);
}
