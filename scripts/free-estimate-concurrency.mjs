import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function localSupabaseEnvironment() {
  const args = ["status", "-o", "env"];
  if (process.env.SUPABASE_WORKDIR) args.push("--workdir", process.env.SUPABASE_WORKDIR);
  const output = execFileSync("supabase", args, { encoding: "utf8" });
  const values = Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) return [];
    return [[match[1], match[2].replace(/^['"]|['"]$/g, "")]];
  }));
  return {
    url: process.env.SUPABASE_URL || values.API_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || values.ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || values.SERVICE_ROLE_KEY,
  };
}

const { url, anonKey, serviceKey } = localSupabaseEnvironment();
if (!url || !anonKey || !serviceKey) throw new Error("Start local Supabase first; API_URL, ANON_KEY, and SERVICE_ROLE_KEY are required.");

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: setting, error: settingError } = await admin.from("tradeflow_app_settings")
  .select("free_daily_estimate_limit").eq("singleton", true).single();
if (settingError) throw new Error(`Could not read quota setting: ${settingError.message}`);

const email = `quota-race-${randomUUID()}@example.test`;
const password = `Test-${randomUUID()}-A1!`;
let userId;
try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw new Error(`Could not create concurrency-test user: ${createError?.message ?? "unknown error"}`);
  userId = created.user.id;

  const { error: configError } = await admin.from("tradeflow_app_settings")
    .update({ free_daily_estimate_limit: 5 }).eq("singleton", true);
  if (configError) throw new Error(`Could not set temporary concurrency-test limit: ${configError.message}`);

  const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Could not authenticate concurrency-test user: ${signInError.message}`);

  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => userClient.from("estimates")
    .insert({ user_id: userId, client_name: `Concurrent ${index}`, client_email: `concurrent-${index}@example.test` })
    .select("id").single()));
  const createdCount = results.filter(({ data, error }) => Boolean(data && !error)).length;
  const rejected = results.filter(({ error }) => error);
  const quotaRejectedCount = rejected.filter(({ error }) => error?.message.includes("FREE_DAILY_ESTIMATE_LIMIT")).length;

  if (createdCount !== 5 || quotaRejectedCount !== 15) {
    throw new Error(`Expected exactly 5 successful and 15 quota-rejected concurrent inserts; got ${createdCount} successful and ${quotaRejectedCount} quota rejections.`);
  }

  const { data: usage, error: usageError } = await admin.from("tradeflow_daily_estimate_usage")
    .select("estimates_created").eq("user_id", userId).single();
  if (usageError || usage?.estimates_created !== 5) {
    throw new Error(`Atomic counter expected 5, got ${usage?.estimates_created ?? "no counter"}: ${usageError?.message ?? ""}`);
  }

  console.log("Quota concurrency test passed: 20 simultaneous requests created exactly 5 estimates; 15 were rejected and the durable counter is 5.");
} finally {
  await userClient.auth.signOut();
  await admin.from("tradeflow_app_settings").update({ free_daily_estimate_limit: setting.free_daily_estimate_limit }).eq("singleton", true);
  if (userId) await admin.auth.admin.deleteUser(userId);
}
