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
const { data: settings, error: settingsError } = await admin.from("tradeflow_app_settings")
  .select("ai_drafting_enabled, ai_daily_generation_limit, ai_global_daily_generation_limit").eq("singleton", true).single();
if (settingsError) throw new Error(`Could not read AI settings: ${settingsError.message}`);

const userIds = [];
async function createProTestUser(prefix) {
  const email = `${prefix}-${randomUUID()}@example.test`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: `Test-${randomUUID()}-A1!`, email_confirm: true });
  if (createError || !created.user) throw new Error(`Could not create quota test user: ${createError?.message ?? "unknown error"}`);
  const userId = created.user.id;
  userIds.push(userId);
  const { error: subscriptionError } = await admin.from("subscriptions").insert({ user_id: userId, status: "active" });
  if (subscriptionError) throw new Error(`Could not create Pro subscription fixture: ${subscriptionError.message}`);
  return userId;
}

try {
  const firstUserId = await createProTestUser("ai-quota-race-user-one");
  const { error: configureError } = await admin.from("tradeflow_app_settings").update({ ai_drafting_enabled: true, ai_daily_generation_limit: 5, ai_global_daily_generation_limit: 11 }).eq("singleton", true);
  if (configureError) throw new Error(`Could not configure AI quota test: ${configureError.message}`);

  const reservations = await Promise.all(Array.from({ length: 30 }, () => admin.rpc("reserve_workcraft_ai_generation", {
    p_user_id: firstUserId,
    p_prompt_characters: 120,
    p_model: "gemini-concurrency-test",
  })));
  const allowed = reservations.flatMap(({ data, error }) => {
    if (error) throw new Error(`Concurrent quota reservation failed: ${error.message}`);
    return Array.isArray(data) ? data.filter((row) => row.allowed) : [];
  });
  if (allowed.length !== 5) throw new Error(`Expected exactly 5 reservations to pass; got ${allowed.length}.`);

  const completed = await Promise.all(allowed.map((reservation, index) => admin.rpc("complete_workcraft_ai_generation", {
    p_generation_id: reservation.generation_id,
    p_outcome: index === 0 ? "failed" : "succeeded",
    p_provider_status: index === 0 ? 429 : 200,
    p_generated_items: index === 0 ? null : 2,
  })));
  const completionError = completed.find(({ error }) => error)?.error;
  if (completionError) throw new Error(`Could not finalize test usage: ${completionError.message}`);

  const { data: usage, error: usageError } = await admin.from("tradeflow_ai_daily_usage")
    .select("attempts_started, succeeded, failed").eq("user_id", firstUserId).single();
  if (usageError || usage?.attempts_started !== 5 || usage.succeeded !== 4 || usage.failed !== 1) {
    throw new Error(`Expected 5 total attempts (4 succeeded, 1 failed); got ${JSON.stringify(usage)}: ${usageError?.message ?? ""}`);
  }
  const secondUserId = await createProTestUser("ai-quota-race-user-two");
  const secondUserReservations = await Promise.all(Array.from({ length: 30 }, () => admin.rpc("reserve_workcraft_ai_generation", {
    p_user_id: secondUserId,
    p_prompt_characters: 120,
    p_model: "gemini-global-concurrency-test",
  })));
  const secondUserResults = secondUserReservations.flatMap(({ data, error }) => {
    if (error) throw new Error(`Concurrent platform quota reservation failed: ${error.message}`);
    return Array.isArray(data) ? data : [];
  });
  const secondUserAllowed = secondUserResults.filter((row) => row.allowed);
  if (secondUserAllowed.length !== 5) {
    throw new Error(`Expected the second account to use its own 5-attempt allowance; got ${secondUserAllowed.length} allowed.`);
  }
  const thirdUserId = await createProTestUser("ai-quota-race-user-three");
  const globalReservations = await Promise.all(Array.from({ length: 30 }, () => admin.rpc("reserve_workcraft_ai_generation", {
    p_user_id: thirdUserId,
    p_prompt_characters: 120,
    p_model: "gemini-global-concurrency-test",
  })));
  const globalResults = globalReservations.flatMap(({ data, error }) => {
    if (error) throw new Error(`Concurrent platform quota reservation failed: ${error.message}`);
    return Array.isArray(data) ? data : [];
  });
  const globalAllowed = globalResults.filter((row) => row.allowed);
  const globalDenied = globalResults.filter((row) => row.reason === "global_daily_limit");
  if (globalAllowed.length !== 1 || globalDenied.length !== 29) {
    throw new Error(`Expected the platform cap to admit exactly 1 remaining reservation; got ${globalAllowed.length} allowed and ${globalDenied.length} platform-limited.`);
  }
  const { data: globalUsage, error: globalUsageError } = await admin.from("tradeflow_ai_global_daily_usage")
    .select("attempts_started").eq("usage_date", new Date().toISOString().slice(0, 10)).single();
  if (globalUsageError || globalUsage?.attempts_started !== 11) {
    throw new Error(`Expected the platform-wide counter to stop at 11; got ${globalUsage?.attempts_started ?? "no counter"}: ${globalUsageError?.message ?? ""}`);
  }
  console.log("AI quota concurrency test passed: each account stops at 5 attempts and simultaneous requests across accounts stop at the platform cap of 11.");
} finally {
  await admin.from("tradeflow_app_settings").update(settings).eq("singleton", true);
  await Promise.all(userIds.map((userId) => admin.auth.admin.deleteUser(userId)));
}
